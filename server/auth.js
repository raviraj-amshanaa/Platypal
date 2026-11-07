// Accounts, sessions and page protection. No extra dependencies: Node's crypto (scrypt) + an httpOnly cookie.
//
// Roles (same three as the sign-in design):
//   patient : links to a patient record with the 6-digit "discharge code" (patient.claimCode, shown to staff)
//   family  : links to a family invite with the 6-digit code the patient shared (patient.family[].code)
//   staff   : needs the staff access code (env STAFF_ACCESS_CODE, default PLATY-STAFF-2026)
//
// Sessions live in memory, so a server restart signs everyone out. Users are stored in data/db.json.
const crypto = require('crypto');
const store = require('./store');

const COOKIE = 'platypal_session';
const SESSION_MS = 7 * 24 * 3600 * 1000;
const STAFF_CODE = () => (process.env.STAFF_ACCESS_CODE || 'PLATY-STAFF-2026').trim().toUpperCase();
const DEMO_ON = () => process.env.DEMO_ACCOUNTS !== 'off';
const DEMO_PASSWORD = 'platypal-demo';
const ROLES = ['patient', 'family', 'staff'];

const sessions = new Map(); // token -> { userId, expires }
const attempts = new Map(); // "ip|username" -> { n, reset }

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- passwords ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------- validation (mirrors the sign-up design) ----------
const normalizeUsername = (u) => String(u ?? '').trim().toLowerCase();
function validateCredentials({ username, password }) {
  const u = String(username ?? '').trim();
  if (u.length < 3) throw new HttpError(400, 'Username must be at least 3 characters');
  if (u.length > 30) throw new HttpError(400, 'Username must be 30 characters or fewer');
  if (!/^[a-zA-Z0-9_.-]+$/.test(u)) throw new HttpError(400, 'Use only letters, numbers, dots, dashes or underscores');
  const pw = String(password ?? '');
  if (pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (pw.length > 72) throw new HttpError(400, 'Password must be 72 characters or fewer');
  return { username: normalizeUsername(u), password: pw };
}

// ---------- data ----------
function users() {
  const db = store.load();
  if (!db.users) db.users = [];
  return db.users;
}
const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, fullName: u.fullName || null, patientId: u.patientId || null, familyCode: u.familyCode || null });

function homePath(u) {
  if (u.role === 'staff') return '/staff.html';
  if (u.role === 'patient') return '/patient.html?id=' + encodeURIComponent(u.patientId);
  return '/family.html?code=' + encodeURIComponent(u.familyCode);
}

function uniqueCode() {
  const db = store.load();
  const taken = new Set(db.patients.flatMap((p) => [p.claimCode, ...p.family.map((f) => f.code)]));
  let c;
  do { c = String(Math.floor(100000 + Math.random() * 900000)); } while (taken.has(c));
  return c;
}

// Every patient gets a discharge code the nurse can hand over (called on startup and when a patient is created).
function ensureClaimCodes() {
  let changed = false;
  for (const p of store.load().patients) if (!p.claimCode) { p.claimCode = uniqueCode(); changed = true; }
  if (changed) store.save();
}

// Fake demo accounts so the app can be shown without signing up first. Disable with DEMO_ACCOUNTS=off.
function ensureDemoUsers() {
  if (!DEMO_ON()) return;
  const db = store.load();
  const want = [
    { username: 'nurse.kim', role: 'staff', fullName: 'Nurse Kim' },
    { username: 'raj.patel', role: 'patient', fullName: 'Raj Patel', patientId: 'p_patel' },
    { username: 'priya.patel', role: 'family', fullName: 'Priya Patel', familyCode: '482913' }
  ];
  let changed = false;
  for (const w of want) {
    if (users().some((u) => u.username === w.username)) continue;
    if (w.patientId && !store.getPatient(w.patientId)) continue; // reset/custom data: skip what we can't link
    if (w.familyCode && !db.patients.some((p) => p.family.some((f) => f.code === w.familyCode))) continue;
    users().push({ id: store.id('u'), ...w, passwordHash: hashPassword(DEMO_PASSWORD), demo: true, createdAt: new Date().toISOString() });
    changed = true;
  }
  if (changed) store.save();
}

function init() { ensureClaimCodes(); ensureDemoUsers(); }

// ---------- actions ----------
function signup(body) {
  const role = body.role;
  if (!ROLES.includes(role)) throw new HttpError(400, 'Choose an account type');
  const { username, password } = validateCredentials(body);
  const code = String(body.accessCode ?? '').trim();
  const fullName = String(body.fullName ?? '').trim().slice(0, 100);
  const user = { id: store.id('u'), username, role, passwordHash: null, createdAt: new Date().toISOString() };

  if (role === 'staff') {
    if (!fullName) throw new HttpError(400, 'Enter your name');
    if (!code || !safeEqual(code.toUpperCase(), STAFF_CODE())) throw new HttpError(400, "That staff access code isn't valid.");
    user.fullName = fullName;
  } else if (role === 'family') {
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, "Enter the patient's 6-digit code");
    const patient = store.load().patients.find((p) => p.family.some((f) => f.code === code));
    if (!patient) throw new HttpError(400, "We couldn't find a patient with that code.");
    if (users().some((u) => u.familyCode === code)) throw new HttpError(400, 'That code has already been used to create an account.');
    user.familyCode = code;
    user.fullName = patient.family.find((f) => f.code === code).name;
  } else {
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter your 6-digit discharge code');
    const patient = store.load().patients.find((p) => p.claimCode === code);
    if (!patient) throw new HttpError(400, "We couldn't find a patient with that code.");
    if (users().some((u) => u.patientId === patient.id)) throw new HttpError(400, 'That code has already been used to create an account.');
    user.patientId = patient.id;
    user.fullName = patient.name;
  }
  if (users().some((u) => u.username === username)) throw new HttpError(409, 'That username is taken. Try another.');
  user.passwordHash = hashPassword(password);
  users().push(user);
  store.save();
  return user;
}

function login(body, ip = '') {
  const username = normalizeUsername(body.username);
  const key = ip + '|' + username;
  const a = attempts.get(key);
  if (a && a.reset > Date.now() && a.n >= 8) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  const user = users().find((u) => u.username === username);
  const ok = user && checkPassword(String(body.password ?? ''), user.passwordHash);
  if (!ok) {
    const cur = a && a.reset > Date.now() ? a : { n: 0, reset: Date.now() + 15 * 60000 };
    cur.n++; attempts.set(key, cur);
    throw new HttpError(401, "That username and password don't match.");
  }
  attempts.delete(key);
  if (body.role && user.role !== body.role) {
    const label = { patient: 'patient', family: 'family member', staff: 'hospital staff' }[body.role];
    throw new HttpError(403, `This account isn't a ${label} account.`);
  }
  return user;
}

// ---------- sessions / cookies ----------
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function startSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_MS });
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
}
function endSession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  return users().find((u) => u.id === s.userId) || null;
}

// ---------- Express wiring ----------
function register(app) {
  const send = (fn) => (req, res) => {
    try { fn(req, res); } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      console.error(e); res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  app.post('/api/auth/signup', send((req, res) => {
    const user = signup(req.body || {});
    startSession(res, user);
    res.json({ user: publicUser(user), next: homePath(user) });
  }));
  app.post('/api/auth/login', send((req, res) => {
    const user = login(req.body || {}, req.ip);
    startSession(res, user);
    res.json({ user: publicUser(user), next: homePath(user) });
  }));
  app.post('/api/auth/logout', send((req, res) => { endSession(req, res); res.json({ ok: true }); }));
  app.get('/api/auth/me', send((req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    res.json({ user: publicUser(user), next: homePath(user) });
  }));
  app.get('/api/auth/demo', (req, res) => res.json({
    accounts: DEMO_ON() ? users().filter((u) => u.demo).map((u) => ({ username: u.username, role: u.role, password: DEMO_PASSWORD })) : []
  }));

  // Protect the three app screens. Staff may open any of them (the staff screen links to the patient view).
  const guard = (role, check) => (req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.redirect('/');
    if (u.role === 'staff') return next();
    if (u.role !== role) return res.redirect(homePath(u));
    if (check && !check(u, req)) return res.redirect(homePath(u));
    next();
  };
  app.get('/staff.html', guard('staff'));
  app.get('/patient.html', guard('patient', (u, req) => req.query.id === u.patientId));
  app.get('/family.html', guard('family', (u, req) => req.query.code === u.familyCode));
}

module.exports = { init, register, ensureClaimCodes, currentUser, HttpError, signup, login, ROLES };
