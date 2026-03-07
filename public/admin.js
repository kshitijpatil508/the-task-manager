// ===== ADMIN PANEL JS =====
let adminToken = localStorage.getItem('tm_admin_token') || '';
let adminUsername = localStorage.getItem('tm_admin_user') || '';
let allUsers = [];
let editingUserId = null;
let deletingUserId = null;

function adminHeaders() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }; }
function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ===== AUTH =====
document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('admin-login-error');
  errEl.classList.add('hidden');
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('admin-username').value,
        password: document.getElementById('admin-password').value
      })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
    adminToken = data.token;
    adminUsername = data.username;
    localStorage.setItem('tm_admin_token', adminToken);
    localStorage.setItem('tm_admin_user', adminUsername);
    showAdminDashboard();
  } catch { errEl.textContent = 'Connection error'; errEl.classList.remove('hidden'); }
});

function showAdminDashboard() {
  document.getElementById('admin-auth').classList.add('hidden');
  document.getElementById('admin-dashboard').classList.remove('hidden');
  document.getElementById('admin-user-label').textContent = adminUsername;
  loadUsers();
}

document.getElementById('admin-logout').addEventListener('click', () => {
  adminToken = ''; adminUsername = '';
  localStorage.removeItem('tm_admin_token');
  localStorage.removeItem('tm_admin_user');
  document.getElementById('admin-dashboard').classList.add('hidden');
  document.getElementById('admin-auth').classList.remove('hidden');
  document.getElementById('admin-password').value = '';
});

// ===== LOAD + RENDER USERS =====
async function loadUsers() {
  try {
    const res = await fetch('/api/admin/users', { headers: adminHeaders() });
    if (res.status === 401 || res.status === 403) { document.getElementById('admin-logout').click(); return; }
    const data = await res.json();
    allUsers = data.users || [];
    renderUsers();
  } catch (e) { console.error('loadUsers:', e); }
}

function renderUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  const empty = document.getElementById('admin-empty-state');

  if (allUsers.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    tbody.innerHTML = allUsers.map(u => `
      <tr class="border-b border-gray-800/50 hover:bg-gray-800/30 transition">
        <td class="px-6 py-4"><span class="font-semibold">${esc(u.userId)}</span></td>
        <td class="px-6 py-4">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${u.disabled ? 'bg-red-900/30 text-red-400' : 'bg-emerald-900/30 text-emerald-400'}">
            <span class="w-1.5 h-1.5 rounded-full ${u.disabled ? 'bg-red-500' : 'bg-emerald-500'}"></span>
            ${u.disabled ? 'Disabled' : 'Active'}
          </span>
        </td>
        <td class="px-6 py-4 text-xs text-gray-400">${u.hasPin ? '🔑 Set' : '—'}</td>
        <td class="px-6 py-4 text-xs text-gray-400">${u.stats.taskDays}d · ${u.stats.notes}n · ${u.stats.ideas}i</td>
        <td class="px-6 py-4 text-xs text-gray-400">${u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
        <td class="px-6 py-4 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button class="admin-action-btn p-2 rounded-lg ${u.disabled ? 'hover:bg-emerald-900/30 text-emerald-400' : 'hover:bg-amber-900/30 text-amber-400'} transition" data-action="toggle" data-uid="${esc(u.userId)}" title="${u.disabled ? 'Enable' : 'Disable'}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${u.disabled ? 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' : 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21'}"/></svg>
            </button>
            <button class="admin-action-btn p-2 rounded-lg hover:bg-blue-900/30 text-blue-400 transition" data-action="edit" data-uid="${esc(u.userId)}" title="Edit">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>
            <button class="admin-action-btn p-2 rounded-lg hover:bg-emerald-900/30 text-emerald-400 transition" data-action="export" data-uid="${esc(u.userId)}" title="Export">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            </button>
            <button class="admin-action-btn p-2 rounded-lg hover:bg-red-900/30 text-red-400 transition" data-action="delete" data-uid="${esc(u.userId)}" title="Delete">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // Stats
  const stats = document.getElementById('admin-stats');
  const total = allUsers.length;
  const active = allUsers.filter(u => !u.disabled).length;
  const disabled = allUsers.filter(u => u.disabled).length;
  stats.innerHTML = `
    <div class="glass-card p-5 flex items-center gap-4">
      <div class="w-11 h-11 rounded-xl bg-violet-900/30 flex items-center justify-center"><svg class="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg></div>
      <div><p class="text-2xl font-bold">${total}</p><p class="text-xs text-gray-400">Total Users</p></div>
    </div>
    <div class="glass-card p-5 flex items-center gap-4">
      <div class="w-11 h-11 rounded-xl bg-emerald-900/30 flex items-center justify-center"><svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
      <div><p class="text-2xl font-bold">${active}</p><p class="text-xs text-gray-400">Active</p></div>
    </div>
    <div class="glass-card p-5 flex items-center gap-4">
      <div class="w-11 h-11 rounded-xl bg-red-900/30 flex items-center justify-center"><svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg></div>
      <div><p class="text-2xl font-bold">${disabled}</p><p class="text-xs text-gray-400">Disabled</p></div>
    </div>`;

  // Bind action buttons via event delegation on tbody
  bindActionButtons();
}

// ===== EVENT DELEGATION FOR ACTION BUTTONS =====
function bindActionButtons() {
  document.querySelectorAll('.admin-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const uid = btn.dataset.uid;
      if (action === 'toggle') toggleUser(uid);
      else if (action === 'edit') openEditModal(uid);
      else if (action === 'export') exportUser(uid);
      else if (action === 'delete') confirmDelete(uid);
    });
  });
}

// ===== TOGGLE =====
async function toggleUser(userId) {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/toggle`, { method: 'POST', headers: adminHeaders() });
    if (res.ok) loadUsers();
  } catch (e) { console.error('toggleUser:', e); }
}

// ===== EXPORT =====
function exportUser(userId) {
  window.open(`/api/admin/users/${encodeURIComponent(userId)}/export?token=${adminToken}`, '_blank');
}

// ===== DELETE =====
function confirmDelete(userId) {
  deletingUserId = userId;
  document.getElementById('delete-modal-msg').textContent = `This will permanently delete "${userId}" and all their data.`;
  document.getElementById('delete-modal').classList.remove('hidden');
}

document.getElementById('delete-cancel').addEventListener('click', () => {
  document.getElementById('delete-modal').classList.add('hidden');
  deletingUserId = null;
});

document.getElementById('delete-confirm').addEventListener('click', async () => {
  if (!deletingUserId) return;
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(deletingUserId)}`, { method: 'DELETE', headers: adminHeaders() });
    if (res.ok) {
      document.getElementById('delete-modal').classList.add('hidden');
      deletingUserId = null;
      loadUsers();
    }
  } catch (e) { console.error('deleteUser:', e); }
});

// ===== CREATE / EDIT MODAL =====
document.getElementById('admin-create-btn').addEventListener('click', () => {
  editingUserId = null;
  document.getElementById('modal-title').textContent = 'Create User';
  document.getElementById('modal-userId').value = '';
  document.getElementById('modal-userId').disabled = false;
  document.getElementById('modal-password').value = '';
  document.getElementById('modal-password').placeholder = 'Min 8 characters';
  document.getElementById('modal-password').required = true;
  document.getElementById('modal-reset-pin-row').classList.add('hidden');
  document.getElementById('modal-submit').textContent = 'Create';
  document.getElementById('modal-error').classList.add('hidden');
  document.getElementById('admin-modal').classList.remove('hidden');
});

function openEditModal(userId) {
  editingUserId = userId;
  document.getElementById('modal-title').textContent = `Edit: ${userId}`;
  document.getElementById('modal-userId').value = userId;
  document.getElementById('modal-userId').disabled = true;
  document.getElementById('modal-password').value = '';
  document.getElementById('modal-password').placeholder = 'Leave blank to keep current';
  document.getElementById('modal-password').required = false;
  document.getElementById('modal-reset-pin-row').classList.remove('hidden');
  document.getElementById('modal-reset-pin').checked = false;
  document.getElementById('modal-submit').textContent = 'Save Changes';
  document.getElementById('modal-error').classList.add('hidden');
  document.getElementById('admin-modal').classList.remove('hidden');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('admin-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

function closeModal() {
  document.getElementById('admin-modal').classList.add('hidden');
  editingUserId = null;
}

document.getElementById('modal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('modal-error');
  errEl.classList.add('hidden');

  if (editingUserId) {
    // Edit existing user
    const body = {};
    const pw = document.getElementById('modal-password').value;
    if (pw) body.newPassword = pw;
    if (document.getElementById('modal-reset-pin').checked) body.resetPin = true;
    if (!pw && !body.resetPin) { closeModal(); return; }

    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(editingUserId)}`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
      closeModal();
      loadUsers();
    } catch { errEl.textContent = 'Connection error'; errEl.classList.remove('hidden'); }
  } else {
    // Create new user
    const userId = document.getElementById('modal-userId').value;
    const password = document.getElementById('modal-password').value;
    try {
      const res = await fetch('/api/admin/users', { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ userId, password }) });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
      closeModal();
      loadUsers();
    } catch { errEl.textContent = 'Connection error'; errEl.classList.remove('hidden'); }
  }
});

// ===== INIT =====
(async function init() {
  if (adminToken) {
    try {
      const res = await fetch('/api/admin/users', { headers: adminHeaders() });
      if (res.ok) showAdminDashboard();
      else document.getElementById('admin-logout').click();
    } catch { document.getElementById('admin-logout').click(); }
  }
})();
