require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tm_default_jwt_s3cret_k3y_2026';
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const SALT_ROUNDS = 10;
const MAX_TEXT_LENGTH = 500;
const MAX_DESC_LENGTH = 2000;
const MAX_IMPORT_DATES = 365;

// --- Security middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  }
}));

// General rate limit — 100 requests per 15 minutes per IP
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false }));

// Stricter rate limits for auth endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many attempts. Please try again later.' }, standardHeaders: true, legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { error: 'Too many registrations. Please try again later.' }, standardHeaders: true, legacyHeaders: false });

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Validation helpers ---
const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function isValidDate(d) { return DATE_REGEX.test(d); }

function sanitizeTask(t) {
  if (!t || typeof t !== 'object') return emptyTaskSlot();
  return {
    text: String(t.text || '').slice(0, MAX_TEXT_LENGTH),
    description: String(t.description || '').slice(0, MAX_DESC_LENGTH),
    status: ['Todo', 'In Progress', 'Done', 'Cancelled'].includes(t.status) ? t.status : 'Todo',
    carryForwardCount: Math.max(0, Math.min(100, parseInt(t.carryForwardCount) || 0))
  };
}

function validateDateParam(req, res, next) {
  const date = req.params.date;
  if (!isValidDate(date)) return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  next();
}

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
  if (!user.preferences) user.preferences = { darkMode: true, glassmorphism: true };
  if (!user.northStarGoal) user.northStarGoal = '';
  if (!user.ideaDump) user.ideaDump = [];
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

app.post('/api/register', registerLimiter, async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) return res.status(400).json({ error: 'userId and password are required' });
    const uid = userId.trim().toLowerCase();
    if (uid.length < 2 || uid.length > 30) return res.status(400).json({ error: 'userId must be 2-30 characters' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const data = readData();
    if (!data.users) data.users = {};
    if (data.users[uid]) return res.status(409).json({ error: 'User already exists' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    data.users[uid] = ensureUserStructure({
      passwordHash,
      preferences: { darkMode: true, glassmorphism: true },
      northStarGoal: '',
      tasks: {},
      dailyData: {},
      ideaDump: []
    });
    writeData(data);

    const token = jwt.sign({ userId: uid }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, userId: uid, preferences: data.users[uid].preferences, northStarGoal: '' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
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

app.get('/api/tasks/:date', authenticate, validateDateParam, (req, res) => {
  const data = readData();
  const user = ensureUserStructure(data.users[req.userId]);
  const tasks = user.tasks[req.params.date] || [emptyTaskSlot(), emptyTaskSlot(), emptyTaskSlot()];
  res.json({ tasks });
});

app.post('/api/tasks/:date', authenticate, validateDateParam, (req, res) => {
  const MAX_TASKS = 5;
  const data = readData();
  data.users[req.userId] = ensureUserStructure(data.users[req.userId]);
  let tasks = req.body.tasks || [];
  if (!Array.isArray(tasks)) return res.status(400).json({ error: 'tasks must be an array' });
  tasks = tasks.slice(0, MAX_TASKS).map(sanitizeTask);
  data.users[req.userId].tasks[req.params.date] = tasks;
  writeData(data);
  res.json({ success: true });
});

// Carry over (strict max 5 enforcement)
app.post('/api/carry-over', authenticate, (req, res) => {
  const MAX_TASKS = 5;
  const { sourceDate, targetDate } = req.body;
  if (!sourceDate || !targetDate) return res.status(400).json({ error: 'sourceDate and targetDate required' });
  if (!isValidDate(sourceDate) || !isValidDate(targetDate)) return res.status(400).json({ error: 'Invalid date format.' });

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

app.get('/api/carry-over-check/:date', authenticate, validateDateParam, (req, res) => {
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

app.get('/api/daily-data/:date', authenticate, validateDateParam, (req, res) => {
  const data = readData();
  const user = ensureUserStructure(data.users[req.userId]);
  const dd = user.dailyData[req.params.date] || emptyDailyData();
  res.json(dd);
});

app.post('/api/daily-data/:date', authenticate, validateDateParam, (req, res) => {
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
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

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

// ============ IDEA DUMP ROUTES ============

app.get('/api/ideas', authenticate, (req, res) => {
  const data = readData();
  const user = ensureUserStructure(data.users[req.userId]);
  res.json({ ideas: user.ideaDump || [] });
});

app.post('/api/ideas', authenticate, (req, res) => {
  const { title, body } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const data = readData();
  data.users[req.userId] = ensureUserStructure(data.users[req.userId]);
  const idea = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title: title.trim().slice(0, MAX_TEXT_LENGTH),
    body: (body || '').trim().slice(0, MAX_DESC_LENGTH),
    createdAt: new Date().toISOString()
  };
  data.users[req.userId].ideaDump.push(idea);
  writeData(data);
  res.status(201).json({ success: true, idea });
});

app.put('/api/ideas/:id', authenticate, (req, res) => {
  const { title, body } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const data = readData();
  data.users[req.userId] = ensureUserStructure(data.users[req.userId]);
  const idea = data.users[req.userId].ideaDump.find(i => i.id === req.params.id);
  if (!idea) return res.status(404).json({ error: 'Idea not found' });
  idea.title = title.trim().slice(0, MAX_TEXT_LENGTH);
  idea.body = (body || '').trim().slice(0, MAX_DESC_LENGTH);
  writeData(data);
  res.json({ success: true, idea });
});

app.delete('/api/ideas/:id', authenticate, (req, res) => {
  const data = readData();
  data.users[req.userId] = ensureUserStructure(data.users[req.userId]);
  const ideas = data.users[req.userId].ideaDump;
  const idx = ideas.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Idea not found' });
  ideas.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
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
    ideaDump: user.ideaDump || [],
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
    if (!importData || typeof importData !== 'object') return res.status(400).json({ error: 'Invalid import data' });
    if (!importData.tasks || typeof importData.tasks !== 'object') return res.status(400).json({ error: 'Import must contain tasks object' });

    // Validate and sanitize imported tasks
    const sanitizedTasks = {};
    const dateKeys = Object.keys(importData.tasks);
    if (dateKeys.length > MAX_IMPORT_DATES) return res.status(400).json({ error: `Import exceeds max ${MAX_IMPORT_DATES} dates` });
    for (const dateKey of dateKeys) {
      if (!isValidDate(dateKey)) continue; // skip invalid date keys
      const tasks = importData.tasks[dateKey];
      if (!Array.isArray(tasks)) continue;
      sanitizedTasks[dateKey] = tasks.slice(0, 5).map(sanitizeTask);
    }

    // Validate daily data if present
    const sanitizedDaily = {};
    if (importData.dailyData && typeof importData.dailyData === 'object') {
      for (const dateKey of Object.keys(importData.dailyData).slice(0, MAX_IMPORT_DATES)) {
        if (!isValidDate(dateKey)) continue;
        const dd = importData.dailyData[dateKey];
        if (!dd || typeof dd !== 'object') continue;
        sanitizedDaily[dateKey] = {
          doNotDo: Array.isArray(dd.doNotDo) ? dd.doNotDo.slice(0, 3).map(s => String(s || '').slice(0, MAX_TEXT_LENGTH)) : ['','',''],
          dailyReward: String(dd.dailyReward || '').slice(0, MAX_TEXT_LENGTH),
          brainDump: String(dd.brainDump || '').slice(0, MAX_DESC_LENGTH),
          antiToDo: Array.isArray(dd.antiToDo) ? dd.antiToDo.slice(0, 20).map(s => String(s || '').slice(0, MAX_TEXT_LENGTH)) : [],
          reflectionWell: String(dd.reflectionWell || '').slice(0, MAX_DESC_LENGTH),
          reflectionImprove: String(dd.reflectionImprove || '').slice(0, MAX_DESC_LENGTH)
        };
      }
    }

    const data = readData();
    data.users[req.userId] = ensureUserStructure(data.users[req.userId]);
    data.users[req.userId].tasks = sanitizedTasks;
    if (Object.keys(sanitizedDaily).length > 0) data.users[req.userId].dailyData = sanitizedDaily;
    if (typeof importData.northStarGoal === 'string') data.users[req.userId].northStarGoal = importData.northStarGoal.slice(0, MAX_TEXT_LENGTH);
    if (importData.preferences && typeof importData.preferences === 'object') {
      data.users[req.userId].preferences = {
        darkMode: !!importData.preferences.darkMode,
        glassmorphism: !!importData.preferences.glassmorphism
      };
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
