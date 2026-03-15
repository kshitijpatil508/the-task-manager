require("dotenv").config();
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const mongoose = require("mongoose");
const path = require("path");
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "tm_default_jwt_s3cret_k3y_2026";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "Admin@1234";
const SALT_ROUNDS = 10;
const MAX_TEXT_LENGTH = 500;
const MAX_DESC_LENGTH = 2000;
const MAX_IMPORT_DATES = 365;
// maximum number of tasks allowed per day (mirrors frontend's MAX_TASKS)
const DAILY_TASK_LIMIT = 5;

// MongoDB Connection
const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb://admin:password123@mongodb_container:27017/taskmanager?authSource=admin";
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("Connected to MongoDB via Mongoose"))
  .catch((err) => console.error("MongoDB connection error:", err));

// ========== SCHEMAS (Separate Collections) ==========

const UserSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    preferences: {
      type: mongoose.Schema.Types.Mixed,
      default: { darkMode: false },
    },
    northStarGoal: { type: String, default: "" },
    recoveryPin: { type: String, default: null },
    disabled: { type: Boolean, default: false },
    migrated: { type: Boolean, default: false },
    timerState: { type: Object, default: {} },
    createdAt: { type: Date, default: Date.now },
  },
  { minimize: false },
);

const TaskDaySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    date: { type: String, required: true },
    tasks: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { minimize: false },
);
TaskDaySchema.index({ userId: 1, date: 1 }, { unique: true });

const DailyDataSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    date: { type: String, required: true },
    doNotDo: { type: [String], default: ["", "", ""] },
    dailyReward: { type: String, default: "" },
    brainDump: { type: String, default: "" },
    antiToDo: { type: [String], default: [] },
    reflectionWell: { type: String, default: "" },
    reflectionImprove: { type: String, default: "" },
  },
  { minimize: false },
);
DailyDataSchema.index({ userId: 1, date: 1 }, { unique: true });

const IdeaSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  id: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});
IdeaSchema.index({ userId: 1, id: 1 }, { unique: true });

const IdeaTodoSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  id: { type: String, required: true },
  title: { type: String, required: true },
  completed: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
IdeaTodoSchema.index({ userId: 1, id: 1 }, { unique: true });

const NoteSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  id: { type: String, required: true },
  title: { type: String, required: true },
  content: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
NoteSchema.index({ userId: 1, id: 1 }, { unique: true });

const User = mongoose.model("User", UserSchema);
const TaskDay = mongoose.model("TaskDay", TaskDaySchema);
const DailyData = mongoose.model("DailyData", DailyDataSchema);
const Idea = mongoose.model("Idea", IdeaSchema);
const IdeaTodo = mongoose.model("IdeaTodo", IdeaTodoSchema);
const Note = mongoose.model("Note", NoteSchema);

// ========== MIGRATION (old single-doc → separate collections) ==========
async function migrateUser(user) {
  if (user.migrated) return;
  const uid = user.userId;
  try {
    // Migrate tasks (from Map)
    const rawUser = await mongoose.connection.db
      .collection("users")
      .findOne({ userId: uid });
    if (rawUser && rawUser.tasks && typeof rawUser.tasks === "object") {
      const ops = [];
      for (const [date, tasks] of Object.entries(rawUser.tasks)) {
        if (Array.isArray(tasks) && tasks.length > 0) {
          ops.push({
            updateOne: {
              filter: { userId: uid, date },
              update: { $setOnInsert: { userId: uid, date, tasks } },
              upsert: true,
            },
          });
        }
      }
      if (ops.length > 0) await TaskDay.bulkWrite(ops);
    }
    // Migrate dailyData
    if (rawUser && rawUser.dailyData && typeof rawUser.dailyData === "object") {
      const ops = [];
      for (const [date, dd] of Object.entries(rawUser.dailyData)) {
        if (dd && typeof dd === "object") {
          ops.push({
            updateOne: {
              filter: { userId: uid, date },
              update: { $setOnInsert: { userId: uid, date, ...dd } },
              upsert: true,
            },
          });
        }
      }
      if (ops.length > 0) await DailyData.bulkWrite(ops);
    }
    // Migrate ideaDump
    if (
      rawUser &&
      Array.isArray(rawUser.ideaDump) &&
      rawUser.ideaDump.length > 0
    ) {
      const ops = rawUser.ideaDump.map((idea) => ({
        updateOne: {
          filter: { userId: uid, id: idea.id },
          update: { $setOnInsert: { userId: uid, ...idea } },
          upsert: true,
        },
      }));
      await Idea.bulkWrite(ops);
    }
    // Migrate ideaTodos
    if (
      rawUser &&
      Array.isArray(rawUser.ideaTodos) &&
      rawUser.ideaTodos.length > 0
    ) {
      const ops = rawUser.ideaTodos.map((todo, index) => ({
        updateOne: {
          filter: { userId: uid, id: todo.id },
          update: {
            $setOnInsert: {
              userId: uid,
              ...todo,
              order: Number.isFinite(todo.order) ? todo.order : index,
            },
          },
          upsert: true,
        },
      }));
      await IdeaTodo.bulkWrite(ops);
    }
    // Migrate notes
    if (rawUser && Array.isArray(rawUser.notes) && rawUser.notes.length > 0) {
      const ops = rawUser.notes.map((note) => ({
        updateOne: {
          filter: { userId: uid, id: note.id },
          update: { $setOnInsert: { userId: uid, ...note } },
          upsert: true,
        },
      }));
      await Note.bulkWrite(ops);
    }
    // Mark migrated and unset old fields
    await mongoose.connection.db.collection("users").updateOne(
      { userId: uid },
      {
        $set: { migrated: true },
        $unset: {
          tasks: "",
          dailyData: "",
          ideaDump: "",
          ideaTodos: "",
          notes: "",
        },
      },
    );
    user.migrated = true;
    console.log(`Migrated user: ${uid}`);
  } catch (err) {
    console.error(`Migration error for ${uid}:`, err);
  }
}

// ========== SECURITY MIDDLEWARE ==========
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  }),
);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Global limiter — per-user (JWT) or per-IP
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      const p = req.path;
      // Exempt lightweight initialization endpoints to prevent lockouts on rapid refresh
      return (
        p === "/api/health" ||
        p === "/api/settings/preferences" ||
        p === "/api/settings/north-star" ||
        p === "/api/user"
      );
    },
    keyGenerator: (req) => {
      try {
        const auth = req.headers.authorization;
        if (auth && auth.startsWith("Bearer ")) {
          const decoded = jwt.verify(auth.split(" ")[1], JWT_SECRET);
          if (decoded && decoded.userId) return `user:${decoded.userId}`;
        }
      } catch {}
      return ipKeyGenerator(req);
    },
  }),
);

const checkPinBypass = async (req, res) => {
  if (req.body && req.body.userId && req.body.pin) {
    const uid = req.body.userId.trim().toLowerCase();
    const pin = req.body.pin.trim();
    if (/^\d{4}$/.test(pin)) {
      try {
        const user = await User.findOne({ userId: uid });
        if (user && user.recoveryPin) {
          const match = await bcrypt.compare(pin, user.recoveryPin);
          if (match) return true;
        }
      } catch (e) {
        return false;
      }
    }
  }
  return false;
};

// Per-user auth limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: checkPinBypass,
  keyGenerator: (req) => {
    const uid =
      req.body && req.body.userId ? req.body.userId.trim().toLowerCase() : null;
    return uid ? `login:${uid}` : `login-ip:${ipKeyGenerator(req)}`;
  },
});

// Per-user register limiter
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Too many registrations. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid =
      req.body && req.body.userId ? req.body.userId.trim().toLowerCase() : null;
    return uid ? `register:${uid}` : `register-ip:${ipKeyGenerator(req)}`;
  },
});

// ========== VALIDATION HELPERS ==========
const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function isValidDate(d) {
  return DATE_REGEX.test(d);
}
function isDateInPast(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = dateStr.split("-");
  const targetDate = new Date(year, month - 1, day);
  targetDate.setHours(0, 0, 0, 0);
  return targetDate < today;
}

function sanitizeTask(t) {
  if (!t || typeof t !== "object") return emptyTaskSlot();
  return {
    text: String(t.text || "").slice(0, MAX_TEXT_LENGTH),
    description: String(t.description || "").slice(0, MAX_DESC_LENGTH),
    status: ["Todo", "In Progress", "Done", "Cancelled"].includes(t.status)
      ? t.status
      : "Todo",
    carryForwardCount: Math.max(
      0,
      Math.min(100, parseInt(t.carryForwardCount) || 0),
    ),
  };
}

function validateDateParam(req, res, next) {
  if (!isValidDate(req.params.date))
    return res
      .status(400)
      .json({ error: "Invalid date format. Use YYYY-MM-DD." });
  next();
}

function emptyTaskSlot() {
  return { text: "", description: "", status: "Todo", carryForwardCount: 0 };
}

function emptyDailyData() {
  return {
    doNotDo: ["", "", ""],
    dailyReward: "",
    brainDump: "",
    antiToDo: [],
    reflectionWell: "",
    reflectionImprove: "",
  };
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ========== AUTH MIDDLEWARE ==========
async function authenticate(req, res, next) {
  let tokenStr = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer "))
    tokenStr = authHeader.split(" ")[1];
  else if (req.query.token) tokenStr = req.query.token;
  if (!tokenStr) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(tokenStr, JWT_SECRET);
    if (decoded.isAdmin)
      return res
        .status(401)
        .json({ error: "Admin tokens cannot access user routes" });
    req.userId = decoded.userId;
    const user = await User.findOne({ userId: req.userId });
    if (!user) return res.status(401).json({ error: "User not found" });
    if (user.disabled)
      return res
        .status(403)
        .json({ error: "Account is disabled. Contact admin." });
    if (!user.migrated) await migrateUser(user);
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ========== AUTH ROUTES ==========

app.post("/api/register", registerLimiter, async (req, res) => {
  try {
    const { userId, password, pin } = req.body;
    if (!userId || !password)
      return res
        .status(400)
        .json({ error: "userId and password are required" });
    const uid = userId.trim().toLowerCase();
    if (uid.length < 2 || uid.length > 30)
      return res.status(400).json({ error: "userId must be 2-30 characters" });
    if (password.length < 8)
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });

    let hashedPin = null;
    if (pin) {
      if (!/^\d{4}$/.test(pin))
        return res.status(400).json({ error: "PIN must be exactly 4 digits" });
      hashedPin = await bcrypt.hash(pin, SALT_ROUNDS);
    }

    const existingUser = await User.findOne({ userId: uid });
    if (existingUser)
      return res.status(409).json({ error: "User already exists" });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = new User({
      userId: uid,
      passwordHash,
      recoveryPin: hashedPin,
      preferences: { darkMode: false },
      northStarGoal: "",
      migrated: true,
    });
    await newUser.save();

    const token = jwt.sign({ userId: uid }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({
      token,
      userId: uid,
      preferences: newUser.preferences,
      northStarGoal: "",
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password)
      return res
        .status(400)
        .json({ error: "userId and password are required" });
    const uid = userId.trim().toLowerCase();

    const user = await User.findOne({ userId: uid });
    if (!user)
      return res.status(401).json({ error: "No user found, please register." });
    if (!user.passwordHash)
      return res.status(401).json({ error: "Invalid credentials" });
    if (user.disabled)
      return res
        .status(403)
        .json({ error: "Account is disabled. Contact admin." });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    // Run migration if needed
    if (!user.migrated) await migrateUser(user);

    const token = jwt.sign({ userId: uid }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
      token,
      userId: uid,
      preferences: user.preferences,
      northStarGoal: user.northStarGoal || "",
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========== TASK ROUTES ==========

app.get(
  "/api/tasks/:date",
  authenticate,
  validateDateParam,
  async (req, res) => {
    const doc = await TaskDay.findOne({
      userId: req.userId,
      date: req.params.date,
    });
    let tasks = doc
      ? Array.isArray(doc.tasks)
        ? doc.tasks.slice(0, DAILY_TASK_LIMIT)
        : []
      : [];
    // ensure base slots for new day
    if (!doc) tasks = [emptyTaskSlot(), emptyTaskSlot(), emptyTaskSlot()];
    res.json({ tasks });
  },
);

app.post(
  "/api/tasks/:date",
  authenticate,
  validateDateParam,
  async (req, res) => {
    if (isDateInPast(req.params.date))
      return res
        .status(403)
        .json({ error: "Cannot modify tasks for past dates." });
    let tasks = req.body.tasks || [];
    if (!Array.isArray(tasks))
      return res.status(400).json({ error: "tasks must be an array" });
    tasks = tasks.slice(0, DAILY_TASK_LIMIT).map(sanitizeTask);

    await TaskDay.findOneAndUpdate(
      { userId: req.userId, date: req.params.date },
      { $set: { tasks } },
      { upsert: true, new: true },
    );
    res.json({ success: true });
  },
);

app.post("/api/carry-over", authenticate, async (req, res) => {
  const { sourceDate, targetDate } = req.body;
  if (!sourceDate || !targetDate)
    return res
      .status(400)
      .json({ error: "sourceDate and targetDate required" });
  if (!isValidDate(sourceDate) || !isValidDate(targetDate))
    return res.status(400).json({ error: "Invalid date format." });

  const sourceDoc = await TaskDay.findOne({
    userId: req.userId,
    date: sourceDate,
  });
  const sourceTasks = sourceDoc ? sourceDoc.tasks : [];
  const unfinished = sourceTasks.filter(
    (t) =>
      t.text &&
      t.text.trim() !== "" &&
      t.status !== "Done" &&
      t.status !== "Cancelled",
  );

  const targetDoc = await TaskDay.findOne({
    userId: req.userId,
    date: targetDate,
  });
  let targetTasks = targetDoc
    ? targetDoc.tasks
    : [emptyTaskSlot(), emptyTaskSlot(), emptyTaskSlot()];
  // trim any legacy array that might accidentally exceed limit
  if (targetTasks.length > DAILY_TASK_LIMIT)
    targetTasks = targetTasks.slice(0, DAILY_TASK_LIMIT);

  if (unfinished.length === 0)
    return res.json({ carried: 0, tasks: targetTasks });

  const emptySlots = targetTasks.filter(
    (t) => !t.text || t.text.trim() === "",
  ).length;
  const appendRoom = Math.max(0, DAILY_TASK_LIMIT - targetTasks.length);
  const capacity = emptySlots + appendRoom;

  if (unfinished.length > capacity) {
    return res.status(409).json({
      error: "capacity_exceeded",
      message: `Capacity Reached: You only have room for ${capacity} more task(s) today.`,
      capacity,
      unfinishedCount: unfinished.length,
      tasks: targetTasks,
    });
  }

  let carried = 0;
  for (const task of unfinished) {
    const carriedTask = {
      text: task.text,
      description: task.description || "",
      status: "Todo",
      carryForwardCount: (task.carryForwardCount || 0) + 1,
    };
    const emptyIdx = targetTasks.findIndex(
      (t) => !t.text || t.text.trim() === "",
    );
    if (emptyIdx !== -1) targetTasks[emptyIdx] = carriedTask;
    else if (targetTasks.length < DAILY_TASK_LIMIT)
      targetTasks.push(carriedTask);
    else break;
    carried++;
  }
  await TaskDay.findOneAndUpdate(
    { userId: req.userId, date: targetDate },
    { $set: { tasks: targetTasks } },
    { upsert: true },
  );
  res.json({ carried, tasks: targetTasks });
});

app.get(
  "/api/carry-over-check/:date",
  authenticate,
  validateDateParam,
  async (req, res) => {
    const targetDate = req.params.date;
    const d = new Date(targetDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const sourceDoc = await TaskDay.findOne({
      userId: req.userId,
      date: yesterday,
    });
    const sourceTasks = sourceDoc ? sourceDoc.tasks : [];
    const unfinished = sourceTasks.filter(
      (t) =>
        t.text &&
        t.text.trim() !== "" &&
        t.status !== "Done" &&
        t.status !== "Cancelled",
    );

    const targetDoc = await TaskDay.findOne({
      userId: req.userId,
      date: targetDate,
    });
    let targetTasks = targetDoc
      ? targetDoc.tasks
      : [emptyTaskSlot(), emptyTaskSlot(), emptyTaskSlot()];
    if (targetTasks.length > DAILY_TASK_LIMIT)
      targetTasks = targetTasks.slice(0, DAILY_TASK_LIMIT);
    const emptySlots = targetTasks.filter(
      (t) => !t.text || t.text.trim() === "",
    ).length;
    const appendRoom = Math.max(0, DAILY_TASK_LIMIT - targetTasks.length);
    const capacity = emptySlots + appendRoom;

    res.json({
      hasUnfinished: unfinished.length > 0,
      count: unfinished.length,
      capacity,
      sourceDate: yesterday,
      tasks: unfinished,
    });
  },
);

// ========== DAILY DATA ROUTES ==========

app.get(
  "/api/daily-data/:date",
  authenticate,
  validateDateParam,
  async (req, res) => {
    const doc = await DailyData.findOne({
      userId: req.userId,
      date: req.params.date,
    });
    res.json(
      doc
        ? {
            doNotDo: doc.doNotDo,
            dailyReward: doc.dailyReward,
            brainDump: doc.brainDump,
            antiToDo: doc.antiToDo,
            reflectionWell: doc.reflectionWell,
            reflectionImprove: doc.reflectionImprove,
          }
        : emptyDailyData(),
    );
  },
);

app.post(
  "/api/daily-data/:date",
  authenticate,
  validateDateParam,
  async (req, res) => {
    if (isDateInPast(req.params.date))
      return res
        .status(403)
        .json({ error: "Cannot modify daily data for past dates." });

    const updateFields = {};
    const body = req.body;
    if (body.doNotDo !== undefined) updateFields.doNotDo = body.doNotDo;
    if (body.dailyReward !== undefined)
      updateFields.dailyReward = body.dailyReward;
    if (body.brainDump !== undefined) updateFields.brainDump = body.brainDump;
    if (body.antiToDo !== undefined) updateFields.antiToDo = body.antiToDo;
    if (body.reflectionWell !== undefined)
      updateFields.reflectionWell = body.reflectionWell;
    if (body.reflectionImprove !== undefined)
      updateFields.reflectionImprove = body.reflectionImprove;

    await DailyData.findOneAndUpdate(
      { userId: req.userId, date: req.params.date },
      { $set: updateFields },
      { upsert: true },
    );
    res.json({ success: true });
  },
);

// ========== TASK DATES ==========

app.get("/api/task-dates", authenticate, async (req, res) => {
  const taskDays = await TaskDay.find(
    { userId: req.userId },
    { date: 1, tasks: 1, _id: 0 },
  );
  const dateInfo = {};
  for (const doc of taskDays) {
    const filled = doc.tasks.filter((t) => t.text && t.text.trim() !== "");
    if (filled.length === 0) continue;
    const allDone = filled.every((t) => t.status === "Done");
    dateInfo[doc.date] = { hasTasks: true, allDone };
  }
  res.json({ dateInfo });
});

// ========== SETTINGS ROUTES ==========

app.post("/api/settings/password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res
        .status(400)
        .json({ error: "Current and new passwords required" });
    if (newPassword.length < 8)
      return res
        .status(400)
        .json({ error: "New password must be at least 8 characters" });

    const match = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!match)
      return res.status(401).json({ error: "Current password is incorrect" });

    req.user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await req.user.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Password change error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/settings/preferences", authenticate, async (req, res) => {
  req.user.preferences = { ...req.user.preferences, ...req.body };
  req.user.markModified("preferences");
  await req.user.save();
  res.json({ success: true, preferences: req.user.preferences });
});

app.get("/api/settings/preferences", authenticate, (req, res) => {
  res.json({ preferences: req.user.preferences });
});

app.delete("/api/account", authenticate, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required" });
    const match = await bcrypt.compare(password, req.user.passwordHash);
    if (!match) return res.status(401).json({ error: "Incorrect password" });

    const uid = req.user.userId;
    await Promise.all([
      User.deleteOne({ userId: uid }),
      TaskDay.deleteMany({ userId: uid }),
      DailyData.deleteMany({ userId: uid }),
      Idea.deleteMany({ userId: uid }),
      IdeaTodo.deleteMany({ userId: uid }),
      Note.deleteMany({ userId: uid }),
    ]);
    res.json({ success: true, message: "Account deleted forever" });
  } catch (err) {
    console.error("Account delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/settings/north-star", authenticate, async (req, res) => {
  req.user.northStarGoal = req.body.northStarGoal || "";
  await req.user.save();
  res.json({ success: true });
});

app.get("/api/settings/north-star", authenticate, (req, res) => {
  res.json({ northStarGoal: req.user.northStarGoal || "" });
});

// ========== IDEA DUMP ROUTES ==========

app.get("/api/ideas", authenticate, async (req, res) => {
  const ideas = await Idea.find(
    { userId: req.userId },
    { _id: 0, userId: 0, __v: 0 },
  ).sort({ createdAt: 1 });
  res.json({ ideas });
});

app.post("/api/ideas", authenticate, async (req, res) => {
  const { title, body } = req.body;
  if (!title || typeof title !== "string" || !title.trim())
    return res.status(400).json({ error: "Title is required" });
  const idea = new Idea({
    userId: req.userId,
    id: genId(),
    title: title.trim().slice(0, MAX_TEXT_LENGTH),
    body: (body || "").trim().slice(0, MAX_DESC_LENGTH),
  });
  await idea.save();
  res.status(201).json({
    success: true,
    idea: {
      id: idea.id,
      title: idea.title,
      body: idea.body,
      createdAt: idea.createdAt,
    },
  });
});

app.put("/api/ideas/:id", authenticate, async (req, res) => {
  const { title, body } = req.body;
  if (!title || typeof title !== "string" || !title.trim())
    return res.status(400).json({ error: "Title is required" });
  const idea = await Idea.findOne({ userId: req.userId, id: req.params.id });
  if (!idea) return res.status(404).json({ error: "Idea not found" });
  idea.title = title.trim().slice(0, MAX_TEXT_LENGTH);
  idea.body = (body || "").trim().slice(0, MAX_DESC_LENGTH);
  await idea.save();
  res.json({
    success: true,
    idea: {
      id: idea.id,
      title: idea.title,
      body: idea.body,
      createdAt: idea.createdAt,
    },
  });
});

app.delete("/api/ideas/:id", authenticate, async (req, res) => {
  const result = await Idea.deleteOne({
    userId: req.userId,
    id: req.params.id,
  });
  if (result.deletedCount === 0)
    return res.status(404).json({ error: "Idea not found" });
  res.json({ success: true });
});

// ========== IDEA TODO ROUTES ==========

app.get("/api/idea-todos", authenticate, async (req, res) => {
  const todos = await IdeaTodo.find(
    { userId: req.userId },
    { _id: 0, userId: 0, __v: 0 },
  ).sort({ order: 1, createdAt: 1 });
  res.json({ ideaTodos: todos });
});

app.post("/api/idea-todos", authenticate, async (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== "string" || !title.trim())
    return res.status(400).json({ error: "Title is required" });
  const lastTodo = await IdeaTodo.findOne(
    { userId: req.userId },
    { order: 1, _id: 0 },
  ).sort({ order: -1, createdAt: -1 });

  const todo = new IdeaTodo({
    userId: req.userId,
    id: genId(),
    title: title.trim().slice(0, MAX_TEXT_LENGTH),
    order: typeof lastTodo?.order === "number" ? lastTodo.order + 1 : 0,
  });
  await todo.save();
  res.status(201).json({
    success: true,
    todo: {
      id: todo.id,
      title: todo.title,
      completed: todo.completed,
      order: todo.order,
      createdAt: todo.createdAt,
    },
  });
});

app.post("/api/idea-todos/reorder", authenticate, async (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res
      .status(400)
      .json({ error: "orderedIds must be a non-empty array" });
  }

  const todos = await IdeaTodo.find({ userId: req.userId }, { id: 1, _id: 0 });
  if (orderedIds.length !== todos.length) {
    return res.status(400).json({ error: "orderedIds length mismatch" });
  }

  const existingIdSet = new Set(todos.map((todo) => todo.id));
  const incomingIdSet = new Set(orderedIds);
  if (
    incomingIdSet.size !== orderedIds.length ||
    orderedIds.some((id) => !existingIdSet.has(id))
  ) {
    return res.status(400).json({ error: "orderedIds contain invalid IDs" });
  }

  const ops = orderedIds.map((id, index) => ({
    updateOne: {
      filter: { userId: req.userId, id },
      update: { $set: { order: index } },
    },
  }));
  if (ops.length > 0) await IdeaTodo.bulkWrite(ops);

  res.json({ success: true });
});

app.put("/api/idea-todos/:id", authenticate, async (req, res) => {
  const { title, completed, order } = req.body;
  const todo = await IdeaTodo.findOne({
    userId: req.userId,
    id: req.params.id,
  });
  if (!todo) return res.status(404).json({ error: "Todo not found" });
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim())
      return res.status(400).json({ error: "Title cannot be empty" });
    todo.title = title.trim().slice(0, MAX_TEXT_LENGTH);
  }
  if (completed !== undefined) todo.completed = !!completed;
  if (order !== undefined && Number.isFinite(order)) {
    todo.order = order;
  }
  await todo.save();
  res.json({
    success: true,
    todo: {
      id: todo.id,
      title: todo.title,
      completed: todo.completed,
      order: todo.order,
      createdAt: todo.createdAt,
    },
  });
});

app.delete("/api/idea-todos/:id", authenticate, async (req, res) => {
  const result = await IdeaTodo.deleteOne({
    userId: req.userId,
    id: req.params.id,
  });
  if (result.deletedCount === 0)
    return res.status(404).json({ error: "Todo not found" });
  res.json({ success: true });
});

// ========== NOTES ROUTES ==========

app.get("/api/notes", authenticate, async (req, res) => {
  const notes = await Note.find(
    { userId: req.userId },
    { _id: 0, userId: 0, __v: 0 },
  ).sort({ createdAt: 1 });
  res.json({ notes });
});

app.post("/api/notes", authenticate, async (req, res) => {
  const { title, content } = req.body;
  if (!title || typeof title !== "string" || !title.trim())
    return res.status(400).json({ error: "Title is required" });
  const note = new Note({
    userId: req.userId,
    id: genId(),
    title: title.trim().slice(0, MAX_TEXT_LENGTH),
    content: (content || "").slice(0, 10000),
  });
  await note.save();
  res.status(201).json({
    success: true,
    note: {
      id: note.id,
      title: note.title,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
  });
});

app.put("/api/notes/:id", authenticate, async (req, res) => {
  const { title, content } = req.body;
  const note = await Note.findOne({ userId: req.userId, id: req.params.id });
  if (!note) return res.status(404).json({ error: "Note not found" });
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim())
      return res.status(400).json({ error: "Title cannot be empty" });
    note.title = title.trim().slice(0, MAX_TEXT_LENGTH);
  }
  if (content !== undefined) note.content = String(content).slice(0, 10000);
  note.updatedAt = new Date();
  await note.save();
  res.json({
    success: true,
    note: {
      id: note.id,
      title: note.title,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
  });
});

app.delete("/api/notes/:id", authenticate, async (req, res) => {
  const result = await Note.deleteOne({
    userId: req.userId,
    id: req.params.id,
  });
  if (result.deletedCount === 0)
    return res.status(404).json({ error: "Note not found" });
  res.json({ success: true });
});

// ========== TIMER SYNC ==========
app.get("/api/timer", authenticate, async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.userId }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ timerState: user.timerState || {} });
  } catch (err) {
    res.status(500).json({ error: "Server error retrieving timer state" });
  }
});

app.post("/api/timer", authenticate, async (req, res) => {
  try {
    await User.updateOne(
      { userId: req.userId },
      { $set: { timerState: req.body } },
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error saving timer state" });
  }
});

// ========== EXPORT ==========
app.get("/api/export", authenticate, async (req, res) => {
  const uid = req.userId;
  const [taskDays, dailyDays, ideas, ideaTodos, notes] = await Promise.all([
    TaskDay.find({ userId: uid }, { _id: 0, userId: 0, __v: 0 }),
    DailyData.find({ userId: uid }, { _id: 0, userId: 0, __v: 0 }),
    Idea.find({ userId: uid }, { _id: 0, userId: 0, __v: 0 }),
    IdeaTodo.find({ userId: uid }, { _id: 0, userId: 0, __v: 0 }),
    Note.find({ userId: uid }, { _id: 0, userId: 0, __v: 0 }),
  ]);

  const tasksObj = {};
  taskDays.forEach((d) => {
    tasksObj[d.date] = d.tasks;
  });
  const dailyObj = {};
  dailyDays.forEach((d) => {
    dailyObj[d.date] = {
      doNotDo: d.doNotDo,
      dailyReward: d.dailyReward,
      brainDump: d.brainDump,
      antiToDo: d.antiToDo,
      reflectionWell: d.reflectionWell,
      reflectionImprove: d.reflectionImprove,
    };
  });

  const exportData = {
    userId: uid,
    tasks: tasksObj,
    dailyData: dailyObj,
    northStarGoal: req.user.northStarGoal,
    preferences: req.user.preferences,
    ideaDump: ideas,
    ideaTodos,
    notes,
    exportedAt: new Date().toISOString(),
  };
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="taskmanager-${uid}-export.json"`,
  );
  res.setHeader("Content-Type", "application/json");
  res.json(exportData);
});

// ========== IMPORT ==========
app.post(
  "/api/import",
  authenticate,
  upload.single("importFile"),
  async (req, res) => {
    try {
      let importData;
      if (req.file) {
        try {
          importData = JSON.parse(req.file.buffer.toString("utf8"));
        } catch {
          return res.status(400).json({ error: "Invalid JSON file" });
        }
      } else {
        importData = req.body;
      }
      if (!importData || typeof importData !== "object")
        return res.status(400).json({ error: "Invalid import data" });
      if (!importData.tasks || typeof importData.tasks !== "object")
        return res
          .status(400)
          .json({ error: "Import must contain tasks object" });

      const uid = req.userId;

      // Import tasks
      const dateKeys = Object.keys(importData.tasks);
      if (dateKeys.length > MAX_IMPORT_DATES)
        return res
          .status(400)
          .json({ error: `Import exceeds max ${MAX_IMPORT_DATES} dates` });
      for (const dateKey of dateKeys) {
        if (!isValidDate(dateKey)) continue;
        const tasks = importData.tasks[dateKey];
        if (!Array.isArray(tasks)) continue;
        const sanitized = tasks.slice(0, DAILY_TASK_LIMIT).map(sanitizeTask);
        await TaskDay.findOneAndUpdate(
          { userId: uid, date: dateKey },
          { $set: { tasks: sanitized } },
          { upsert: true },
        );
      }

      // Import dailyData
      if (importData.dailyData && typeof importData.dailyData === "object") {
        for (const dateKey of Object.keys(importData.dailyData).slice(
          0,
          MAX_IMPORT_DATES,
        )) {
          if (!isValidDate(dateKey)) continue;
          const dd = importData.dailyData[dateKey];
          if (!dd || typeof dd !== "object") continue;
          await DailyData.findOneAndUpdate(
            { userId: uid, date: dateKey },
            {
              $set: {
                doNotDo: Array.isArray(dd.doNotDo)
                  ? dd.doNotDo
                      .slice(0, 3)
                      .map((s) => String(s || "").slice(0, MAX_TEXT_LENGTH))
                  : ["", "", ""],
                dailyReward: String(dd.dailyReward || "").slice(
                  0,
                  MAX_TEXT_LENGTH,
                ),
                brainDump: String(dd.brainDump || "").slice(0, MAX_DESC_LENGTH),
                antiToDo: Array.isArray(dd.antiToDo)
                  ? dd.antiToDo
                      .slice(0, 20)
                      .map((s) => String(s || "").slice(0, MAX_TEXT_LENGTH))
                  : [],
                reflectionWell: String(dd.reflectionWell || "").slice(
                  0,
                  MAX_DESC_LENGTH,
                ),
                reflectionImprove: String(dd.reflectionImprove || "").slice(
                  0,
                  MAX_DESC_LENGTH,
                ),
              },
            },
            { upsert: true },
          );
        }
      }

      // Import northStarGoal & preferences
      if (typeof importData.northStarGoal === "string")
        req.user.northStarGoal = importData.northStarGoal.slice(
          0,
          MAX_TEXT_LENGTH,
        );
      if (
        importData.preferences &&
        typeof importData.preferences === "object"
      ) {
        req.user.preferences = { darkMode: !!importData.preferences.darkMode };
        req.user.markModified("preferences");
      }

      // Import ideas
      if (Array.isArray(importData.ideaDump)) {
        for (const idea of importData.ideaDump) {
          if (!idea || !idea.id) continue;
          await Idea.findOneAndUpdate(
            { userId: uid, id: idea.id },
            {
              $setOnInsert: {
                userId: uid,
                id: idea.id,
                title: idea.title || "",
                body: idea.body || "",
                createdAt: idea.createdAt || new Date(),
              },
            },
            { upsert: true },
          );
        }
      }
      // Import ideaTodos
      if (Array.isArray(importData.ideaTodos)) {
        for (const [index, todo] of importData.ideaTodos.entries()) {
          if (!todo || !todo.id) continue;
          await IdeaTodo.findOneAndUpdate(
            { userId: uid, id: todo.id },
            {
              $setOnInsert: {
                userId: uid,
                id: todo.id,
                title: todo.title || "",
                completed: !!todo.completed,
                order: Number.isFinite(todo.order) ? todo.order : index,
                createdAt: todo.createdAt || new Date(),
              },
            },
            { upsert: true },
          );
        }
      }
      // Import notes
      if (Array.isArray(importData.notes)) {
        for (const note of importData.notes) {
          if (!note || !note.id) continue;
          await Note.findOneAndUpdate(
            { userId: uid, id: note.id },
            {
              $setOnInsert: {
                userId: uid,
                id: note.id,
                title: note.title || "",
                content: note.content || "",
                createdAt: note.createdAt || new Date(),
                updatedAt: note.updatedAt || new Date(),
              },
            },
            { upsert: true },
          );
        }
      }

      await req.user.save();
      res.json({ success: true, message: "Data imported successfully" });
    } catch (err) {
      console.error("Import error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// ========== ADMIN ROUTES ==========

function authenticateAdmin(req, res, next) {
  let tokenStr = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer "))
    tokenStr = authHeader.split(" ")[1];
  else if (req.query.token) tokenStr = req.query.token;
  if (!tokenStr) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(tokenStr, JWT_SECRET);
    if (!decoded.isAdmin)
      return res.status(403).json({ error: "Admin access required" });
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Username and password required" });
  if (username !== ADMIN_USER || password !== ADMIN_PASS)
    return res.status(401).json({ error: "Invalid admin credentials" });
  const token = jwt.sign({ isAdmin: true, username }, JWT_SECRET, {
    expiresIn: "4h",
  });
  res.json({ token, username });
});

app.get("/api/admin/users", authenticateAdmin, async (req, res) => {
  const users = await User.find({}, { passwordHash: 0, __v: 0 }).sort({
    createdAt: -1,
  });
  // Get counts for each user
  const result = [];
  for (const u of users) {
    const [taskCount, noteCount, ideaCount] = await Promise.all([
      TaskDay.countDocuments({ userId: u.userId }),
      Note.countDocuments({ userId: u.userId }),
      Idea.countDocuments({ userId: u.userId }),
    ]);
    result.push({
      userId: u.userId,
      disabled: !!u.disabled,
      migrated: !!u.migrated,
      hasPin: !!u.recoveryPin,
      createdAt: u.createdAt,
      stats: { taskDays: taskCount, notes: noteCount, ideas: ideaCount },
    });
  }
  res.json({ users: result });
});

app.post("/api/admin/users", authenticateAdmin, async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password)
      return res.status(400).json({ error: "userId and password required" });
    const uid = userId.trim().toLowerCase();
    if (uid.length < 2 || uid.length > 30)
      return res.status(400).json({ error: "userId must be 2-30 characters" });
    if (password.length < 8)
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });

    const existing = await User.findOne({ userId: uid });
    if (existing) return res.status(409).json({ error: "User already exists" });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = new User({ userId: uid, passwordHash, migrated: true });
    await newUser.save();
    res.status(201).json({ success: true, userId: uid });
  } catch (err) {
    console.error("Admin create user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/admin/users/:userId", authenticateAdmin, async (req, res) => {
  const user = await User.findOne({ userId: req.params.userId });
  if (!user) return res.status(404).json({ error: "User not found" });

  const { newPassword, resetPin } = req.body;
  if (newPassword) {
    if (newPassword.length < 8)
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  }
  if (resetPin === true) user.recoveryPin = null;

  await user.save();
  res.json({ success: true });
});

app.delete("/api/admin/users/:userId", authenticateAdmin, async (req, res) => {
  const uid = req.params.userId;
  const user = await User.findOne({ userId: uid });
  if (!user) return res.status(404).json({ error: "User not found" });

  await Promise.all([
    User.deleteOne({ userId: uid }),
    TaskDay.deleteMany({ userId: uid }),
    DailyData.deleteMany({ userId: uid }),
    Idea.deleteMany({ userId: uid }),
    IdeaTodo.deleteMany({ userId: uid }),
    Note.deleteMany({ userId: uid }),
  ]);
  res.json({ success: true });
});

app.post(
  "/api/admin/users/:userId/toggle",
  authenticateAdmin,
  async (req, res) => {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) return res.status(404).json({ error: "User not found" });
    user.disabled = !user.disabled;
    await user.save();
    res.json({ success: true, disabled: user.disabled });
  },
);

app.get(
  "/api/admin/users/:userId/export",
  authenticateAdmin,
  async (req, res) => {
    const uid = req.params.userId;
    const user = await User.findOne({ userId: uid });
    if (!user) return res.status(404).json({ error: "User not found" });

    const [taskDays, dailyDays, ideas, ideaTodos, notes] = await Promise.all([
      TaskDay.find({ userId: uid }, { _id: 0, userId: 0, __v: 0 }),
      DailyData.find({ userId: uid }, { _id: 0, userId: 0, __v: 0 }),
      Idea.find({ userId: uid }, { _id: 0, userId: 0, __v: 0 }),
      IdeaTodo.find({ userId: uid }, { _id: 0, userId: 0, __v: 0 }),
      Note.find({ userId: uid }, { _id: 0, userId: 0, __v: 0 }),
    ]);

    const tasksObj = {};
    taskDays.forEach((d) => {
      tasksObj[d.date] = d.tasks;
    });
    const dailyObj = {};
    dailyDays.forEach((d) => {
      dailyObj[d.date] = {
        doNotDo: d.doNotDo,
        dailyReward: d.dailyReward,
        brainDump: d.brainDump,
        antiToDo: d.antiToDo,
        reflectionWell: d.reflectionWell,
        reflectionImprove: d.reflectionImprove,
      };
    });

    const exportData = {
      userId: uid,
      tasks: tasksObj,
      dailyData: dailyObj,
      northStarGoal: user.northStarGoal,
      preferences: user.preferences,
      ideaDump: ideas,
      ideaTodos,
      notes,
      exportedAt: new Date().toISOString(),
    };
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="taskmanager-${uid}-export.json"`,
    );
    res.setHeader("Content-Type", "application/json");
    res.json(exportData);
  },
);

// Serve admin page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ========== FALLBACK ==========
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Task Manager server running on http://localhost:${PORT}`);
});
