// Accounts for Platypal: staff and patient logins, token sessions, role guards.
// Family members do NOT have accounts: they keep using the patient's 6-digit invite code.
const crypto = require('crypto');
const store = require('./store');

const SESSION_MS = 12 * 60 * 60 * 1000;
const DEMO_STAFF = { username: 'nurse', password: 'platypal', name: 'Rivera' };
const DEMO_PATIENT_PASSWORD = 'demo1234';

// ---------- passwords (built-in scrypt, no extra dependency) ----------
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;

function checkPw(pw, stored = '') {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const a = Buffer.from(key, 'hex');
  const b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const tempPassword = () => crypto.randomBytes(5).toString('hex');

// ---------- users and sessions live in the same JSON db as patients ----------
function data() {
  const d = store.load();
  d.users = d.users || [];
  d.sessions = d.sessions || {};
  return d;
}
const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, name: u.name, patientId: u.patientId || null });

// Callers must call store.save() afterwards.
function createUser({ username, password, role, name, patientId, demo }) {
  const d = data();
  username = String(username || '').trim().toLowerCase();
  if (!username) throw new Error('Username is required');
  if (d.users.some((u) => u.username === username)) throw new Error('That username is taken');
  const user = {
    id: 'u_' + crypto.randomBytes(4).toString('hex'), username, role, name,
    patientId: patientId || null, passwordHash: hashPw(password), demo: !!demo,
    createdAt: new Date().toISOString()
  };
  d.users.push(user);
  return user;
}

// One login per patient, issued by staff. Returns null if the patient already has one.
function createPatientAccount(p, password, demo = false) {
  const d = data();
  if (d.users.some((u) => u.patientId === p.id)) return null;
  const lastWord = String(p.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean).pop();
  const base = lastWord || p.id.toLowerCase().replace(/[^a-z0-9]/g, '');
  let username = base, n = 2;
  while (d.users.some((u) => u.username === username)) username = base + n++;
  const pw = password || tempPassword();
  createUser({ username, password: pw, role: 'patient', name: p.name, patientId: p.id, demo });
  return { username, tempPassword: pw };
}

// Runs at startup: makes sure a demo nurse exists and every patient has a login.
function ensureAccounts() {
  const d = data();
  if (!d.users.some((u) => u.role === 'staff')) {
    createUser({ ...DEMO_STAFF, role: 'staff', demo: true });
  }
  for (const p of d.patients) createPatientAccount(p, DEMO_PATIENT_PASSWORD, true);
  store.save();
  console.log('Demo logins (change or remove before any real use):');
  console.log(`  staff    ${DEMO_STAFF.username} / ${DEMO_STAFF.password}`);
  d.users.filter((u) => u.demo && u.role === 'patient')
    .forEach((u) => console.log(`  patient  ${u.username} / ${DEMO_PATIENT_PASSWORD}`));
}

function startSession(user) {
  const d = data();
  const now = Date.now();
  for (const [t, s] of Object.entries(d.sessions)) if (s.expires < now) delete d.sessions[t];
  const token = crypto.randomBytes(32).toString('hex');
  d.sessions[token] = { userId: user.id, expires: now + SESSION_MS };
  store.save();
  return token;
}

// ---------- middleware ----------
// Reads "Authorization: Bearer <token>" and sets req.user (or null).
function attach(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const d = data();
  const s = m && d.sessions[m[1]];
  req.token = m ? m[1] : null;
  req.user = s && s.expires > Date.now() ? d.users.find((u) => u.id === s.userId) || null : null;
  next();
}

const deny = (req, res) =>
  res.status(req.user ? 403 : 401).json({ error: req.user ? 'You do not have access to that' : 'Please sign in' });

const canAccessPatient = (u, id) => !!u && (u.role === 'staff' || u.patientId === id);
const requireStaff = (req, res, next) => (req.user?.role === 'staff' ? next() : deny(req, res));
const requirePatientAccess = (req, res, next) => (canAccessPatient(req.user, req.params.id) ? next() : deny(req, res));
const requireOwnPatient = (req, res, next) =>
  (req.user?.role === 'patient' && req.user.patientId === req.params.id ? next() : deny(req, res));

// ---------- routes ----------
function routes(app) {
  app.post('/api/auth/login', (req, res) => {
    const { username = '', password = '' } = req.body;
    const user = data().users.find((u) => u.username === String(username).trim().toLowerCase());
    if (!user || !checkPw(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    res.json({ token: startSession(user), user: publicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.token) { delete data().sessions[req.token]; store.save(); }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) =>
    req.user ? res.json({ user: publicUser(req.user) }) : res.status(401).json({ error: 'Not signed in' }));

  // New care-team accounts need the invite code from STAFF_SIGNUP_CODE in .env (disabled if unset).
  app.post('/api/auth/staff-signup', (req, res) => {
    const { name, username, password, code } = req.body;
    const required = process.env.STAFF_SIGNUP_CODE;
    if (!required || code !== required) return res.status(403).json({ error: 'Invalid staff invite code' });
    if (!name || !username || String(password || '').length < 8) {
      return res.status(400).json({ error: 'Name, username and a password of 8+ characters are required' });
    }
    try {
      const user = createUser({ username, password, role: 'staff', name });
      res.json({ token: startSession(user), user: publicUser(user) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Staff issue a fresh temporary password for a patient (also creates the login if missing).
  app.post('/api/patients/:id/reset-password', requireStaff, (req, res) => {
    const p = store.getPatient(req.params.id);
    if (!p) return res.status(404).json({ error: 'Patient not found' });
    const d = data();
    const pw = tempPassword();
    const user = d.users.find((u) => u.patientId === p.id);
    let username;
    if (user) {
      user.passwordHash = hashPw(pw);
      user.demo = false;
      username = user.username;
      for (const [t, s] of Object.entries(d.sessions)) if (s.userId === user.id) delete d.sessions[t];
    } else {
      username = createPatientAccount(p, pw).username;
    }
    store.save();
    res.json({ username, tempPassword: pw });
  });
}

module.exports = {
  attach, routes, ensureAccounts, createPatientAccount,
  canAccessPatient, requireStaff, requirePatientAccess, requireOwnPatient
};
