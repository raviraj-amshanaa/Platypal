// auth-guard.js: injected into staff.html, patient.html and family.html by server.js.
// The token lives in sessionStorage, so each browser tab has its own sign-in:
// you can keep a staff tab and a patient tab open side by side for the demo.
(() => {
  const KEY = 'platypal_token';
  const page = location.pathname.split('/').pop();
  const token = sessionStorage.getItem(KEY);
  const familyCode = new URLSearchParams(location.search).get('code');
  const isApi = (u) => /^\/?api\//.test(u);

  // Every /api call carries the sign-in token (or the family invite code on the family page).
  const rawFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (isApi(url)) {
      const headers = new Headers(init.headers || {});
      if (page === 'family.html') { if (familyCode) headers.set('X-Family-Code', familyCode); }
      else if (token) headers.set('Authorization', 'Bearer ' + token);
      init = { ...init, headers };
    }
    return rawFetch(input, init);
  };

  if (page === 'family.html') return; // family uses invite codes, no account

  const toLogin = () => location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
  if (!token) return toLogin();

  document.documentElement.style.visibility = 'hidden'; // hide until we know who is here
  rawFetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(({ user }) => {
      const want = page === 'staff.html' ? 'staff' : 'patient';
      const home = user.role === 'staff' ? '/staff.html' : '/patient.html?id=' + encodeURIComponent(user.patientId);
      if (user.role !== want) return location.replace(home);
      if (want === 'patient' && new URLSearchParams(location.search).get('id') !== user.patientId) return location.replace(home);
      document.documentElement.style.visibility = '';
      addBadge(user);
    })
    .catch(() => { sessionStorage.removeItem(KEY); toLogin(); });

  function addBadge(user) {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;gap:10px;align-items:center;' +
      'padding:8px 12px;border-radius:999px;background:#14202b;color:#fff;font:600 14px system-ui,sans-serif;';
    const who = document.createElement('span');
    who.textContent = (user.role === 'staff' ? 'Care team: ' : 'Patient: ') + user.name;
    const out = document.createElement('button');
    out.textContent = 'Sign out';
    out.style.cssText = 'font:inherit;color:#14202b;background:#fff;border:0;border-radius:999px;padding:4px 12px;cursor:pointer;';
    out.onclick = async () => {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) { /* sign out locally anyway */ }
      sessionStorage.removeItem(KEY);
      location.replace('/login.html');
    };
    bar.append(who, out);
    const add = () => document.body.appendChild(bar);
    document.body ? add() : document.addEventListener('DOMContentLoaded', add);
  }
})();
