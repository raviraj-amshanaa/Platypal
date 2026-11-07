// Shared helpers for every page.
const APP_NAME = 'Platypal';

const LANGS = {
  'en-US': 'English',
  'zh-CN': '中文 (普通话) Mandarin',
  'zh-HK': '中文 (廣東話) Cantonese',
  'hi-IN': 'हिन्दी Hindi',
  'pa-IN': 'ਪੰਜਾਬੀ Punjabi',
  'es-ES': 'Español Spanish',
  'ar-SA': 'العربية Arabic',
  'tl-PH': 'Tagalog'
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function sevBadge(level) {
  const label = { urgent: 'Urgent', soon: 'Soon', routine: 'Routine', ok: 'OK' }[level] || level;
  return `<span class="sev ${esc(level)}">${label}</span>`;
}

// Read-aloud with the browser's built-in voices (free, no API key)
function speak(text, lang) {
  if (!('speechSynthesis' in window)) return toast('Read-aloud is not supported in this browser');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang || 'en-US';
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

// Speech-to-text with the browser's Web Speech API (works best in Chrome / Edge)
function createRecognizer(lang, onText, onState) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang || 'en-US';
  rec.interimResults = true;
  rec.continuous = true;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t + ' ';
      else interim += t;
    }
    onText((finalText + interim).trim());
  };
  rec.onstart = () => onState(true);
  rec.onend = () => onState(false);
  rec.onerror = (e) => { toast('Microphone: ' + e.error); onState(false); };
  return {
    start() { finalText = ''; rec.start(); },
    stop() { rec.stop(); }
  };
}

// File input -> data URL (images are shrunk so uploads stay fast)
function fileToDataUrl(file, maxSize = 1600) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(reader.result);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// Client-side emergency check so the 911 banner shows instantly, before any network call
const EMERGENCY_WORDS = ['chest pain', "can't breathe", 'cannot breathe', 'not breathing', 'unconscious', 'passed out', 'heavy bleeding', 'stroke',
  '胸痛', '胸口痛', '呼吸困难', '喘不过气', '唞唔到氣', '昏迷', 'सीने में दर्द', 'सांस नहीं', 'dolor de pecho', 'no puedo respirar'];
function looksLikeEmergency(s = '') {
  const t = s.toLowerCase();
  return EMERGENCY_WORDS.some((w) => t.includes(w));
}

// Accessibility toggles (large text / high contrast), remembered per browser
function initA11yToggles() {
  const apply = (cls, on) => document.body.classList.toggle(cls, on);
  for (const cls of ['large', 'contrast']) {
    try {
      const saved = localStorage.getItem('a11y-' + cls);
      if (saved !== null) apply(cls, saved === '1');
    } catch {}
    const btn = document.getElementById('toggle-' + cls);
    if (btn) btn.onclick = () => {
      const on = !document.body.classList.contains(cls);
      apply(cls, on);
      try { localStorage.setItem('a11y-' + cls, on ? '1' : '0'); } catch {}
    };
  }
}

// One appointment, shown the same way on staff, patient and family pages.
// title = the appointment name in whichever language the viewer reads.
function appointmentHtml(a, title, lang) {
  const virtual = a.mode === 'virtual';
  const safeLink = /^https?:\/\//i.test(a.link || '') ? a.link : '';
  const where = virtual
    ? (safeLink
        ? `<a class="btn primary" href="${esc(safeLink)}" target="_blank" rel="noopener">💻 Join video call</a>`
        : '<span class="muted">Video link coming soon</span>')
    : (a.location
        ? `<div>📍 ${esc(a.location)}</div>
           <a class="small" href="https://www.google.com/maps/search/${encodeURIComponent(a.location)}" target="_blank" rel="noopener">Open in Maps</a>`
        : '<span class="muted">Location coming soon</span>');
  return `
    <div style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div class="row" style="justify-content:space-between">
        <strong ${lang ? `lang="${esc(lang)}"` : ''}>${esc(title)}</strong>
        <span class="pill">${virtual ? '💻 Virtual' : '🏥 In person'}</span>
      </div>
      <div class="muted">🗓 ${esc(a.when)}</div>
      <div style="margin-top:6px">${where}</div>
    </div>`;
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}
// Signed-in bar: shows a Sign out button in the top bar and pre-fills the nurse's name.
(async function initSession() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return;
    const { user } = await res.json();
    const nurse = document.getElementById('nurse-name');
    if (nurse && user.role === 'staff' && user.fullName) nurse.value = user.fullName;
    const btn = document.createElement('button');
    btn.textContent = 'Sign out';
    btn.title = 'Signed in as ' + user.username;
    btn.onclick = async () => {
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      location.href = '/';
    };
    bar.appendChild(btn);
  } catch {}
})();
