require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tm_default_jwt_s3cret_k3y_2026';
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const SALT_ROUNDS = 10;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Data helpers ---
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { users: {} };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function ensureUserStructure(user) {
  if (!user.tasks) user.tasks = {};
  if (!user.dailyData) user.dailyData = {};
  if (!user.preferences) user.preferences = { darkMode: false, glassmorphism: false };
  if (!user.northStarGoal) user.northStarGoal = '';
  return user;
}

function emptyTaskSlot() {
  return { text: '', description: '', status: 'Todo', carryForwardCount: 0 };
}

function emptyDailyData() {
  return {
    doNotDo: ['', '', ''],
    dailyReward: '',
    brainDump: '',
    antiToDo: [],
    reflectionWell: '',
    reflectionImprove: ''
  };
}

// --- Auth middleware ---
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    const data = readData();
    if (!data.users || !data.users[req.userId]) {
      return res.status(401).json({ error: 'User not found' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ============ AUTH ROUTES ============

app.post('/api/register', async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) return res.status(400).json({ error: 'userId and password are required' });
    const uid = userId.trim().toLowerCase();
    if (uid.length < 2 || uid.length > 30) return res.status(400).json({ error: 'userId must be 2-30 characters' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const data = readData();
    if (!data.users) data.users = {};
    if (data.users[uid]) return res.status(409).json({ error: 'User already exists' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    data.users[uid] = ensureUserStructure({
      passwordHash,
      preferences: { darkMode: false, glassmorphism: false },
      northStarGoal: '',
      tasks: {},
      dailyData: {}
    });
    writeData(data);

    const token = jwt.sign({ userId: uid }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, userId: uid, preferences: data.users[uid].preferences, northStarGoal: '' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) return res.status(400).json({ error: 'userId and password are required' });
    const uid = userId.trim().toLowerCase();
    const data = readData();
    const user = data.users ? data.users[uid] : null;
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    ensureUserStructure(user);
    const token = jwt.sign({ userId: uid }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: uid, preferences: user.preferences, northStarGoal: user.northStarGoal || '' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ TASK ROUTES ============

app.get('/api/tasks/:date', authenticate, (req, res) => {
  const data = readData();
  const user = ensureUserStructure(data.users[req.userId]);
  const tasks = user.tasks[req.params.date] || [emptyTaskSlot(), emptyTaskSlot(), emptyTaskSlot()];
  res.json({ tasks });
});

app.post('/api/tasks/:date', authenticate, (req, res) => {
  const MAX_TASKS = 5;
  const data = readData();
  data.users[req.userId] = ensureUserStructure(data.users[req.userId]);
  let tasks = req.body.tasks || [];
  if (tasks.length > MAX_TASKS) tasks = tasks.slice(0, MAX_TASKS);
  data.users[req.userId].tasks[req.params.date] = tasks;
  writeData(data);
  res.json({ success: true });
});

// Carry over (strict max 5 enforcement)
app.post('/api/carry-over', authenticate, (req, res) => {
  const MAX_TASKS = 5;
  const { sourceDate, targetDate } = req.body;
  if (!sourceDate || !targetDate) return res.status(400).json({ error: 'sourceDate and targetDate required' });

  const data = readData();
  data.users[req.userId] = ensureUserStructure(data.users[req.userId]);
  const user = data.users[req.userId];
  const sourceTasks = user.tasks[sourceDate] || [];
  const unfinished = sourceTasks.filter(t => t.text && t.text.trim() !== '' && t.status !== 'Done' && t.status !== 'Cancelled');

  if (unfinished.length === 0) {
    return res.json({ carried: 0, tasks: user.tasks[targetDate] || [emptyTaskSlot(), emptyTaskSlot(), emptyTaskSlot()] });
  }

  let targetTasks = user.tasks[targetDate] || [emptyTaskSlot(), emptyTaskSlot(), emptyTaskSlot()];

  // Calculate capacity: empty slots we can fill + new slots we can append (up to MAX)
  const emptySlots = targetTasks.filter(t => !t.text || t.text.trim() === '').length;
  const appendRoom = Math.max(0, MAX_TASKS - targetTasks.length);
  const capacity = emptySlots + appendRoom;

  // HARD BLOCK: if unfinished > capacity, refuse entirely
  if (unfinished.length > capacity) {
    return res.status(409).json({
      error: 'capacity_exceeded',
      message: `Capacity Reached: You only have room for ${capacity} more task(s) today. Please clear a slot or manually prioritize.`,
      capacity,
      unfinishedCount: unfinished.length,
      tasks: targetTasks
    });
  }

  // Smart insertion: fill empty slots first, then append up to MAX
  let carried = 0;
  for (const task of unfinished) {
    const carriedTask = { text: task.text, description: task.description || '', status: 'Todo', carryForwardCount: (task.carryForwardCount || 0) + 1 };
    const emptyIdx = targetTasks.findIndex(t => !t.text || t.text.trim() === '');
    if (emptyIdx !== -1) {
      targetTasks[emptyIdx] = carriedTask;
    } else if (targetTasks.length < MAX_TASKS) {
      targetTasks.push(carriedTask);
    } else {
      break;
    }
    carried++;
  }
  user.tasks[targetDate] = targetTasks;
  writeData(data);
  res.json({ carried, tasks: targetTasks });
});

app.get('/api/carry-over-check/:date', authenticate, (req, res) => {
  const MAX_TASKS = 5;
  const targetDate = req.params.date;
  const d = new Date(targetDate + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const data = readData();
  const user = ensureUserStructure(data.users[req.userId]);
  const sourceTasks = user.tasks[yesterday] || [];
  const unfinished = sourceTasks.filter(t => t.text && t.text.trim() !== '' && t.status !== 'Done' && t.status !== 'Cancelled');
  const targetTasks = user.tasks[targetDate] || [emptyTaskSlot(), emptyTaskSlot(), emptyTaskSlot()];
  const emptySlots = targetTasks.filter(t => !t.text || t.text.trim() === '').length;
  const appendRoom = Math.max(0, MAX_TASKS - targetTasks.length);
  const capacity = emptySlots + appendRoom;

  res.json({ hasUnfinished: unfinished.length > 0, count: unfinished.length, capacity, sourceDate: yesterday, tasks: unfinished });
});

// ============ DAILY DATA ROUTES (doNotDo, dailyReward, brainDump, antiToDo, reflection) ============

app.get('/api/daily-data/:date', authenticate, (req, res) => {
  const data = readData();
  const user = ensureUserStructure(data.users[req.userId]);
  const dd = user.dailyData[req.params.date] || emptyDailyData();
  res.json(dd);
});

app.post('/api/daily-data/:date', authenticate, (req, res) => {
  const data = readData();
  data.users[req.userId] = ensureUserStructure(data.users[req.userId]);
  const existing = data.users[req.userId].dailyData[req.params.date] || emptyDailyData();
  // Merge only provided fields
  const body = req.body;
  if (body.doNotDo !== undefined) existing.doNotDo = body.doNotDo;
  if (body.dailyReward !== undefined) existing.dailyReward = body.dailyReward;
  if (body.brainDump !== undefined) existing.brainDump = body.brainDump;
  if (body.antiToDo !== undefined) existing.antiToDo = body.antiToDo;
  if (body.reflectionWell !== undefined) existing.reflectionWell = body.reflectionWell;
  if (body.reflectionImprove !== undefined) existing.reflectionImprove = body.reflectionImprove;
  data.users[req.userId].dailyData[req.params.date] = existing;
  writeData(data);
  res.json({ success: true });
});

// ============ TASK DATES ============

app.get('/api/task-dates', authenticate, (req, res) => {
  const data = readData();
  const user = ensureUserStructure(data.users[req.userId]);
  const dateInfo = {};
  for (const [dateStr, tasks] of Object.entries(user.tasks)) {
    const filled = tasks.filter(t => t.text && t.text.trim() !== '');
    if (filled.length === 0) continue;
    const allDone = filled.every(t => t.status === 'Done');
    dateInfo[dateStr] = { hasTasks: true, allDone };
  }
  res.json({ dateInfo });
});

// ============ SETTINGS ROUTES ============

app.post('/api/settings/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new passwords required' });
    if (newPassword.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });

    const data = readData();
    const user = data.users[req.userId];
    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    writeData(data);
    res.json({ success: true });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/settings/preferences', authenticate, (req, res) => {
  const data = readData();
  data.users[req.userId] = ensureUserStructure(data.users[req.userId]);
  data.users[req.userId].preferences = { ...data.users[req.userId].preferences, ...req.body };
  writeData(data);
  res.json({ success: true, preferences: data.users[req.userId].preferences });
});

app.get('/api/settings/preferences', authenticate, (req, res) => {
  const data = readData();
  const user = ensureUserStructure(data.users[req.userId]);
  res.json({ preferences: user.preferences });
});

// North Star Goal
app.post('/api/settings/north-star', authenticate, (req, res) => {
  const data = readData();
  data.users[req.userId] = ensureUserStructure(data.users[req.userId]);
  data.users[req.userId].northStarGoal = req.body.northStarGoal || '';
  writeData(data);
  res.json({ success: true });
});

app.get('/api/settings/north-star', authenticate, (req, res) => {
  const data = readData();
  const user = ensureUserStructure(data.users[req.userId]);
  res.json({ northStarGoal: user.northStarGoal || '' });
});

// Export
app.get('/api/export', authenticate, (req, res) => {
  const data = readData();
  const user = ensureUserStructure(data.users[req.userId]);
  const exportData = {
    userId: req.userId,
    tasks: user.tasks,
    dailyData: user.dailyData,
    northStarGoal: user.northStarGoal,
    preferences: user.preferences,
    exportedAt: new Date().toISOString()
  };
  res.setHeader('Content-Disposition', `attachment; filename="taskmanager-${req.userId}-export.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(exportData);
});

// Import
app.post('/api/import', authenticate, (req, res) => {
  try {
    const importData = req.body;
    if (!importData || !importData.tasks) return res.status(400).json({ error: 'Invalid import data' });

    const data = readData();
    data.users[req.userId] = ensureUserStructure(data.users[req.userId]);
    if (importData.tasks) data.users[req.userId].tasks = importData.tasks;
    if (importData.dailyData) data.users[req.userId].dailyData = importData.dailyData;
    if (importData.northStarGoal !== undefined) data.users[req.userId].northStarGoal = importData.northStarGoal;
    if (importData.preferences) {
      data.users[req.userId].preferences = { ...data.users[req.userId].preferences, ...importData.preferences };
    }
    writeData(data);
    res.json({ success: true, message: 'Data imported successfully' });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ FALLBACK ============
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Task Manager server running on http://localhost:${PORT}`);
});
