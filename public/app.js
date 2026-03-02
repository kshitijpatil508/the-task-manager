// ===== STATE =====
let token = localStorage.getItem('tm_token') || '';
let currentUserId = localStorage.getItem('tm_userId') || '';
let selectedDate = new Date();
let calendarDate = new Date();
let taskDateInfo = {};
let debounceTimers = {};
let currentTasks = [];
let currentDailyData = { doNotDo: ['','',''], dailyReward: '', brainDump: '', antiToDo: [], reflectionWell: '', reflectionImprove: '' };
let northStarGoal = '';
let currentIdeas = [];
let currentIdeaTodos = [];
let currentView = 'dashboard'; // 'dashboard' | 'ideas'
const MAX_TASKS = 5;
const DEFAULT_TASKS = 3;

// ===== HELPERS =====
function fmt(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function headers() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }; }
function debounce(key, fn, ms = 800) { clearTimeout(debounceTimers[key]); debounceTimers[key] = setTimeout(fn, ms); }
function showSaved(id) { const el = document.getElementById(id); if (!el) return; el.style.opacity = '1'; setTimeout(() => el.style.opacity = '0', 1500); }
function escHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ===== AUTH =====
function switchAuthTab(tab) {
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}
document.getElementById('tab-login').addEventListener('click', () => switchAuthTab('login'));
document.getElementById('tab-register').addEventListener('click', () => switchAuthTab('register'));

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error'); errEl.classList.add('hidden');
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: document.getElementById('login-userId').value, password: document.getElementById('login-password').value }) });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
    loginSuccess(data);
  } catch { errEl.textContent = 'Connection error'; errEl.classList.remove('hidden'); }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('register-error'); errEl.classList.add('hidden');
  const pw = document.getElementById('register-password').value;
  if (pw !== document.getElementById('register-confirm').value) { errEl.textContent = 'Passwords do not match'; errEl.classList.remove('hidden'); return; }
  try {
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: document.getElementById('register-userId').value, password: pw }) });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
    loginSuccess(data);
  } catch { errEl.textContent = 'Connection error'; errEl.classList.remove('hidden'); }
});

function loginSuccess(data) {
  token = data.token; currentUserId = data.userId; northStarGoal = data.northStarGoal || '';
  localStorage.setItem('tm_token', token); localStorage.setItem('tm_userId', currentUserId);
  applyPreferences(data.preferences || {}); showDashboard();
}

function applyPreferences(prefs) {
  document.documentElement.classList.toggle('dark', !!prefs.darkMode);
  document.body.classList.toggle('glassmorphism', !!prefs.glassmorphism);
}

function showDashboard() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('user-badge').textContent = currentUserId;
  updateNorthStarDisplay(); loadDay(); buildCalendar(); loadTaskDates(); checkCarryOver();
}

// ===== NAVIGATION =====
function switchView(view) {
  currentView = view;
  const dashView = document.getElementById('dashboard-view');
  const ideasView = document.getElementById('ideas-view');

  dashView.classList.toggle('hidden', view !== 'dashboard');
  ideasView.classList.toggle('hidden', view !== 'ideas');

  // Update all nav tabs (both desktop and mobile)
  document.querySelectorAll('.app-nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  if (view === 'ideas') {
    loadIdeas();
    loadIdeaTodos();
  }
}

// Bind navigation tabs
document.querySelectorAll('.app-nav-tab').forEach(tab => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

// ===== NORTH STAR =====
function updateNorthStarDisplay() {
  const el = document.getElementById('north-star-text');
  el.textContent = (northStarGoal && northStarGoal.trim()) ? `"${northStarGoal}"` : 'Set your North Star in Settings →';
}

// ===== LOAD DAY =====
async function loadDay() {
  const ds = fmt(selectedDate); updateDateDisplay();
  await Promise.all([loadTasks(ds), loadDailyData(ds)]);
}

function updateDateDisplay() {
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('selected-date-display').textContent = selectedDate.toLocaleDateString('en-US', opts);
  const isToday = fmt(selectedDate) === fmt(new Date());
  document.getElementById('selected-date-label').textContent = isToday ? "Today's Focus" : 'Viewing past date';
  document.getElementById('header-date').textContent = new Date().toLocaleDateString('en-US', opts);
}

// ===== TASKS (expandable, max 5, accordion, delete for 4/5) =====
async function loadTasks(ds) {
  try {
    const res = await fetch(`/api/tasks/${ds}`, { headers: headers() });
    if (res.status === 401) { logout(); return; }
    const data = await res.json();
    currentTasks = data.tasks || [];
    // Cap at MAX_TASKS (trim legacy data that exceeds the limit)
    if (currentTasks.length > MAX_TASKS) {
      currentTasks = currentTasks.slice(0, MAX_TASKS);
      saveTasks(); // Persist the trimmed version
    }
    // Ensure at least DEFAULT_TASKS slots
    while (currentTasks.length < DEFAULT_TASKS) currentTasks.push({ text: '', description: '', status: 'Todo', carryForwardCount: 0 });
    renderTasks();
  } catch(e) { console.error('loadTasks:', e); }
}

function renderTasks() {
  const container = document.getElementById('tasks-container');
  container.innerHTML = '';
  currentTasks.forEach((task, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'task-item';

    // Delete button HTML — only for slots 4 and 5 (index 3 and 4)
    const deleteBtn = i >= 3 ? `
      <button class="task-delete-btn" data-idx="${i}" title="Remove task">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>` : '';

    wrapper.innerHTML = `
      <div class="task-row">
        <div class="task-number task-number-${i+1}">${i+1}</div>
        <input type="text" class="task-input" data-idx="${i}" placeholder="Task ${i+1}..." value="${escHtml(task.text)}">
        ${(task.carryForwardCount||0) > 0 ? `<span class="carry-badge">↻${task.carryForwardCount}</span>` : ''}
        <button class="task-desc-toggle ${task.description ? 'active' : ''}" data-idx="${i}" title="Toggle description">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
        </button>
        <div class="status-dropdown-wrapper" data-idx="${i}">
          <button class="status-btn ${statusClass(task.status)}" data-idx="${i}">
            ${escHtml(statusLabel(task.status))}
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
          </button>
        </div>
        ${deleteBtn}
      </div>
      <div class="task-desc-wrapper" data-idx="${i}">
        <textarea class="task-desc-area" data-idx="${i}" rows="2" placeholder="Add notes...">${escHtml(task.description)}</textarea>
      </div>`;
    container.appendChild(wrapper);
  });

  // Update count label & add-task button
  document.getElementById('task-count-label').textContent = `${currentTasks.length} / ${MAX_TASKS}`;
  const addBtn = document.getElementById('add-task-btn');
  addBtn.classList.toggle('hidden', currentTasks.length >= MAX_TASKS);

  // Bind events
  container.querySelectorAll('.task-input').forEach(el => el.addEventListener('input', onTaskChange));
  container.querySelectorAll('.task-desc-area').forEach(el => el.addEventListener('input', onTaskChange));

  // Accordion — single expand: clicking one collapses all others
  container.querySelectorAll('.task-desc-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.idx;
      const targetWrapper = container.querySelector(`.task-desc-wrapper[data-idx="${idx}"]`);
      const isExpanding = !targetWrapper.classList.contains('expanded');

      // Collapse all descriptions first
      container.querySelectorAll('.task-desc-wrapper').forEach(w => w.classList.remove('expanded'));
      container.querySelectorAll('.task-desc-toggle').forEach(b => b.classList.remove('active'));

      // Expand the clicked one (if it wasn't already open)
      if (isExpanding) {
        targetWrapper.classList.add('expanded');
        btn.classList.add('active');
      }
    });
  });

  // Delete buttons for tasks 4/5
  container.querySelectorAll('.task-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      currentTasks.splice(idx, 1);
      saveTasks();
      renderTasks();
    });
  });

  container.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openStatusDropdown(parseInt(btn.dataset.idx), btn); });
  });
  checkReflectionUnlock();
}

function onTaskChange(e) {
  const i = parseInt(e.target.dataset.idx);
  if (e.target.classList.contains('task-input')) currentTasks[i].text = e.target.value;
  else if (e.target.classList.contains('task-desc-area')) currentTasks[i].description = e.target.value;
  debounce('tasks', saveTasks);
}

// Add Task button
document.getElementById('add-task-btn').addEventListener('click', () => {
  if (currentTasks.length >= MAX_TASKS) return;
  currentTasks.push({ text: '', description: '', status: 'Todo', carryForwardCount: 0 });
  renderTasks();
  saveTasks();
  // Focus the new input
  const inputs = document.querySelectorAll('.task-input');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

async function saveTasks() {
  try {
    await fetch(`/api/tasks/${fmt(selectedDate)}`, { method: 'POST', headers: headers(), body: JSON.stringify({ tasks: currentTasks }) });
    showSaved('tasks-saved'); loadTaskDates();
  } catch(e) { console.error('saveTasks:', e); }
}

// ===== CUSTOM STATUS DROPDOWN =====
let openDropdownEl = null;

function statusClass(s) {
  if (s === 'In Progress') return 'st-inprogress';
  if (s === 'Done') return 'st-done';
  if (s === 'Cancelled') return 'st-cancelled';
  return 'st-todo';
}
function statusLabel(s) {
  if (s === 'In Progress') return 'IN PROGRESS';
  if (s === 'Done') return 'DONE';
  if (s === 'Cancelled') return 'CANCELLED';
  return 'TODO';
}

function openStatusDropdown(idx, btnEl) {
  closeAllDropdowns();
  const wrapper = btnEl.closest('.status-dropdown-wrapper');
  const menu = document.createElement('div');
  menu.className = 'status-menu';
  const options = ['Todo', 'In Progress', 'Done', 'Cancelled'];
  options.forEach(opt => {
    const item = document.createElement('button');
    item.className = `status-menu-item ${statusClass(opt)}`;
    item.textContent = statusLabel(opt);
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      currentTasks[idx].status = opt;
      saveTasks();
      renderTasks();
    });
    menu.appendChild(item);
  });
  wrapper.appendChild(menu);
  openDropdownEl = menu;
}

function closeAllDropdowns() {
  if (openDropdownEl) { openDropdownEl.remove(); openDropdownEl = null; }
}

document.addEventListener('click', () => closeAllDropdowns());

// ===== DAILY DATA =====
async function loadDailyData(ds) {
  try {
    const res = await fetch(`/api/daily-data/${ds}`, { headers: headers() });
    if (res.status === 401) return;
    currentDailyData = await res.json();
    renderDailyData();
  } catch(e) { console.error('loadDailyData:', e); }
}

function renderDailyData() {
  const dnds = currentDailyData.doNotDo || ['','',''];
  document.querySelectorAll('.donotdo-input').forEach((el, i) => { el.value = dnds[i] || ''; });
  document.getElementById('reward-input').value = currentDailyData.dailyReward || '';
  document.getElementById('braindump-textarea').value = currentDailyData.brainDump || '';
  document.getElementById('reflection-well').value = currentDailyData.reflectionWell || '';
  document.getElementById('reflection-improve').value = currentDailyData.reflectionImprove || '';
  renderAntiToDo();
}

// Do Not Do
document.querySelectorAll('.donotdo-input').forEach(el => {
  el.addEventListener('input', () => {
    const idx = parseInt(el.dataset.index);
    if (!currentDailyData.doNotDo) currentDailyData.doNotDo = ['','',''];
    currentDailyData.doNotDo[idx] = el.value;
    debounce('donotdo', () => saveDailyField({ doNotDo: currentDailyData.doNotDo }, 'donotdo-saved'));
  });
});

// Reward (now textarea)
document.getElementById('reward-input').addEventListener('input', () => {
  currentDailyData.dailyReward = document.getElementById('reward-input').value;
  document.getElementById('reward-status').textContent = 'Saving...';
  debounce('reward', async () => {
    await saveDailyField({ dailyReward: currentDailyData.dailyReward });
    document.getElementById('reward-status').textContent = '✓ Saved';
    setTimeout(() => { document.getElementById('reward-status').textContent = ''; }, 1500);
  });
});

// Brain Dump
document.getElementById('braindump-textarea').addEventListener('input', () => {
  currentDailyData.brainDump = document.getElementById('braindump-textarea').value;
  document.getElementById('braindump-status').textContent = 'Saving...';
  debounce('braindump', async () => {
    await saveDailyField({ brainDump: currentDailyData.brainDump });
    document.getElementById('braindump-status').textContent = '✓ Saved';
    setTimeout(() => { document.getElementById('braindump-status').textContent = ''; }, 1500);
  });
});

// Reflection (split)
document.getElementById('reflection-well').addEventListener('input', () => {
  currentDailyData.reflectionWell = document.getElementById('reflection-well').value;
  debounce('reflectionWell', () => saveDailyField({ reflectionWell: currentDailyData.reflectionWell }, 'reflection-saved'));
});
document.getElementById('reflection-improve').addEventListener('input', () => {
  currentDailyData.reflectionImprove = document.getElementById('reflection-improve').value;
  debounce('reflectionImprove', () => saveDailyField({ reflectionImprove: currentDailyData.reflectionImprove }, 'reflection-saved'));
});

async function saveDailyField(fields, savedId) {
  try {
    await fetch(`/api/daily-data/${fmt(selectedDate)}`, { method: 'POST', headers: headers(), body: JSON.stringify(fields) });
    if (savedId) showSaved(savedId);
  } catch(e) { console.error('saveDailyField:', e); }
}

// ===== ANTI-TO-DO =====
function renderAntiToDo() {
  const list = document.getElementById('antitodo-list');
  list.innerHTML = '';
  (currentDailyData.antiToDo || []).forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'antitodo-item';
    div.innerHTML = `
      <svg class="w-4 h-4 antitodo-check" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
      <span class="flex-1 text-sm">${escHtml(item)}</span>
      <span class="antitodo-remove" data-idx="${i}">✕</span>`;
    list.appendChild(div);
  });
  list.querySelectorAll('.antitodo-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      currentDailyData.antiToDo.splice(parseInt(btn.dataset.idx), 1);
      renderAntiToDo(); saveDailyField({ antiToDo: currentDailyData.antiToDo });
    });
  });
}

document.getElementById('antitodo-add').addEventListener('click', addAntiToDo);
document.getElementById('antitodo-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAntiToDo(); } });
function addAntiToDo() {
  const input = document.getElementById('antitodo-input');
  const val = input.value.trim(); if (!val) return;
  if (!currentDailyData.antiToDo) currentDailyData.antiToDo = [];
  currentDailyData.antiToDo.push(val); input.value = '';
  renderAntiToDo(); saveDailyField({ antiToDo: currentDailyData.antiToDo });
}

// ===== REFLECTION LOCK (all EXISTING tasks must be Done) =====
function checkReflectionUnlock() {
  const card = document.getElementById('reflection-card');
  const wellTA = document.getElementById('reflection-well');
  const improveTA = document.getElementById('reflection-improve');
  const lockLabel = document.getElementById('reflection-lock-label');

  const filledTasks = currentTasks.filter(t => t.text && t.text.trim() !== '');
  const allDone = filledTasks.length > 0 && filledTasks.every(t => t.status === 'Done');

  if (allDone) {
    card.classList.add('reflection-unlocked');
    wellTA.disabled = false; improveTA.disabled = false;
    lockLabel.textContent = '🔓 Unlocked!';
    lockLabel.classList.add('text-purple-500');
  } else {
    card.classList.remove('reflection-unlocked');
    wellTA.disabled = true; improveTA.disabled = true;
    const doneCount = filledTasks.filter(t => t.status === 'Done').length;
    lockLabel.textContent = `🔒 ${doneCount}/${filledTasks.length} tasks done`;
    lockLabel.classList.remove('text-purple-500');
  }
}

// ===== CALENDAR (with green=100% done days) =====
function buildCalendar() {
  const monthSel = document.getElementById('cal-month-select');
  const yearSel = document.getElementById('cal-year-select');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  monthSel.innerHTML = months.map((m,i) => `<option value="${i}" ${i===calendarDate.getMonth()?'selected':''}>${m}</option>`).join('');
  yearSel.innerHTML = '';
  const cy = new Date().getFullYear();
  for (let y = cy - 3; y <= cy + 2; y++) yearSel.innerHTML += `<option value="${y}" ${y===calendarDate.getFullYear()?'selected':''}>${y}</option>`;
  renderCalendarGrid();
}

function renderCalendarGrid() {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';
  const y = calendarDate.getFullYear(), m = calendarDate.getMonth();
  let startDay = new Date(y, m, 1).getDay() - 1; if (startDay < 0) startDay = 6;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevMonthDays = new Date(y, m, 0).getDate();
  const todayStr = fmt(new Date()), selStr = fmt(selectedDate);

  for (let i = 0; i < startDay; i++) {
    const d = document.createElement('div');
    d.className = 'cal-day other-month'; d.textContent = prevMonthDays - startDay + 1 + i; grid.appendChild(d);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = document.createElement('div');
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    d.className = 'cal-day';
    if (dateStr === todayStr) d.classList.add('today');
    if (dateStr === selStr) d.classList.add('selected');
    const info = taskDateInfo[dateStr];
    if (info) {
      if (info.allDone) d.classList.add('all-done');
      else if (info.hasTasks) d.classList.add('has-tasks');
    }
    d.textContent = day;
    d.addEventListener('click', () => { selectedDate = new Date(y, m, day); loadDay(); renderCalendarGrid(); });
    grid.appendChild(d);
  }
  const totalCells = startDay + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    const d = document.createElement('div');
    d.className = 'cal-day other-month'; d.textContent = i; grid.appendChild(d);
  }
}

document.getElementById('cal-month-select').addEventListener('change', (e) => { calendarDate.setMonth(parseInt(e.target.value)); renderCalendarGrid(); });
document.getElementById('cal-year-select').addEventListener('change', (e) => { calendarDate.setFullYear(parseInt(e.target.value)); renderCalendarGrid(); });
document.getElementById('cal-prev').addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() - 1); buildCalendar(); });
document.getElementById('cal-next').addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() + 1); buildCalendar(); });
document.getElementById('cal-today').addEventListener('click', () => { selectedDate = new Date(); calendarDate = new Date(); buildCalendar(); loadDay(); });

async function loadTaskDates() {
  try {
    const res = await fetch('/api/task-dates', { headers: headers() });
    const data = await res.json();
    taskDateInfo = data.dateInfo || {};
    renderCalendarGrid();
  } catch(e) { console.error('loadTaskDates:', e); }
}

// ===== CARRY OVER =====
async function checkCarryOver() {
  const todayStr = fmt(new Date());
  if (fmt(selectedDate) !== todayStr) return;
  try {
    const res = await fetch(`/api/carry-over-check/${todayStr}`, { headers: headers() });
    const data = await res.json();
    const banner = document.getElementById('carry-over-banner');
    if (data.hasUnfinished) {
      document.getElementById('carry-over-detail').textContent = `${data.count} task(s) from ${data.sourceDate} • Capacity: ${data.capacity} slot(s) free`;
      banner.classList.remove('hidden'); banner._sourceDate = data.sourceDate;
      // If no capacity at all, show warning styling
      if (data.capacity < data.count) {
        document.getElementById('carry-over-detail').textContent += ' ⚠️ Not enough room!';
      }
    } else { banner.classList.add('hidden'); }
  } catch(e) { console.error('checkCarryOver:', e); }
}

document.getElementById('carry-over-accept').addEventListener('click', async () => {
  const banner = document.getElementById('carry-over-banner');
  try {
    const res = await fetch('/api/carry-over', { method: 'POST', headers: headers(), body: JSON.stringify({ sourceDate: banner._sourceDate, targetDate: fmt(selectedDate) }) });
    const data = await res.json();
    if (res.status === 409) {
      // HARD BLOCK — show toast
      showToast(data.message || 'Capacity Reached: Not enough room to carry over tasks.', 'error');
      return;
    }
    if (data.tasks) { currentTasks = data.tasks; renderTasks(); }
    banner.classList.add('hidden');
    showToast(`✓ Carried over ${data.carried} task(s) successfully`, 'success');
  } catch(e) { console.error('carryOver:', e); }
});
document.getElementById('carry-over-dismiss').addEventListener('click', () => { document.getElementById('carry-over-banner').classList.add('hidden'); });

// ===== TOAST NOTIFICATION =====
function showToast(message, type = 'info') {
  // Remove existing toast
  const existing = document.getElementById('app-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'app-toast';
  const bgClass = type === 'error'
    ? 'bg-red-600'
    : type === 'success'
    ? 'bg-emerald-600'
    : 'bg-violet-600';
  toast.className = `fixed top-4 left-1/2 transform -translate-x-1/2 z-[200] ${bgClass} text-white px-6 py-3.5 rounded-2xl shadow-2xl text-sm font-semibold max-w-md text-center`;
  toast.style.cssText = 'animation: toastIn 0.3s ease-out;';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ===== IDEA DUMP =====
async function loadIdeas() {
  try {
    const res = await fetch('/api/ideas', { headers: headers() });
    if (res.status === 401) { logout(); return; }
    const data = await res.json();
    currentIdeas = data.ideas || [];
    renderIdeas();
  } catch(e) { console.error('loadIdeas:', e); }
}

function renderIdeas() {
  const container = document.getElementById('ideas-container');
  container.innerHTML = '';
  document.getElementById('ideas-count').textContent = currentIdeas.length > 0 ? `${currentIdeas.length} idea${currentIdeas.length !== 1 ? 's' : ''}` : '';

  // Add new idea card (always first)
  const addCard = document.createElement('div');
  addCard.className = 'idea-add-card card';
  addCard.innerHTML = `
    <input type="text" class="idea-add-input" id="idea-title-input" placeholder="Idea title..." maxlength="500">
    <textarea class="idea-add-textarea" id="idea-body-input" rows="3" placeholder="Describe your idea..."></textarea>
    <button class="idea-add-btn" id="idea-submit-btn">
      <svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
      Save Idea
    </button>`;
  container.appendChild(addCard);

  // Bind add idea
  const submitBtn = addCard.querySelector('#idea-submit-btn');
  submitBtn.addEventListener('click', addIdea);
  addCard.querySelector('#idea-title-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addIdea(); }
  });

  // Render existing ideas (newest first)
  [...currentIdeas].reverse().forEach(idea => {
    const card = document.createElement('div');
    card.className = 'idea-card card';
    const dateStr = idea.createdAt ? new Date(idea.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    card.innerHTML = `
      <div class="idea-title" data-id="${idea.id}" title="Click to edit">${escHtml(idea.title)}</div>
      <div class="idea-body" data-id="${idea.id}" title="Click to edit">${idea.body ? escHtml(idea.body) : '<span style="color:#6b7280;font-style:italic">Click to add notes...</span>'}</div>
      <div class="idea-meta">
        <span class="idea-date">${dateStr}</span>
        <div class="flex items-center gap-1">
          <button class="idea-edit-btn" data-id="${idea.id}" title="Edit idea">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button class="idea-delete-btn" data-id="${idea.id}" title="Delete idea">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>`;
    container.appendChild(card);

    // Inline edit: click title to edit
    const titleEl = card.querySelector('.idea-title');
    titleEl.style.cursor = 'pointer';
    titleEl.addEventListener('click', () => startInlineEdit(idea, card, 'title'));

    // Inline edit: click body to edit
    const bodyEl = card.querySelector('.idea-body');
    bodyEl.style.cursor = 'pointer';
    bodyEl.addEventListener('click', () => startInlineEdit(idea, card, 'body'));
  });

  // Bind edit buttons
  container.querySelectorAll('.idea-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const idea = currentIdeas.find(i => i.id === id);
      const card = btn.closest('.idea-card');
      if (idea && card) startInlineEdit(idea, card, 'title');
    });
  });

  // Bind delete
  container.querySelectorAll('.idea-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteIdea(btn.dataset.id));
  });
}

function startInlineEdit(idea, card, field) {
  // Avoid double-editing
  if (card.querySelector('.idea-edit-input, .idea-edit-textarea')) return;

  if (field === 'title') {
    const titleEl = card.querySelector('.idea-title');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'idea-edit-input';
    input.value = idea.title;
    input.maxLength = 500;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const save = () => {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== idea.title) {
        saveIdeaEdit(idea.id, newTitle, idea.body);
      } else {
        renderIdeas(); // Revert if empty
      }
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { renderIdeas(); }
    });
  } else {
    const bodyEl = card.querySelector('.idea-body');
    const textarea = document.createElement('textarea');
    textarea.className = 'idea-edit-textarea';
    textarea.value = idea.body || '';
    textarea.rows = 3;
    textarea.placeholder = 'Add notes...';
    bodyEl.replaceWith(textarea);
    textarea.focus();

    const save = () => {
      const newBody = textarea.value.trim();
      if (newBody !== (idea.body || '')) {
        saveIdeaEdit(idea.id, idea.title, newBody);
      } else {
        renderIdeas();
      }
    };
    textarea.addEventListener('blur', save);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { renderIdeas(); }
    });
  }
}

async function saveIdeaEdit(id, title, body) {
  try {
    const res = await fetch(`/api/ideas/${id}`, {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ title, body })
    });
    if (res.ok) {
      const data = await res.json();
      const idx = currentIdeas.findIndex(i => i.id === id);
      if (idx !== -1) currentIdeas[idx] = { ...currentIdeas[idx], title: data.idea.title, body: data.idea.body };
      renderIdeas();
      showToast('✏️ Idea updated', 'success');
    }
  } catch(e) { console.error('saveIdeaEdit:', e); renderIdeas(); }
}

async function addIdea() {
  const titleInput = document.getElementById('idea-title-input');
  const bodyInput = document.getElementById('idea-body-input');
  const title = titleInput.value.trim();
  if (!title) { titleInput.focus(); return; }

  try {
    const res = await fetch('/api/ideas', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ title, body: bodyInput.value.trim() })
    });
    if (res.ok) {
      const data = await res.json();
      currentIdeas.push(data.idea);
      titleInput.value = ''; bodyInput.value = '';
      renderIdeas();
      showToast('💡 Idea saved!', 'success');
    }
  } catch(e) { console.error('addIdea:', e); }
}

async function deleteIdea(id) {
  try {
    const res = await fetch(`/api/ideas/${id}`, { method: 'DELETE', headers: headers() });
    if (res.ok) {
      currentIdeas = currentIdeas.filter(i => i.id !== id);
      renderIdeas();
    }
  } catch(e) { console.error('deleteIdea:', e); }
}

// ===== IDEA TODOS =====

async function loadIdeaTodos() {
  try {
    const res = await fetch('/api/idea-todos', { headers: headers() });
    if (res.status === 401) { logout(); return; }
    const data = await res.json();
    currentIdeaTodos = data.ideaTodos || [];
    renderIdeaTodos();
  } catch(e) { console.error('loadIdeaTodos:', e); }
}

function renderIdeaTodos() {
  const list = document.getElementById('idea-todo-list');
  list.innerHTML = '';
  
  [...currentIdeaTodos].reverse().forEach(todo => {
    const item = document.createElement('div');
    item.className = `flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800/30 transition-all ${todo.completed ? 'opacity-60' : 'hover:shadow-md'}`;
    
    // Checkbox mapping completed state
    const checkBtn = document.createElement('button');
    checkBtn.className = `w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center border transition-colors ${todo.completed ? 'bg-pink-500 border-pink-500' : 'border-gray-300 dark:border-gray-600 hover:border-pink-500'}`;
    checkBtn.innerHTML = todo.completed ? `<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>` : '';
    
    // Title mapping
    const titleSpan = document.createElement('span');
    titleSpan.className = `flex-1 text-sm font-medium ${todo.completed ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-200'} cursor-pointer break-all`;
    titleSpan.textContent = todo.title;
    
    // Delete btn
    const delBtn = document.createElement('button');
    delBtn.className = 'w-6 h-6 flex items-center justify-center rounded border border-transparent text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all opacity-0';
    item.addEventListener('mouseenter', () => delBtn.classList.remove('opacity-0'));
    item.addEventListener('mouseleave', () => delBtn.classList.add('opacity-0'));
    delBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>`;

    // Events
    checkBtn.addEventListener('click', () => toggleIdeaTodo(todo.id, !todo.completed));
    titleSpan.addEventListener('click', () => startEditIdeaTodo(todo, titleSpan));
    delBtn.addEventListener('click', () => deleteIdeaTodo(todo.id));

    item.appendChild(checkBtn);
    item.appendChild(titleSpan);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

async function addIdeaTodo() {
  const input = document.getElementById('idea-todo-input');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }

  try {
    const res = await fetch('/api/idea-todos', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ title })
    });
    if (res.ok) {
      const data = await res.json();
      currentIdeaTodos.push(data.todo);
      input.value = '';
      renderIdeaTodos();
    }
  } catch(e) { console.error('addIdeaTodo:', e); }
}

// Bind add task
document.getElementById('idea-todo-add').addEventListener('click', addIdeaTodo);
document.getElementById('idea-todo-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addIdeaTodo(); }
});

async function toggleIdeaTodo(id, completed) {
  try {
    const res = await fetch(`/api/idea-todos/${id}`, {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ completed })
    });
    if (res.ok) {
      const idx = currentIdeaTodos.findIndex(t => t.id === id);
      if (idx !== -1) currentIdeaTodos[idx].completed = completed;
      renderIdeaTodos();
    }
  } catch(e) { console.error('toggleIdeaTodo:', e); }
}

async function deleteIdeaTodo(id) {
  try {
    const res = await fetch(`/api/idea-todos/${id}`, { method: 'DELETE', headers: headers() });
    if (res.ok) {
      currentIdeaTodos = currentIdeaTodos.filter(t => t.id !== id);
      renderIdeaTodos();
    }
  } catch(e) { console.error('deleteIdeaTodo:', e); }
}

function startEditIdeaTodo(todo, titleSpan) {
  if (todo.completed) return; // Don't edit completed tasks
  
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'flex-1 text-sm font-medium px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 border-none outline-none focus:ring-1 focus:ring-pink-500 -ml-2';
  input.value = todo.title;
  
  titleSpan.replaceWith(input);
  input.focus();
  input.select();

  const save = async () => {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== todo.title) {
      try {
        const res = await fetch(`/api/idea-todos/${todo.id}`, {
          method: 'PUT', headers: headers(),
          body: JSON.stringify({ title: newTitle })
        });
        if (res.ok) {
          todo.title = newTitle;
        }
      } catch(e) { console.error('saveIdeaTodo:', e); }
    }
    renderIdeaTodos();
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { renderIdeaTodos(); }
  });
}

// ===== SETTINGS =====
document.getElementById('settings-btn').addEventListener('click', () => { document.getElementById('settings-modal').classList.remove('hidden'); document.getElementById('north-star-input').value = northStarGoal || ''; });
document.getElementById('settings-close').addEventListener('click', () => { document.getElementById('settings-modal').classList.add('hidden'); });
document.getElementById('settings-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) document.getElementById('settings-modal').classList.add('hidden'); });

document.getElementById('settings-theme-toggle').addEventListener('click', async () => {
  const isDark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', isDark);
  try { await fetch('/api/settings/preferences', { method: 'POST', headers: headers(), body: JSON.stringify({ darkMode: isDark }) }); } catch {}
});
document.getElementById('settings-glass-toggle').addEventListener('click', async () => {
  const isGlass = !document.body.classList.contains('glassmorphism');
  document.body.classList.toggle('glassmorphism', isGlass);
  try { await fetch('/api/settings/preferences', { method: 'POST', headers: headers(), body: JSON.stringify({ glassmorphism: isGlass }) }); } catch {}
});
document.getElementById('north-star-save').addEventListener('click', async () => {
  northStarGoal = document.getElementById('north-star-input').value.trim(); updateNorthStarDisplay();
  try { await fetch('/api/settings/north-star', { method: 'POST', headers: headers(), body: JSON.stringify({ northStarGoal }) }); } catch {}
});

// Change password with Confirm validation
document.getElementById('change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('password-msg');
  const newPw = document.getElementById('new-password').value;
  const confirmPw = document.getElementById('confirm-new-password').value;

  // Frontend validation: new passwords must match
  if (newPw !== confirmPw) {
    msgEl.textContent = 'New passwords do not match';
    msgEl.className = 'text-sm text-center text-red-500';
    msgEl.classList.remove('hidden');
    setTimeout(() => msgEl.classList.add('hidden'), 3000);
    return;
  }

  try {
    const res = await fetch('/api/settings/password', { method: 'POST', headers: headers(), body: JSON.stringify({ currentPassword: document.getElementById('current-password').value, newPassword: newPw }) });
    const data = await res.json(); msgEl.classList.remove('hidden');
    if (res.ok) {
      msgEl.textContent = '✓ Password changed';
      msgEl.className = 'text-sm text-center text-green-500';
      document.getElementById('current-password').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('confirm-new-password').value = '';
    }
    else { msgEl.textContent = data.error; msgEl.className = 'text-sm text-center text-red-500'; }
    setTimeout(() => msgEl.classList.add('hidden'), 3000);
  } catch { msgEl.textContent = 'Error'; msgEl.className = 'text-sm text-center text-red-500'; msgEl.classList.remove('hidden'); }
});

document.getElementById('export-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/export', { headers: headers() }); const blob = await res.blob();
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `taskmanager-${currentUserId}-export.json`; a.click(); URL.revokeObjectURL(url);
  } catch(e) { console.error('export:', e); }
});
document.getElementById('import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const msgEl = document.getElementById('data-msg');
  try {
    const text = await file.text(); const json = JSON.parse(text);
    const res = await fetch('/api/import', { method: 'POST', headers: headers(), body: JSON.stringify(json) });
    const data = await res.json(); msgEl.classList.remove('hidden');
    if (res.ok) { msgEl.textContent = '✓ Data imported'; msgEl.className = 'text-sm text-center text-green-500'; loadDay(); }
    else { msgEl.textContent = data.error; msgEl.className = 'text-sm text-center text-red-500'; }
    setTimeout(() => msgEl.classList.add('hidden'), 3000);
  } catch { msgEl.textContent = 'Invalid JSON file'; msgEl.className = 'text-sm text-center text-red-500'; msgEl.classList.remove('hidden'); }
  e.target.value = '';
});

document.getElementById('logout-btn').addEventListener('click', logout);
function logout() {
  token = ''; currentUserId = '';
  localStorage.removeItem('tm_token'); localStorage.removeItem('tm_userId');
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
}

// ===== INIT =====
(async function init() {
  if (token && currentUserId) {
    try {
      const res = await fetch('/api/settings/preferences', { headers: headers() });
      if (res.ok) {
        const data = await res.json(); applyPreferences(data.preferences || {});
        const nsRes = await fetch('/api/settings/north-star', { headers: headers() });
        if (nsRes.ok) { const nsData = await nsRes.json(); northStarGoal = nsData.northStarGoal || ''; }
        showDashboard();
      } else { logout(); }
    } catch { logout(); }
  }
})();
