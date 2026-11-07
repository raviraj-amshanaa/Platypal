// Sign-in and sign-up screens (one script, two pages). Looks like the design export; talks to /api/auth/*.
(() => {
  const page = document.body.dataset.page; // 'signin' | 'signup'
  const card = document.getElementById('card');

  const ROLES = ['patient', 'family', 'staff'];
  const INFO = {
    patient: { label: 'Patient', pick: "I'm a patient", blurb: "See your care plan and tell your team how you're doing." },
    family: { label: 'Family member', pick: "I'm a family member", blurb: "Stay close to a loved one's recovery." },
    staff: { label: 'Hospital staff', pick: "I'm hospital staff", blurb: 'Review plans and respond to patient reports.' }
  };
  const ICONS = {
    patient: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
    family: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    staff: '<path d="M11 2v2"/><path d="M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/>'
  };
  const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  let role = ROLES.includes(new URLSearchParams(location.search).get('role')) ? new URLSearchParams(location.search).get('role') : null;
  let me = null;
  let demo = [];
  let prefill = {};

  // ---------- views ----------
  function pickerHtml() {
    return `<div class="picker">${ROLES.map((r, i) => `
      <button type="button" class="role ${r}" data-role="${r}" style="animation-delay:${i * 80}ms">
        <span class="ico">${svg(ICONS[r])}</span>
        <span><span class="t">${INFO[r].pick}</span><span class="d">${INFO[r].blurb}</span></span>
      </button>`).join('')}</div>`;
  }

  function field(id, label, opts = {}) {
    const { type = 'text', hint = '', autocomplete = '', inputmode = '', value = '' } = opts;
    return `<div class="field">
      <label for="${id}">${label}</label>
      <input id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${autocomplete ? `autocomplete="${autocomplete}"` : ''} ${inputmode ? `inputmode="${inputmode}"` : ''} ${hint ? `aria-describedby="${id}-hint"` : ''} autocapitalize="off" spellcheck="false" />
      ${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ''}
    </div>`;
  }

  function signedInHtml() {
    return `<div class="notice">
      <p>You're signed in as <strong>${esc(me.user.fullName || me.user.username)}</strong>.</p>
      <div class="actions">
        <a class="btn" href="${esc(me.next)}">Continue</a>
        <button type="button" class="btn outline" id="signout">Sign out</button>
      </div></div>`;
  }

  function demoHtml() {
    if (!demo.length || page !== 'signin') return '';
    return `<details class="demo"><summary>Try a demo account</summary>
      <ul>${demo.map((d) => `<li><span><code>${esc(d.username)}</code> · ${esc(INFO[d.role].label.toLowerCase())}</span>
        <button type="button" data-demo="${esc(d.username)}">Use</button></li>`).join('')}</ul>
      <p class="note">Password for all demo accounts: <code>${esc(demo[0].password)}</code>. All data is fake.</p></details>`;
  }

  function render(focusTitle = true) {
    const signin = page === 'signin';
    let html = '<div id="slot-top"></div>';
    if (!role) {
      html += `<h1 class="title" tabindex="-1">${signin ? 'Welcome back' : 'Create your account'}</h1>
        <p class="sub">${signin ? "Who's signing in today?" : 'First, tell us who you are.'}</p>${pickerHtml()}
        <p class="foot">${signin
          ? 'New to Platypal? <a href="/signup.html">Create an account</a>'
          : 'Already have an account? <a href="/">Sign in</a>'}</p><div id="slot-demo"></div>`;
    } else {
      const f = prefill;
      let fields = '';
      if (!signin && role === 'staff') fields += field('accessCode', 'Staff access code', { value: f.accessCode }) + field('fullName', 'Full name', { autocomplete: 'name', value: f.fullName });
      if (!signin && role === 'family') fields += field('accessCode', "Patient's access code", { hint: 'Ask the patient for the 6-digit code they shared with you.', inputmode: 'numeric' });
      if (!signin && role === 'patient') fields += field('accessCode', 'Discharge code', { hint: 'Your nurse can give you this 6-digit code.', inputmode: 'numeric' });
      fields += field('username', 'Username', { autocomplete: 'username', value: f.username });
      fields += field('password', 'Password', { type: 'password', autocomplete: signin ? 'current-password' : 'new-password', hint: signin ? '' : 'At least 8 characters.', value: f.password });
      html += `<form class="auth-form" id="form" novalidate>
        <button type="button" class="back" id="back">${svg('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>')} Change</button>
        <h1 class="title" tabindex="-1">${INFO[role].label} ${signin ? 'sign in' : 'sign up'}</h1>
        ${fields}
        <p class="error" id="error" role="alert" hidden></p>
        <button class="btn" type="submit" id="submit">${signin ? 'Sign in' : 'Create account'}</button>
        ${signin ? `<p class="foot" style="margin:0">Don't have an account? <a href="/signup.html?role=${role}">Sign up</a></p>` : ''}
      </form>
      ${signin ? '' : '<p class="foot">Already have an account? <a href="/">Sign in</a></p>'}`;
    }
    card.innerHTML = html;
    prefill = {};
    fillSlots();
    bind();
    if (focusTitle) {
      const target = role ? card.querySelector('input') : null;
      if (target) target.focus();
    }
  }

  // Late data (signed-in state, demo accounts) is dropped into placeholders so the card doesn't re-animate.
  function fillSlots() {
    const top = card.querySelector('#slot-top');
    if (top) top.innerHTML = me && page === 'signin' && !role ? signedInHtml() : '';
    const d = card.querySelector('#slot-demo');
    if (d) d.innerHTML = demoHtml();
    bind();
  }

  // ---------- behaviour ----------
  const val = (id) => (card.querySelector('#' + id)?.value ?? '');
  function showError(msg) {
    const el = card.querySelector('#error');
    if (!el) return;
    el.textContent = msg; el.hidden = !msg;
  }

  function validate() {
    const u = val('username').trim();
    if (page === 'signin') {
      if (u.length < 3) return 'Enter your username';
      if (!val('password')) return 'Enter your password';
      return '';
    }
    if (role === 'staff') {
      if (!val('accessCode').trim()) return 'Enter the staff access code';
      if (!val('fullName').trim()) return 'Enter your name';
    } else if (!/^\d{6}$/.test(val('accessCode').trim())) {
      return role === 'family' ? "Enter the patient's 6-digit code" : 'Enter your 6-digit discharge code';
    }
    if (u.length < 3) return 'Username must be at least 3 characters';
    if (u.length > 30) return 'Username must be 30 characters or fewer';
    if (!/^[a-zA-Z0-9_.-]+$/.test(u)) return 'Use only letters, numbers, dots, dashes or underscores';
    if (val('password').length < 8) return 'Password must be at least 8 characters';
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    showError('');
    const problem = validate();
    if (problem) return showError(problem);
    const btn = card.querySelector('#submit');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = page === 'signin' ? 'Signing in…' : 'Creating account…';
    try {
      const body = { role, username: val('username').trim(), password: val('password') };
      if (page === 'signup') { body.accessCode = val('accessCode').trim(); body.fullName = val('fullName').trim(); }
      const data = await post(page === 'signin' ? '/api/auth/login' : '/api/auth/signup', body);
      location.href = data.next;
    } catch (err) {
      showError(err.message);
      btn.disabled = false; btn.textContent = label;
    }
  }

  function bind() {
    card.querySelectorAll('[data-role]').forEach((b) => (b.onclick = () => { role = b.dataset.role; render(); }));
    const back = card.querySelector('#back');
    if (back) back.onclick = () => { role = null; render(false); card.querySelector('.title')?.focus(); };
    const form = card.querySelector('#form');
    if (form) form.onsubmit = submit;
    const out = card.querySelector('#signout');
    if (out) out.onclick = async () => { await post('/api/auth/logout').catch(() => {}); me = null; fillSlots(); };
    card.querySelectorAll('[data-demo]').forEach((b) => (b.onclick = () => {
      const d = demo.find((x) => x.username === b.dataset.demo);
      role = d.role; prefill = { username: d.username, password: d.password }; render();
    }));
  }

  render(false);
  fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { me = d; fillSlots(); } }).catch(() => {});
  if (page === 'signin') fetch('/api/auth/demo').then((r) => r.json()).then((d) => { demo = d.accounts || []; fillSlots(); }).catch(() => {});
})();
