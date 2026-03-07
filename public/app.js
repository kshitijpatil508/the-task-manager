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
let showDoneIdeaTodos = false;
let currentNotes = [];
let activeNoteId = null;
let activeIdeaId = null;
let currentView = 'dashboard'; // 'dashboard' | 'ideas' | 'notes'
let currentPrefs = {};
const MAX_TASKS = 21;
const DEFAULT_TASKS = 3;

// ===== HELPERS =====
function fmt(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function headers() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }; }
function debounce(key, fn, ms = 800) { clearTimeout(debounceTimers[key]); debounceTimers[key] = setTimeout(fn, ms); }
function isPastDate() { return fmt(selectedDate) < fmt(new Date()); }
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
  const userId = document.getElementById('login-userId').value;
  const password = document.getElementById('login-password').value;
  const pinInput = document.getElementById('login-pin').value;
  try {
    const res = await fetch('/api/login', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ userId, password, pin: pinInput }) 
    });
    const data = await res.json();
    if (!res.ok) { 
      // If error is No user found, please register (or similar 401 specific msg)
      errEl.textContent = data.error; 
      errEl.classList.remove('hidden'); 
      if (res.status === 429) {
        document.getElementById('login-pin-container').classList.remove('hidden');
      }
      return; 
    }
    loginSuccess(data);
  } catch { errEl.textContent = 'Connection error'; errEl.classList.remove('hidden'); }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('register-error'); errEl.classList.add('hidden');
  const pw = document.getElementById('register-password').value;
  const pin = document.getElementById('register-pin').value;
  if (pw !== document.getElementById('register-confirm').value) { errEl.textContent = 'Passwords do not match'; errEl.classList.remove('hidden'); return; }
  try {
    const res = await fetch('/api/register', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ userId: document.getElementById('register-userId').value, password: pw, pin }) 
    });
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
  currentPrefs = prefs || {};
  document.documentElement.classList.toggle('dark', !!prefs.darkMode);
  const isDark = document.documentElement.classList.contains('dark');
  const accentTheme = isDark ? (prefs.accentDark || 'purple') : (prefs.accentLight || 'purple');
  document.documentElement.setAttribute('data-theme', accentTheme);
  
  const customHex = isDark ? prefs.customHexDark : prefs.customHexLight;
  if (accentTheme === 'custom' && customHex) {
    if (typeof generateCustomStyle === 'function') generateCustomStyle(customHex);
    const trigger = document.getElementById('custom-picker-trigger');
    const preview = document.getElementById('custom-accent-preview');
    if (trigger) trigger.dataset.currentHex = customHex;
    if (preview) preview.style.background = customHex;
  }

  // Apply accent icons preference
  if (prefs.accentIcons) {
    document.body.classList.add('accent-icons');
  }

  // Apply gradient settings
  if (prefs.auraSolid) document.body.classList.add('aura-solid');
  else document.body.classList.remove('aura-solid');

  if (prefs.auraOp !== undefined) {
    document.documentElement.style.setProperty('--aura-op', prefs.auraOp);
  }
  if (prefs.bgDark !== undefined) {
    document.documentElement.style.setProperty('--bg-color-dark', `hsl(var(--ac-h), var(--ac-s), ${prefs.bgDark}%)`);
  }
  if (prefs.bgLight !== undefined) {
    document.documentElement.style.setProperty('--bg-color-light', `hsl(var(--ac-h), var(--ac-s), ${prefs.bgLight}%)`);
  }
  if (prefs.auraSat !== undefined) {
    document.documentElement.style.setProperty('--aura-sat', prefs.auraSat + '%');
  }
  if (prefs.auraBlur !== undefined) {
    document.documentElement.style.setProperty('--aura-blur', prefs.auraBlur + 'px');
  }
}

// ===== CUSTOM COLOR HELPER (GLOBAL) =====
function hexToRgb(hex) {
  if (hex.startsWith('#')) hex = hex.slice(1);
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return [r, g, b];
}

function interpolateColor(color1, color2, factor) {
  const r = Math.round(color1[0] + factor * (color2[0] - color1[0]));
  const g = Math.round(color1[1] + factor * (color2[1] - color1[1]));
  const b = Math.round(color1[2] + factor * (color2[2] - color1[2]));
  return `${r} ${g} ${b}`;
}

function generateCustomStyle(baseHex) {
  const baseRgb = hexToRgb(baseHex);
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  
  const theme = `
    [data-theme="custom"] {
      --ac-50: ${interpolateColor(white, baseRgb, 0.1)};
      --ac-100: ${interpolateColor(white, baseRgb, 0.2)};
      --ac-200: ${interpolateColor(white, baseRgb, 0.4)};
      --ac-300: ${interpolateColor(white, baseRgb, 0.6)};
      --ac-400: ${interpolateColor(white, baseRgb, 0.8)};
      --ac-500: ${baseRgb.join(' ')};
      --ac-600: ${interpolateColor(baseRgb, black, 0.15)};
      --ac-700: ${interpolateColor(baseRgb, black, 0.3)};
      --ac-800: ${interpolateColor(baseRgb, black, 0.45)};
      --ac-900: ${interpolateColor(baseRgb, black, 0.6)};
      --ac-950: ${interpolateColor(baseRgb, black, 0.8)};
    }
  `;
  let styleTag = document.getElementById('custom-theme-style');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'custom-theme-style';
    document.head.appendChild(styleTag);
  }
  styleTag.innerHTML = theme;
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
  const notesView = document.getElementById('notes-view');

  dashView.classList.toggle('hidden', view !== 'dashboard');
  ideasView.classList.toggle('hidden', view !== 'ideas');
  notesView.classList.toggle('hidden', view !== 'notes');

  // Update all nav tabs (both desktop and mobile)
  document.querySelectorAll('.app-nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  if (view === 'ideas') {
    loadIdeas();
    loadIdeaTodos();
  } else if (view === 'notes') {
    loadNotes();
  }
}

function _setupAccentColorSettings() {
  const accentButtons = document.querySelectorAll('#accent-color-selector button');
  if (!accentButtons.length) return;

  function setAccentColor(color) {
    document.documentElement.setAttribute('data-theme', color);
    const isDark = document.documentElement.classList.contains('dark');
    
    if (isDark) currentPrefs.accentDark = color;
    else currentPrefs.accentLight = color;

    // Send to backend
    fetch('/api/settings/preferences', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ [isDark ? 'accentDark' : 'accentLight']: color })
    }).catch(e => console.error('Failed to save accent color', e));
  }

  accentButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      setAccentColor(theme);
    });
  });

  // Custom Color Picker Logic — in-app HSL modal
  const customTrigger = document.getElementById('custom-picker-trigger');
  const customPreview = document.getElementById('custom-accent-preview');
  const customCheck = document.getElementById('custom-accent-check');

  function hslaToHex(h, s, l, a) {
    s /= 100; l /= 100; a /= 100;
    const a1 = s * Math.min(l, 1 - l);
    const f = n => { const k = (n + h / 30) % 12; return l - a1 * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
    return '#' + [f(0), f(8), f(4), a].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }

  function openColorPickerModal() {
    // Remove existing modal if any
    const existing = document.getElementById('custom-color-modal');
    if (existing) existing.remove();

    let hue = 220, sat = 70, light = 50, alpha = 100;
    const isDark = document.documentElement.classList.contains('dark');
    const currentHex = customTrigger?.dataset.currentHex || (isDark ? currentPrefs.customHexDark : currentPrefs.customHexLight);
    // Simple: start from stored values or defaults

    const modal = document.createElement('div');
    modal.id = 'custom-color-modal';
    modal.className = 'color-picker-modal';
    modal.innerHTML = `
      <div class="color-picker-card">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-base font-bold text-gray-900 dark:text-white">Choose Custom Color</h3>
          <button id="color-picker-close" class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition">
            <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div id="color-preview-box" class="w-full h-20 rounded-2xl mb-5 transition-colors shadow-inner" style="background: ${hslaToHex(hue, sat, light, alpha)}"></div>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Hue</label>
            <input type="range" id="cp-hue" min="0" max="360" value="${hue}" class="color-picker-hue">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Saturation</label>
            <input type="range" id="cp-sat" min="0" max="100" value="${sat}" class="color-picker-sat" style="background: linear-gradient(to right, hsla(${hue},0%,${light}%,${alpha/100}), hsla(${hue},100%,${light}%,${alpha/100}))">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Lightness</label>
            <input type="range" id="cp-light" min="10" max="90" value="${light}" class="color-picker-light" style="background: linear-gradient(to right, hsla(${hue},${sat}%,10%,${alpha/100}), hsla(${hue},${sat}%,50%,${alpha/100}), hsla(${hue},${sat}%,90%,${alpha/100}))">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Alpha</label>
            <input type="range" id="cp-alpha" min="0" max="100" value="${alpha}" class="color-picker-alpha" style="background: linear-gradient(to right, transparent, hsl(${hue},${sat}%,${light}%))">
          </div>
        </div>
        <p id="cp-hex-label" class="text-center text-xs font-mono text-gray-400 mt-3">${hslaToHex(hue, sat, light, alpha)}</p>
        <div class="flex gap-3 mt-5">
          <button id="color-picker-cancel" class="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-semibold text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition">Cancel</button>
          <button id="color-picker-apply" class="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 text-white font-bold text-sm hover:shadow-lg hover:shadow-accent-500/30 active:scale-[0.97] transition-all">Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const preview = document.getElementById('color-preview-box');
    const hexLabel = document.getElementById('cp-hex-label');
    const hueSlider = document.getElementById('cp-hue');
    const satSlider = document.getElementById('cp-sat');
    const lightSlider = document.getElementById('cp-light');
    const alphaSlider = document.getElementById('cp-alpha');

    function updatePreview() {
      hue = parseInt(hueSlider.value);
      sat = parseInt(satSlider.value);
      light = parseInt(lightSlider.value);
      alpha = parseInt(alphaSlider.value);
      const hex = hslaToHex(hue, sat, light, alpha);
      preview.style.background = hex;
      hexLabel.textContent = hex;
      satSlider.style.background = `linear-gradient(to right, hsla(${hue},0%,${light}%,${alpha/100}), hsla(${hue},100%,${light}%,${alpha/100}))`;
      lightSlider.style.background = `linear-gradient(to right, hsla(${hue},${sat}%,10%,${alpha/100}), hsla(${hue},${sat}%,50%,${alpha/100}), hsla(${hue},${sat}%,90%,${alpha/100}))`;
      alphaSlider.style.background = `linear-gradient(to right, transparent, hsl(${hue},${sat}%,${light}%))`;
    }

    hueSlider.addEventListener('input', updatePreview);
    satSlider.addEventListener('input', updatePreview);
    lightSlider.addEventListener('input', updatePreview);
    alphaSlider.addEventListener('input', updatePreview);

    document.getElementById('color-picker-cancel').addEventListener('click', () => modal.remove());
    document.getElementById('color-picker-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('color-picker-apply').addEventListener('click', () => {
      const hex = hslaToHex(hue, sat, light, alpha);
      customTrigger.dataset.currentHex = hex;
      customPreview.style.background = hex;
      generateCustomStyle(hex);

      document.documentElement.setAttribute('data-theme', 'custom');
      const isDark = document.documentElement.classList.contains('dark');
      if (isDark) {
        currentPrefs.accentDark = 'custom';
        currentPrefs.customHexDark = hex;
      } else {
        currentPrefs.accentLight = 'custom';
        currentPrefs.customHexLight = hex;
      }

      fetch('/api/settings/preferences', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ 
          [isDark ? 'accentDark' : 'accentLight']: 'custom',
          [isDark ? 'customHexDark' : 'customHexLight']: hex
        })
      }).catch(e => console.error('Failed to save custom hex', e));

      modal.remove();
    });
  }

  if (customTrigger) {
    customTrigger.addEventListener('click', openColorPickerModal);

    // Observe theme to toggle checkmark
    const observer = new MutationObserver(() => {
      const isCustom = document.documentElement.getAttribute('data-theme') === 'custom';
      if (customCheck) customCheck.classList.toggle('hidden', !isCustom);
      const icon = document.getElementById('custom-accent-icon');
      if (icon) icon.classList.toggle('hidden', isCustom);
      if (isCustom) {
        customTrigger.classList.add('scale-110');
        customTrigger.classList.remove('border-transparent');
        customTrigger.classList.add('border-accent-400');
      } else {
        customTrigger.classList.remove('scale-110', 'border-accent-400');
        customTrigger.classList.add('border-transparent');
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  // ===== ICON ACCENT TOGGLE =====
  const iconToggle = document.getElementById('settings-icon-toggle');
  if (iconToggle) {
    // Load preference
    const loadIconPref = () => {
      fetch('/api/settings/preferences', { headers: headers() })
        .then(r => r.json())
        .then(data => {
          const enabled = !!(data.preferences && data.preferences.accentIcons);
          document.body.classList.toggle('accent-icons', enabled);
          iconToggle.classList.toggle('bg-accent-600', enabled);
          iconToggle.classList.toggle('border-accent-500', enabled);
          iconToggle.classList.toggle('bg-gray-300', !enabled);
          iconToggle.classList.toggle('border-gray-400', !enabled);
          const knob = iconToggle.querySelector('.settings-toggle-knob');
          if (knob) knob.style.transform = enabled ? 'translateX(1.5rem)' : 'translateX(0)';
        }).catch(() => {});
    };
    loadIconPref();

    iconToggle.addEventListener('click', () => {
      const isOn = document.body.classList.toggle('accent-icons');
      iconToggle.classList.toggle('bg-accent-600', isOn);
      iconToggle.classList.toggle('border-accent-500', isOn);
      iconToggle.classList.toggle('bg-gray-300', !isOn);
      iconToggle.classList.toggle('border-gray-400', !isOn);
      const knob = iconToggle.querySelector('.settings-toggle-knob');
      if (knob) knob.style.transform = isOn ? 'translateX(1.5rem)' : 'translateX(0)';
      fetch('/api/settings/preferences', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ accentIcons: isOn })
      }).catch(e => console.error('Failed to save icon pref', e));
    });
  }
}

// ===== DARK MODE GRADIENT MODAL =====
function _setupGradientSettings() {
  const gradModal = document.getElementById('gradient-modal');
  const gradBtn = document.getElementById('gradient-settings-btn');
  const gradCloseBtn = document.getElementById('gradient-picker-close');
  const gradCancel = document.getElementById('gradient-cancel');
  const gradApply = document.getElementById('gradient-apply');
  const gradOpSlider = document.getElementById('aura-op');
  const gradBgSlider = document.getElementById('aura-bright');
  const gradSatSlider = document.getElementById('aura-sat');
  const gradBlurSlider = document.getElementById('aura-blur');
  const gradOpVal = document.getElementById('aura-op-val');
  const gradBgVal = document.getElementById('aura-bright-val');
  const gradSatVal = document.getElementById('aura-sat-val');
  const gradBlurVal = document.getElementById('aura-blur-val');

  const styleToggle = document.getElementById('aura-style-toggle');

  if (gradBtn && gradModal) {
    let originalOp, originalBg, originalSat, originalBlur, originalSolid;
    let tempSolid = false;
    let isDark = false;

    const openGradModal = () => {
      isDark = document.documentElement.classList.contains('dark');
      
      // Sync sliders with prefs
      originalOp = currentPrefs.auraOp !== undefined ? currentPrefs.auraOp : 0.15;
      originalSat = currentPrefs.auraSat !== undefined ? currentPrefs.auraSat : 100;
      originalBlur = currentPrefs.auraBlur !== undefined ? currentPrefs.auraBlur : 60;
      originalSolid = !!currentPrefs.auraSolid;
      tempSolid = originalSolid;
      
      if (isDark) {
        gradBgSlider.min = 0;
        gradBgSlider.max = 20;
        originalBg = currentPrefs.bgDark !== undefined ? currentPrefs.bgDark : 2;
      } else {
        gradBgSlider.min = 80;
        gradBgSlider.max = 100;
        originalBg = currentPrefs.bgLight !== undefined ? currentPrefs.bgLight : 98;
      }
      
      gradOpSlider.value = originalOp * 100;
      gradBgSlider.value = originalBg;
      gradSatSlider.value = originalSat;
      gradBlurSlider.value = originalBlur;
      
      gradOpVal.textContent = Math.round(originalOp * 100) + '%';
      gradBgVal.textContent = originalBg + '%';
      gradSatVal.textContent = originalSat + '%';
      gradBlurVal.textContent = originalBlur + 'px';
      
      if (styleToggle) {
        const knob = styleToggle.querySelector('.settings-toggle-knob');
        if (tempSolid) {
          styleToggle.classList.replace('bg-gray-300', 'bg-accent-600');
          styleToggle.classList.replace('border-gray-400', 'border-accent-500');
          if (knob) knob.style.transform = 'translateX(1.25rem)';
        } else {
          styleToggle.classList.replace('bg-accent-600', 'bg-gray-300');
          styleToggle.classList.replace('border-accent-500', 'border-gray-400');
          if (knob) knob.style.transform = 'translateX(0)';
        }
      }

      gradModal.classList.remove('hidden');
      gradModal.classList.add('flex');
    };

    const closeGradModal = () => {
      gradModal.classList.add('hidden');
      gradModal.classList.remove('flex');
      // Revert temporary live-preview adjustments
      if (currentPrefs.auraOp !== undefined) {
        document.documentElement.style.setProperty('--aura-op', currentPrefs.auraOp);
      } else {
        document.documentElement.style.removeProperty('--aura-op');
      }
      if (currentPrefs.bgDark !== undefined) {
        document.documentElement.style.setProperty('--bg-color-dark', `hsl(var(--ac-h), var(--ac-s), ${currentPrefs.bgDark}%)`);
      } else {
        document.documentElement.style.removeProperty('--bg-color-dark');
      }
      if (currentPrefs.bgLight !== undefined) {
        document.documentElement.style.setProperty('--bg-color-light', `hsl(var(--ac-h), var(--ac-s), ${currentPrefs.bgLight}%)`);
      } else {
        document.documentElement.style.removeProperty('--bg-color-light');
      }
      if (currentPrefs.auraSat !== undefined) {
        document.documentElement.style.setProperty('--aura-sat', currentPrefs.auraSat + '%');
      } else {
        document.documentElement.style.removeProperty('--aura-sat');
      }
      if (currentPrefs.auraBlur !== undefined) {
        document.documentElement.style.setProperty('--aura-blur', currentPrefs.auraBlur + 'px');
      } else {
        document.documentElement.style.removeProperty('--aura-blur');
      }
      
      if (originalSolid) document.body.classList.add('aura-solid');
      else document.body.classList.remove('aura-solid');
    };

    gradBtn.addEventListener('click', openGradModal);
    gradCloseBtn.addEventListener('click', closeGradModal);
    gradCancel.addEventListener('click', closeGradModal);
    gradModal.addEventListener('click', (e) => {
      if (e.target === gradModal) closeGradModal();
    });

    // Live preview
    if (styleToggle) {
      styleToggle.addEventListener('click', () => {
        tempSolid = !tempSolid;
        document.body.classList.toggle('aura-solid', tempSolid);
        const knob = styleToggle.querySelector('.settings-toggle-knob');
        if (tempSolid) {
          styleToggle.classList.replace('bg-gray-300', 'bg-accent-600');
          styleToggle.classList.replace('border-gray-400', 'border-accent-500');
          if (knob) knob.style.transform = 'translateX(1.25rem)';
        } else {
          styleToggle.classList.replace('bg-accent-600', 'bg-gray-300');
          styleToggle.classList.replace('border-accent-500', 'border-gray-400');
          if (knob) knob.style.transform = 'translateX(0)';
        }
      });
    }

    gradOpSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      gradOpVal.textContent = val + '%';
      document.documentElement.style.setProperty('--aura-op', val / 100);
    });

    gradBgSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      gradBgVal.textContent = val + '%';
      if (isDark) {
        document.documentElement.style.setProperty('--bg-color-dark', `hsl(var(--ac-h), var(--ac-s), ${val}%)`);
      } else {
        document.documentElement.style.setProperty('--bg-color-light', `hsl(var(--ac-h), var(--ac-s), ${val}%)`);
      }
    });

    gradSatSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      gradSatVal.textContent = val + '%';
      document.documentElement.style.setProperty('--aura-sat', val + '%');
    });

    gradBlurSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      gradBlurVal.textContent = val + 'px';
      document.documentElement.style.setProperty('--aura-blur', val + 'px');
    });

    gradApply.addEventListener('click', async () => {
      const newOp = parseFloat(gradOpSlider.value) / 100;
      const newBg = parseFloat(gradBgSlider.value);
      const newSat = parseInt(gradSatSlider.value, 10);
      const newBlur = parseInt(gradBlurSlider.value, 10);
      
      currentPrefs.auraOp = newOp;
      if (isDark) {
        currentPrefs.bgDark = newBg;
      } else {
        currentPrefs.bgLight = newBg;
      }
      currentPrefs.auraSat = newSat;
      currentPrefs.auraBlur = newBlur;
      currentPrefs.auraSolid = tempSolid;
      
      try {
        await fetch('/api/settings/preferences', { 
          method: 'POST', 
          headers: headers(), 
          body: JSON.stringify({ 
            auraOp: newOp, 
            bgDark: currentPrefs.bgDark,
            bgLight: currentPrefs.bgLight,
            auraSat: newSat,
            auraBlur: newBlur,
            auraSolid: tempSolid
          }) 
        });
        document.documentElement.style.setProperty('--aura-op', newOp);
        if (isDark) document.documentElement.style.setProperty('--bg-color-dark', `hsl(var(--ac-h), var(--ac-s), ${newBg}%)`);
        else document.documentElement.style.setProperty('--bg-color-light', `hsl(var(--ac-h), var(--ac-s), ${newBg}%)`);
        document.documentElement.style.setProperty('--aura-sat', newSat + '%');
        document.documentElement.style.setProperty('--aura-blur', newBlur + 'px');
        
        if (tempSolid) document.body.classList.add('aura-solid');
        else document.body.classList.remove('aura-solid');
        
        gradModal.classList.add('hidden');
        gradModal.classList.remove('flex');
      } catch (err) {
        console.error('Failed to save gradient settings', err);
        alert('Failed to save settings.');
      }
    });
  }
}
_setupGradientSettings();

// Bind navigation tabs
document.querySelectorAll('.app-nav-tab').forEach(tab => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

// Setup accent color immediately
_setupAccentColorSettings();

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
  const past = isPastDate();
  currentTasks.forEach((task, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'task-item';

    // Delete button HTML — only for slots 4 and 5 (index 3 and 4)
    const deleteBtn = (i >= 3 && !past) ? `
      <button class="task-delete-btn" data-idx="${i}" title="Remove task">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>` : '';

    wrapper.innerHTML = `
      <div class="task-row">
        <div class="task-number task-number-${i+1}">${i+1}</div>
        <input type="text" class="task-input" data-idx="${i}" placeholder="Task ${i+1}..." value="${escHtml(task.text)}" ${past ? 'disabled' : ''}>
        ${(task.carryForwardCount||0) > 0 ? `<span class="carry-badge">↻${task.carryForwardCount}</span>` : ''}
        <button class="task-desc-toggle ${task.description ? 'active' : ''}" data-idx="${i}" title="Toggle description">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
        </button>
        <div class="status-dropdown-wrapper" data-idx="${i}">
          <button class="status-btn ${statusClass(task.status)}" data-idx="${i}" ${past ? 'disabled' : ''}>
            ${escHtml(statusLabel(task.status))}
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
          </button>
        </div>
        ${deleteBtn}
      </div>
      <div class="task-desc-wrapper" data-idx="${i}">
        <textarea class="task-desc-area" data-idx="${i}" rows="2" placeholder="Add notes..." ${past ? 'disabled' : ''}>${escHtml(task.description)}</textarea>
      </div>`;
    container.appendChild(wrapper);
  });

  // Update count label & add-task button
  const filledCount = currentTasks.filter(t => t.text && t.text.trim()).length;
  const displayMax = Math.max(DEFAULT_TASKS, Math.min(currentTasks.length, MAX_TASKS));
  document.getElementById('task-count-label').textContent = `${filledCount} / ${displayMax}`;
  const addBtn = document.getElementById('add-task-btn');
  if (past) addBtn.classList.add('hidden');
  else addBtn.classList.toggle('hidden', currentTasks.length >= MAX_TASKS);

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
  if (isPastDate()) return;
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
  const past = isPastDate();
  document.querySelectorAll('.donotdo-input').forEach((el, i) => { el.value = dnds[i] || ''; el.disabled = past; });
  const rewardEl = document.getElementById('reward-input');
  rewardEl.value = currentDailyData.dailyReward || ''; rewardEl.disabled = past;
  const brainEl = document.getElementById('braindump-textarea');
  brainEl.value = currentDailyData.brainDump || ''; brainEl.disabled = past;
  document.getElementById('reflection-well').value = currentDailyData.reflectionWell || '';
  document.getElementById('reflection-improve').value = currentDailyData.reflectionImprove || '';
  document.getElementById('antitodo-input').disabled = past;
  document.getElementById('antitodo-add').disabled = past;
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
  const past = isPastDate();
  (currentDailyData.antiToDo || []).forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'antitodo-item';
    div.innerHTML = `
      <svg class="w-4 h-4 antitodo-check" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
      <span class="flex-1 text-sm">${escHtml(item)}</span>
      ${past ? '' : `<span class="antitodo-remove" data-idx="${i}">✕</span>`}`;
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
  if (isPastDate()) return;
  const input = document.getElementById('antitodo-input');
  const val = input.value.trim(); if (!val) return;
  if (!currentDailyData.antiToDo) currentDailyData.antiToDo = [];
  currentDailyData.antiToDo.push(val); input.value = '';
  renderAntiToDo(); saveDailyField({ antiToDo: currentDailyData.antiToDo });
}

// ===== REFLECTION LOCK (unlocks after 6pm today) =====
function checkReflectionUnlock() {
  const card = document.getElementById('reflection-card');
  const wellTA = document.getElementById('reflection-well');
  const improveTA = document.getElementById('reflection-improve');
  const lockLabel = document.getElementById('reflection-lock-label');
  const overlayEl = card.querySelector('#reflection-body > .absolute');

  const now = new Date();
  const hour = now.getHours();
  const isToday = fmt(selectedDate) === fmt(now);
  const past = isPastDate();

  // Unlock: after 6pm today, OR any past date
  const unlocked = past || (isToday && hour >= 18);

  if (unlocked) {
    card.classList.add('reflection-unlocked');
    wellTA.disabled = !!past; improveTA.disabled = !!past;
    if (past) {
      lockLabel.textContent = '🔓 Read Only';
    } else {
      lockLabel.textContent = '🔓 Unlocked!';
    }
    lockLabel.classList.add('text-purple-500');
    lockLabel.classList.remove('text-gray-400');
  } else {
    card.classList.remove('reflection-unlocked');
    wellTA.disabled = true; improveTA.disabled = true;
    // Calculate hours remaining
    const hoursLeft = 18 - hour;
    const minsLeft = 60 - now.getMinutes();
    lockLabel.textContent = hoursLeft > 0
      ? `🔒 Unlocks at 6:00 PM (~${hoursLeft}h left)`
      : `🔒 Unlocks at 6:00 PM (~${minsLeft}m left)`;
    lockLabel.classList.remove('text-purple-500');
    lockLabel.classList.add('text-gray-400');
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

// ===== IDEAS =====

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
  document.getElementById('ideas-count').textContent = `${currentIdeas.length} ideas`;

  const addCard = document.createElement('div');
  addCard.className = 'idea-card idea-add-card card transition cursor-pointer';
  addCard.innerHTML = `
    <div class="idea-title text-gray-400 italic font-normal">Type new idea here...</div>
    <div class="idea-body opacity-50 text-gray-400">Click to expand and save</div>
    <div class="idea-meta mt-auto pt-3 border-t border-gray-100 dark:border-gray-800/50">
      <span class="idea-date">Now</span>
    </div>`;
  container.appendChild(addCard);
  addCard.addEventListener('click', () => {
    openIdeaModal(null);
  });

  // Render existing ideas (newest first)
  [...currentIdeas].reverse().forEach(idea => {
    const card = document.createElement('div');
    card.className = 'idea-card card transition';
    card.addEventListener('click', (e) => {
      if (e.target.closest('.idea-delete-btn')) return;
      openIdeaModal(idea.id);
    });
    
    const dateStr = idea.createdAt ? new Date(idea.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    card.innerHTML = `
      <div class="idea-title" title="${escHtml(idea.title)}">${escHtml(idea.title)}</div>
      <div class="idea-body opacity-80" title="${idea.body ? escHtml(idea.body) : ''}">${idea.body ? escHtml(idea.body) : '<span style="color:#6b7280;font-style:italic">No notes...</span>'}</div>
      <div class="idea-meta mt-auto pt-3 border-t border-gray-100 dark:border-gray-800/50">
        <span class="idea-date">${dateStr}</span>
        <button class="idea-delete-btn" data-id="${idea.id}" title="Delete idea">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </div>`;
    container.appendChild(card);
  });

  // Bind delete
  container.querySelectorAll('.idea-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteIdea(btn.dataset.id);
    });
  });
}

// Idea Modal Logic
const ideaModal = document.getElementById('idea-modal');
const ideaModalTitle = document.getElementById('idea-modal-title');
const ideaModalBody = document.getElementById('idea-modal-body');

function openIdeaModal(id) {
  activeIdeaId = id;
  const titleEl = document.getElementById('idea-modal-title');
  const bodyEl = document.getElementById('idea-modal-body');
  
  if (id) {
    const idea = currentIdeas.find(i => i.id === id);
    if (!idea) return;
    titleEl.value = idea.title;
    bodyEl.value = idea.body || '';
  } else {
    titleEl.value = '';
    bodyEl.value = '';
  }
  
  ideaModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if(!id) titleEl.focus();
}

function closeIdeaModal() {
  ideaModal.classList.add('hidden');
  document.body.style.overflow = '';
}

document.getElementById('idea-modal-close').addEventListener('click', closeIdeaModal);
document.getElementById('idea-modal-delete').addEventListener('click', () => {
  if (activeIdeaId) deleteIdea(activeIdeaId);
  closeIdeaModal();
});

document.getElementById('idea-modal-save').addEventListener('click', async () => {
  const title = ideaModalTitle.value.trim();
  const body = ideaModalBody.value.trim();
  if (!title) { ideaModalTitle.focus(); return; }
  
  const statusEl = document.getElementById('idea-modal-status');
  statusEl.style.opacity = '1';
  
  if (activeIdeaId) {
    // Update existing
    try {
      const res = await fetch(`/api/ideas/${activeIdeaId}`, {
        method: 'PUT', headers: headers(),
        body: JSON.stringify({ title, body })
      });
      if (res.ok) {
        const data = await res.json();
        const idx = currentIdeas.findIndex(i => i.id === activeIdeaId);
        if (idx !== -1) currentIdeas[idx] = { ...currentIdeas[idx], title: data.idea.title, body: data.idea.body };
        renderIdeas();
        statusEl.textContent = '✓ Saved';
        setTimeout(() => closeIdeaModal(), 400);
      }
    } catch(e) { console.error('saveIdea:', e); }
  } else {
    // Create new
    try {
      const res = await fetch('/api/ideas', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ title, body })
      });
      if (res.ok) {
        const data = await res.json();
        currentIdeas.push(data.idea);
        renderIdeas();
        statusEl.textContent = '✓ Created';
        setTimeout(() => closeIdeaModal(), 400);
      }
    } catch(e) { console.error('addIdea:', e); }
  }
  
  setTimeout(() => statusEl.style.opacity = '0', 1000);
});

// Hide modal on backdrop click
ideaModal.addEventListener('click', (e) => {
  if (e.target === ideaModal) closeIdeaModal();
});



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
  
  const filterBtn = document.getElementById('idea-todo-filter-btn');
  if (filterBtn) {
    filterBtn.textContent = showDoneIdeaTodos ? 'Show Active' : 'Show Done';
  }

  [...currentIdeaTodos].reverse().forEach(todo => {
    // Check if we should render this todo based on current filter state
    if (showDoneIdeaTodos && !todo.completed) return;
    if (!showDoneIdeaTodos && todo.completed) return;

    const item = document.createElement('div');
    item.className = `flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800/30 transition-all ${todo.completed ? 'opacity-60' : 'hover:shadow-md'}`;
    
    // Checkbox mapping completed state
    const checkBtn = document.createElement('button');
    checkBtn.className = `w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center border transition-colors ${todo.completed ? 'bg-accent-500 border-accent-500' : 'border-gray-300 dark:border-gray-600 hover:border-accent-500'}`;
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

document.getElementById('idea-todo-filter-btn')?.addEventListener('click', () => {
  showDoneIdeaTodos = !showDoneIdeaTodos;
  renderIdeaTodos();
});

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
  input.className = 'flex-1 text-sm font-medium px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 border-none outline-none focus:ring-1 focus:ring-accent-500 -ml-2';
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
document.getElementById('user-badge').addEventListener('click', () => { document.getElementById('settings-modal').classList.remove('hidden'); document.getElementById('north-star-input').value = northStarGoal || ''; });
document.getElementById('settings-close').addEventListener('click', () => { document.getElementById('settings-modal').classList.add('hidden'); });
document.getElementById('settings-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) document.getElementById('settings-modal').classList.add('hidden'); });

document.getElementById('settings-theme-toggle').addEventListener('click', async () => {
  const isDark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', isDark);

  // Sync Accent Colors immediately for the new mode
  const accentTheme = isDark ? (currentPrefs.accentDark || 'purple') : (currentPrefs.accentLight || 'purple');
  document.documentElement.setAttribute('data-theme', accentTheme);
  const customHex = isDark ? currentPrefs.customHexDark : currentPrefs.customHexLight;
  if (accentTheme === 'custom' && customHex && typeof generateCustomStyle === 'function') {
    generateCustomStyle(customHex);
  }

  try { await fetch('/api/settings/preferences', { method: 'POST', headers: headers(), body: JSON.stringify({ darkMode: isDark }) }); } catch {}
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

document.getElementById('export-btn').addEventListener('click', () => { window.location.href = `/api/export?token=${token}`; });
  const importInput = document.getElementById('import-input');
  importInput.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const formData = new FormData(); formData.append('importFile', file);
    const errEl = document.getElementById('data-msg'); errEl.className = 'text-sm text-center mt-2 hidden';
    try {
      const res = await fetch('/api/import', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden', 'text-green-500'); errEl.classList.add('text-rose-500'); }
      else { errEl.textContent = 'Import successful! Reloading...'; errEl.classList.remove('hidden', 'text-rose-500'); errEl.classList.add('text-green-500'); setTimeout(() => window.location.reload(), 1500); }
    } catch(err) { console.error('Import err:', err); errEl.textContent = 'Import failed'; errEl.classList.remove('hidden', 'text-green-500'); errEl.classList.add('text-rose-500'); }
    importInput.value = '';
  });
  
  // Danger Zone - Delete Account
  const delBtn = document.getElementById('delete-account-btn');
  const delConfirmBlock = document.getElementById('delete-account-confirm');
  const delCancel = document.getElementById('delete-account-cancel');
  const delFinal = document.getElementById('delete-account-final');
  const delMsg = document.getElementById('delete-account-msg');
  const delPwd = document.getElementById('delete-account-password');

  delBtn.addEventListener('click', () => {
    delBtn.classList.add('hidden');
    delConfirmBlock.classList.remove('hidden');
    delConfirmBlock.classList.add('flex');
    delMsg.classList.add('hidden');
    delPwd.value = '';
    delPwd.focus();
  });

  delCancel.addEventListener('click', () => {
    delConfirmBlock.classList.add('hidden');
    delConfirmBlock.classList.remove('flex');
    delBtn.classList.remove('hidden');
  });

  delFinal.addEventListener('click', async () => {
    const password = delPwd.value;
    if (!password) {
      delMsg.textContent = 'Password is required to delete account';
      delMsg.classList.remove('hidden');
      return;
    }
    
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: headers(),
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (res.ok) {
        logout();
      } else {
        delMsg.textContent = data.error || 'Failed to delete account';
        delMsg.classList.remove('hidden');
      }
    } catch (e) {
      delMsg.textContent = 'Connection error';
      delMsg.classList.remove('hidden');
    }
  });

// ===== NOTES VIEW LOGIC =====

async function loadNotes() {
  try {
    const res = await fetch('/api/notes', { headers: headers() });
    if (res.status === 401) { logout(); return; }
    const data = await res.json();
    currentNotes = data.notes || [];
    renderNotesList();
    if (currentNotes.length > 0 && !activeNoteId) {
      selectNote(currentNotes[currentNotes.length - 1].id);
    } else if (activeNoteId && currentNotes.find(n => n.id === activeNoteId)) {
      selectNote(activeNoteId);
    } else {
      selectNote(null);
    }
  } catch(e) { console.error('loadNotes:', e); }
}

function renderNotesList() {
  const list = document.getElementById('notes-list');
  list.innerHTML = '';
  
  [...currentNotes].reverse().forEach(note => {
    const item = document.createElement('div');
    const isActive = note.id === activeNoteId;
    item.className = `p-3 rounded-xl cursor-pointer transition flex flex-col gap-1 ${isActive ? 'bg-accent-100 dark:bg-accent-900/40 border border-accent-200 dark:border-accent-800' : 'hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'}`;
    
    const dateStr = note.updatedAt ? new Date(note.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    item.innerHTML = `
      <div class="font-semibold text-sm truncate ${isActive ? 'text-accent-700 dark:text-accent-300' : ''}">${escHtml(note.title)}</div>
      <div class="text-xs text-gray-500 dark:text-gray-400 flex justify-between">
        <span class="truncate pr-4">${note.content ? escHtml(note.content).substring(0, 30) + '...' : 'Empty...'}</span>
        <span class="shrink-0 flex items-center">${dateStr}</span>
      </div>
    `;
    item.addEventListener('click', () => selectNote(note.id));
    list.appendChild(item);
  });
}

function selectNote(id) {
  activeNoteId = id;
  const noteEmpty = document.getElementById('note-editor-empty');
  const noteEditor = document.getElementById('note-editor');
  
  renderNotesList(); // update active state in list
  
  if (!id) {
    noteEmpty.classList.remove('hidden');
    noteEditor.classList.add('hidden');
    noteEditor.classList.remove('flex');
    return;
  }
  
  const note = currentNotes.find(n => n.id === id);
  if (!note) return;
  
  noteEmpty.classList.add('hidden');
  noteEditor.classList.remove('hidden');
  noteEditor.classList.add('flex');
  
  const titleInput = document.getElementById('note-title-input');
  const contentInput = document.getElementById('note-content-input');
  titleInput.value = note.title;
  contentInput.value = note.content || '';
}

document.getElementById('add-note-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/notes', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ title: 'Untitled Note', content: '' })
    });
    if (res.ok) {
      const data = await res.json();
      currentNotes.push(data.note);
      selectNote(data.note.id);
      document.getElementById('note-title-input').focus();
      document.getElementById('note-title-input').select();
    }
  } catch(e) { console.error('createNote:', e); }
});

document.getElementById('note-delete-btn').addEventListener('click', () => {
  if (!activeNoteId) return;
  
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-modal-title').textContent = 'Delete Note?';
  const okBtn = document.getElementById('confirm-modal-ok');
  
  modal.classList.remove('hidden');
  
  const handleConfirm = async () => {
    modal.classList.add('hidden');
    cleanup();
    try {
      const res = await fetch(`/api/notes/${activeNoteId}`, { method: 'DELETE', headers: headers() });
      if (res.ok) {
        currentNotes = currentNotes.filter(n => n.id !== activeNoteId);
        activeNoteId = null;
        if (currentNotes.length > 0) selectNote(currentNotes[currentNotes.length - 1].id);
        else selectNote(null);
      }
    } catch(e) { console.error('deleteNote:', e); }
  };
  
  const handleCancel = () => {
    modal.classList.add('hidden');
    cleanup();
  };

  const cleanup = () => {
    okBtn.removeEventListener('click', handleConfirm);
    document.getElementById('confirm-modal-cancel').removeEventListener('click', handleCancel);
  };
  
  okBtn.addEventListener('click', handleConfirm);
  document.getElementById('confirm-modal-cancel').addEventListener('click', handleCancel);
});

const saveNoteChanges = async () => {
  if (!activeNoteId) return;
  const title = document.getElementById('note-title-input').value.trim() || 'Untitled Note';
  const content = document.getElementById('note-content-input').value;
  
  const status = document.getElementById('note-save-status');
  status.textContent = 'Saving...';
  status.style.opacity = '1';

  try {
    const res = await fetch(`/api/notes/${activeNoteId}`, {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ title, content })
    });
    if (res.ok) {
      const data = await res.json();
      const idx = currentNotes.findIndex(n => n.id === activeNoteId);
      if (idx !== -1) currentNotes[idx] = data.note;
      
      status.textContent = 'Saved';
      setTimeout(() => status.style.opacity = '0', 1000);
      renderNotesList(); // Refresh sidebar titles
    }
  } catch(e) { console.error('saveNote:', e); status.textContent = 'Error'; }
};

document.getElementById('note-title-input').addEventListener('input', () => debounce('saveNote', saveNoteChanges, 600));
document.getElementById('note-content-input').addEventListener('input', () => debounce('saveNote', saveNoteChanges, 600));

// ===== COUNTDOWN TIMER =====
let timerInterval = null;
let timerSeconds = 0;
let timerState = 'idle'; // idle | running | paused
let timerAlarmCtx = null;
let timerAlarmTimeout = null;
let timerEndEpoch = 0;
let scheduledAlarmNodes = []; // Pre-scheduled AudioContext beeps for background playback
let alarmNeedsSchedule = false; // Set when timer is restored but audio isn't unlocked yet

// Pre-create/unlock AudioContext on user gesture for background support
let globalTimerAudioCtx = null;

function unlockAudio() {
  if (!globalTimerAudioCtx) {
    globalTimerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (globalTimerAudioCtx.state === 'suspended') {
    globalTimerAudioCtx.resume();
  }
  // If a timer was restored from localStorage before audio was unlocked, schedule now
  if (alarmNeedsSchedule && timerState === 'running' && timerEndEpoch > Date.now()) {
    alarmNeedsSchedule = false;
    scheduleAlarmAtEnd();
  }
}

// Ensure audio is unlocked on the very first click anywhere
window.addEventListener('click', unlockAudio, { once: true });

// Persist timer across tabs/refresh via localStorage
const TIMER_LS_KEY = 'tm_timer';
let lastSavedTimerStr = '';

function saveTimerState() {
  const stateObj = { endEpoch: timerEndEpoch, state: timerState };
  if (timerState === 'paused') stateObj.secondsLeft = timerSeconds;
  
  const stateStr = JSON.stringify(stateObj);
  if (stateStr === lastSavedTimerStr && timerState === 'running') return; // Prevent API spam every tick
  lastSavedTimerStr = stateStr;

  if (timerState === 'idle') {
    localStorage.removeItem(TIMER_LS_KEY);
  } else {
    localStorage.setItem(TIMER_LS_KEY, stateStr);
  }
  
  // Sync with server if logged in
  if (token) {
    fetch('/api/timer', { method: 'POST', headers: headers(), body: JSON.stringify(timerState === 'idle' ? {} : stateObj) }).catch(()=>{});
  }
}

async function restoreTimerState() {
  // First load from localStorage for instant UI feedback
  const raw = localStorage.getItem(TIMER_LS_KEY);
  let saved = raw ? JSON.parse(raw) : null;
  
  // Try to load auth-synced timer from server
  if (token) {
    try {
      const res = await fetch('/api/timer', { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        if (data.timerState && Object.keys(data.timerState).length > 0) {
          // Server state overrides local state if it's newer (we just trust server for multi-device sync)
          saved = data.timerState;
          localStorage.setItem(TIMER_LS_KEY, JSON.stringify(saved));
        } else if (raw) {
          // Server is empty, but we have local state. Overwrite server.
          saveTimerState();
        }
      }
    } catch (e) { console.warn('Timer sync fail'); }
  }

  if (!saved) return;
  try {
    if (saved.state === 'running' && saved.endEpoch) {
      const remaining = Math.round((saved.endEpoch - Date.now()) / 1000);
      if (remaining > 0) {
        timerEndEpoch = saved.endEpoch;
        timerSeconds = remaining;
        timerState = 'running';
        updateTimerDisplay();
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(timerTick, 1000);
        scheduleAlarmAtEnd();
      } else {
        localStorage.removeItem(TIMER_LS_KEY);
        timerSeconds = 0; timerState = 'idle';
        updateTimerDisplay();
        triggerTimerAlarm();
        if (token) saveTimerState();
      }
    } else if (saved.state === 'paused' && saved.secondsLeft > 0) {
      timerSeconds = saved.secondsLeft;
      timerState = 'paused';
      updateTimerDisplay();
    }
  } catch { localStorage.removeItem(TIMER_LS_KEY); }
}

function updateTimerDisplay() {
  const display = document.getElementById('timer-display');
  const m = Math.floor(timerSeconds / 60);
  const s = timerSeconds % 60;
  display.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  
  display.classList.remove('timer-running','timer-paused','timer-done');
  
  const btn = document.getElementById('timer-start-btn');
  if (timerState === 'idle') btn.textContent = 'Start';
  else if (timerState === 'running') btn.textContent = 'Pause';
  else if (timerState === 'paused') btn.textContent = 'Resume';
}

// Pre-schedule alarm beeps into the AudioContext so they play even in background tabs.
// AudioContext scheduling is NOT throttled by background tab policies.
function scheduleAlarmAtEnd() {
  cancelScheduledAlarm();
  try {
    const ctx = globalTimerAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    globalTimerAudioCtx = ctx;

    const secsUntilEnd = Math.max(0, (timerEndEpoch - Date.now()) / 1000);
    const alarmStartTime = ctx.currentTime + secsUntilEnd;

    for (let i = 0; i < 60; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.4;
      osc.start(alarmStartTime + i * 0.5);
      osc.stop(alarmStartTime + i * 0.5 + 0.2);
      scheduledAlarmNodes.push(osc);
    }
  } catch(e) { console.error('scheduleAlarmAtEnd failed:', e); }
}

function cancelScheduledAlarm() {
  scheduledAlarmNodes.forEach(osc => { try { osc.stop(); } catch {} });
  scheduledAlarmNodes = [];
}

function triggerTimerAlarm() {
  // Also fire immediate alarm (for when tab comes back to foreground after expiry)
  try {
    const ctx = globalTimerAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    globalTimerAudioCtx = ctx;
    
    const playBeep = (offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.4;
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.2);
    };
    for (let i = 0; i < 60; i++) playBeep(i * 0.5);
    timerAlarmCtx = ctx;
    timerAlarmTimeout = setTimeout(stopTimerAlarm, 30500);
  } catch(e) { console.error('Audio failed:', e); }

  // Show dismissable alarm banner
  const existing = document.getElementById('timer-alarm-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'timer-alarm-banner';
  banner.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 z-[300] bg-gradient-to-r from-accent-600 to-accent-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 max-w-sm';
  banner.innerHTML = `
    <span class="text-2xl">⏰</span>
    <div class="flex-1">
      <p class="font-bold text-sm">Timer Finished!</p>
      <p class="text-xs opacity-80">Sound playing for 30 seconds…</p>
    </div>
    <button id="timer-alarm-close" class="px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-semibold transition">Close</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('timer-alarm-close').addEventListener('click', stopTimerAlarm);
  setTimeout(() => { if (document.getElementById('timer-alarm-banner')) document.getElementById('timer-alarm-banner').remove(); }, 31000);
}

function stopTimerAlarm() {
  cancelScheduledAlarm();
  if (timerAlarmCtx) {
    try { timerAlarmCtx.close(); } catch {}
    timerAlarmCtx = null;
    globalTimerAudioCtx = null; // Force re-create on next use
  }
  if (timerAlarmTimeout) { clearTimeout(timerAlarmTimeout); timerAlarmTimeout = null; }
  const banner = document.getElementById('timer-alarm-banner');
  if (banner) banner.remove();
}

function timerTick() {
  const now = Date.now();
  const left = Math.round((timerEndEpoch - now) / 1000);
  
  if (left <= 0) {
    timerSeconds = 0;
    updateTimerDisplay();
    clearInterval(timerInterval); timerInterval = null;
    timerState = 'idle';
    document.getElementById('timer-display').classList.add('timer-done');
    document.getElementById('timer-start-btn').textContent = 'Start';
    localStorage.removeItem(TIMER_LS_KEY);
    triggerTimerAlarm();
    return;
  }
  timerSeconds = left;
  updateTimerDisplay();
  saveTimerState();
}

// When user returns to tab, immediately sync the display
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && timerState === 'running') {
    timerTick(); // Force an immediate tick to catch up the UI
  }
});

document.getElementById('timer-start-btn').addEventListener('click', () => {
  unlockAudio();
  if (timerState === 'idle') {
    const input = document.getElementById('timer-minutes-input');
    const mins = parseInt(input.value);
    if (!mins || mins < 1) { input.focus(); return; }
    const now = new Date();
    const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
    const maxSecs = Math.floor((midnight - now) / 1000);
    timerSeconds = Math.min(mins * 60, maxSecs);
    timerEndEpoch = Date.now() + timerSeconds * 1000;
    timerState = 'running';
    updateTimerDisplay();
    timerInterval = setInterval(timerTick, 1000);
    saveTimerState();
    scheduleAlarmAtEnd(); // Pre-schedule beeps so they play even in background
  } else if (timerState === 'running') {
    clearInterval(timerInterval); timerInterval = null;
    cancelScheduledAlarm();
    timerState = 'paused';
    updateTimerDisplay();
    saveTimerState();
  } else if (timerState === 'paused') {
    timerEndEpoch = Date.now() + timerSeconds * 1000;
    timerState = 'running';
    updateTimerDisplay();
    timerInterval = setInterval(timerTick, 1000);
    saveTimerState();
    scheduleAlarmAtEnd();
  }
});

document.getElementById('timer-reset-btn').addEventListener('click', () => {
  clearInterval(timerInterval); timerInterval = null;
  cancelScheduledAlarm();
  timerSeconds = 0; timerState = 'idle';
  document.getElementById('timer-minutes-input').value = '';
  updateTimerDisplay();
  saveTimerState(); // Clears localStorage AND syncs idle state to server
});

document.querySelectorAll('.timer-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    unlockAudio();
    const mins = parseInt(btn.dataset.minutes);
    document.getElementById('timer-minutes-input').value = mins;
    const now = new Date();
    const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
    const maxSecs = Math.floor((midnight - now) / 1000);
    clearInterval(timerInterval); timerInterval = null;
    cancelScheduledAlarm();
    timerSeconds = Math.min(mins * 60, maxSecs);
    timerEndEpoch = Date.now() + timerSeconds * 1000;
    timerState = 'running';
    updateTimerDisplay();
    timerInterval = setInterval(timerTick, 1000);
    saveTimerState();
    scheduleAlarmAtEnd();
  });
});

// Restore timer on page load (now deferred to init function after auth)
// restoreTimerState();

// ===== SETTINGS LOGOUT =====
document.getElementById('settings-logout-btn').addEventListener('click', logout);

document.getElementById('logout-btn').addEventListener('click', logout);
function logout() {
  token = ''; currentUserId = '';
  localStorage.removeItem('tm_token'); localStorage.removeItem('tm_userId');
  window.location.reload(); // Reload to clear all states, intervals, and bypass CSS override
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
        // Now that config is loaded, restore timer specifically asking the server
        restoreTimerState();
      } else { logout(); }
    } catch { logout(); }
  } else {
    // No token, but could have local offline timer
    restoreTimerState();
  }
})();
