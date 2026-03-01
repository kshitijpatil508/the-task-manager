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

// ===== TASKS (expandable, max 5) =====
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
      </div>
      <div class="task-desc-wrapper ${task.description ? '' : 'hidden'}" data-idx="${i}">
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
  container.querySelectorAll('.task-desc-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.idx;
      const wrapper = container.querySelector(`.task-desc-wrapper[data-idx="${idx}"]`);
      wrapper.classList.toggle('hidden'); btn.classList.toggle('active');
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
document.getElementById('change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('password-msg');
  try {
    const res = await fetch('/api/settings/password', { method: 'POST', headers: headers(), body: JSON.stringify({ currentPassword: document.getElementById('current-password').value, newPassword: document.getElementById('new-password').value }) });
    const data = await res.json(); msgEl.classList.remove('hidden');
    if (res.ok) { msgEl.textContent = '✓ Password changed'; msgEl.className = 'text-sm text-center text-green-500'; }
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
