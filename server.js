require('dotenv').config();
const express = require('express');
const path = require('path');
const store = require('./server/store');
const ai = require('./server/ai');
const { computeAlerts, monitoringInfo, SEVERITY_RANK } = require('./server/alerts');
const auth = require('./server/auth');

const app = express();
app.use(express.json({ limit: '25mb' })); // photos arrive as base64 data URLs
auth.init();
auth.register(app); // sign-in API + page protection (must come before the static files)
app.use(express.static(path.join(__dirname, 'public')));

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message });
});
function findPatient(req, res) {
  const p = store.getPatient(req.params.id);
  if (!p) res.status(404).json({ error: 'Patient not found' });
  return p;
}

// What the patient/family may see: only approved plans.
function patientView(p) {
  const approved = p.plan?.status === 'approved';
  return {
    id: p.id, name: p.name, language: p.language, procedure: p.procedure,
    planStatus: p.plan?.status || 'none',
    plan: approved ? p.plan : null,
    reports: p.reports.map(({ photo, ...r }) => ({ ...r, hasPhoto: !!photo })),
    family: p.family
  };
}

// ---------- meta ----------
app.get('/api/status', (req, res) => res.json({ aiMode: ai.mode() }));

// ---------- STAFF ----------
app.get('/api/dashboard', (req, res) => {
  const rows = store.load().patients.map((p) => {
    const { alerts, score, top, monitoring } = computeAlerts(p);
    return {
      id: p.id, name: p.name, procedure: p.procedure, language: p.language,
      planStatus: p.plan?.status || 'none', dischargedAt: p.dischargedAt, lastActive: p.lastActive,
      openReports: p.reports.filter((r) => !r.staffResponse).length, alerts, score, top, monitoring
    };
  });
  rows.sort((a, b) => b.score - a.score);
  res.json({ patients: rows, aiMode: ai.mode() });
});

app.get('/api/patients/:id', (req, res) => {
  const p = findPatient(req, res);
  if (!p) return;
  const reports = [...p.reports].sort(
    (a, b) => (!!a.staffResponse - !!b.staffResponse) || (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || b.createdAt.localeCompare(a.createdAt)
  );
  res.json({ ...p, reports, ...computeAlerts(p) });
});

// New patient + photo of discharge papers -> AI draft (status: draft)
app.post('/api/patients', wrap(async (req, res) => {
  const { name, language = 'en-US', procedure = '', imageDataUrl } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const draft = await ai.draftPlan({ imageDataUrl, procedure });
  const p = {
    id: store.id('p'), name, language, procedure,
    dischargedAt: now(), lastActive: now(),
    sourceImage: imageDataUrl || null,
    plan: normalizeDraft(draft),
    reports: [], family: []
  };
  store.load().patients.push(p);
  auth.ensureClaimCodes(); // gives the new patient a discharge code (also saves)
  store.save();
  res.json({ patient: p, mock: !!draft._mock });
}));

// Re-draft from a new photo for an existing patient
app.post('/api/patients/:id/draft', wrap(async (req, res) => {
  const p = findPatient(req, res);
  if (!p) return;
  const draft = await ai.draftPlan({ imageDataUrl: req.body.imageDataUrl, procedure: p.procedure });
  p.sourceImage = req.body.imageDataUrl || p.sourceImage;
  p.plan = normalizeDraft(draft);
  store.save();
  res.json({ patient: p, mock: !!draft._mock });
}));

// Nurse edits and approves. Body: { plan, nurseName }. Translation happens on approval.
app.post('/api/patients/:id/approve', wrap(async (req, res) => {
  const p = findPatient(req, res);
  if (!p) return;
  const { plan, nurseName } = req.body;
  if (!nurseName) return res.status(400).json({ error: 'Nurse name is required to approve' });
  const clean = normalizeDraft(plan);
  // Re-approving an edited plan keeps the patient's check-off history and the original approval time
  const wasApproved = p.plan?.status === 'approved';
  const oldLogs = Object.fromEntries((p.plan?.checklist || []).map((c) => [c.id, c.log || []]));
  clean.checklist.forEach((c) => { if (oldLogs[c.id]) c.log = oldLogs[c.id]; });
  await ai.translatePlan(clean, p.language);
  clean.status = 'approved';
  clean.approvedBy = nurseName;
  clean.approvedAt = wasApproved ? p.plan.approvedAt : now();
  if (wasApproved) clean.updatedAt = now();
  // Monitoring ends N days after the first approval. Keep a nurse's extension unless the period was changed.
  const keepEnd = wasApproved && p.plan.monitorEndsAt && clean.monitorDays === p.plan.monitorDays;
  clean.monitorEndsAt = keepEnd ? p.plan.monitorEndsAt : new Date(new Date(clean.approvedAt).getTime() + clean.monitorDays * 86400000).toISOString();
  p.plan = clean;
  store.save();
  res.json({ patient: p });
}));

// Nurse responds to a report, optionally overriding the AI severity
app.post('/api/patients/:id/reports/:rid/respond', (req, res) => {
  const p = findPatient(req, res);
  if (!p) return;
  const r = p.reports.find((x) => x.id === req.params.rid);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  const { response, severity, nurseName, note } = req.body;
  if (severity) r.severity = severity;
  if (response) {
    r.staffResponse = response;
    r.respondedBy = nurseName || 'Nurse';
    r.respondedAt = now();
  }
  if (typeof note === 'string' && note.trim()) {
    r.staffNote = note.trim();
  }
  store.save();
  res.json({ report: r });
});

app.get('/api/patients/:id/reports/:rid/photo', (req, res) => {
  const p = findPatient(req, res);
  if (!p) return;
  const r = p.reports.find((x) => x.id === req.params.rid);
  res.json({ photo: r?.photo || null });
});

// Nurse ends monitoring early, extends it, or reopens it. Body: { action: 'end' | 'extend', days }
app.post('/api/patients/:id/monitoring', (req, res) => {
  const p = findPatient(req, res);
  if (!p) return;
  if (p.plan?.status !== 'approved') return res.status(400).json({ error: 'Approve a care plan first' });
  const { action, days = 7 } = req.body;
  const info = monitoringInfo(p.plan);
  if (action === 'end') {
    p.plan.monitorEndsAt = now();
  } else if (action === 'extend') {
    // Extend from the current end date, or from today if monitoring already ended
    const from = info.status === 'active' ? new Date(info.endsAt).getTime() : Date.now();
    p.plan.monitorEndsAt = new Date(from + Number(days) * 86400000).toISOString();
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }
  p.plan.monitorDays = Math.max(1, Math.round((new Date(p.plan.monitorEndsAt) - new Date(p.plan.approvedAt)) / 86400000));
  store.save();
  res.json({ monitoring: monitoringInfo(p.plan) });
});

// ---------- PATIENT ----------
app.get('/api/patient-view/:id', (req, res) => {
  const p = findPatient(req, res);
  if (!p) return;
  res.json({ ...patientView(p), monitoring: monitoringInfo(p.plan), today: today() });
});

// Toggle today's check-off for a checklist item
app.post('/api/patients/:id/checklist/:itemId', (req, res) => {
  const p = findPatient(req, res);
  if (!p) return;
  const item = p.plan?.checklist?.find((c) => c.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  item.log = item.log || [];
  const t = today();
  item.log = item.log.includes(t) ? item.log.filter((d) => d !== t) : [...item.log, t];
  store.touch(p);
  store.save();
  res.json({ item });
});

// Trouble report from patient or family. Body: { from, fromName, transcript, text, photoDataUrl, language }
app.post('/api/patients/:id/reports', wrap(async (req, res) => {
  const p = findPatient(req, res);
  if (!p) return;
  const { from = 'patient', fromName, transcript = '', text = '', photoDataUrl = null, language = p.language, familyCode } = req.body;
  if (from === 'family') {
    const member = p.family.find((f) => f.code === familyCode);
    if (!member || !member.permissions.canReport) return res.status(403).json({ error: 'Not allowed to send reports' });
  }
  if (!transcript && !text && !photoDataUrl) return res.status(400).json({ error: 'Add a voice note, text or photo' });

  const emergency = ai.isEmergency(`${transcript} ${text}`);
  const t = await ai.triageReport({ transcript, text, photoDataUrl, language, patient: p });
  const severity = emergency ? 'urgent' : (['urgent', 'soon', 'routine'].includes(t.severity) ? t.severity : 'soon');
  const report = {
    id: store.id('r'), from, fromName: fromName || p.name, createdAt: now(), language,
    transcript, text, translation: t.translation || '', photo: photoDataUrl,
    photoDescription: t.photo_description || '', severity, aiSeverity: severity,
    summary: t.summary || '', reason: t.reason || '', emergency,
    afterMonitoring: monitoringInfo(p.plan).status === 'ended',
    staffResponse: null, respondedAt: null
  };
  p.reports.push(report);
  store.touch(p);
  store.save();
  const { photo, ...safe } = report;
  res.json({ report: { ...safe, hasPhoto: !!photo }, mock: !!t._mock });
}));

// Family Circle: patient invites with chosen permissions
app.post('/api/patients/:id/family', (req, res) => {
  const p = findPatient(req, res);
  if (!p) return;
  const { name, relationship = '', permissions = {} } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const member = {
    code, name, relationship, createdAt: now(),
    permissions: {
      checklist: !!permissions.checklist, reports: !!permissions.reports,
      alerts: !!permissions.alerts, canReport: !!permissions.canReport
    }
  };
  p.family.push(member);
  store.save();
  res.json({ member });
});

app.delete('/api/patients/:id/family/:code', (req, res) => {
  const p = findPatient(req, res);
  if (!p) return;
  p.family = p.family.filter((f) => f.code !== req.params.code);
  store.save();
  res.json({ ok: true });
});

// ---------- FAMILY ----------
app.get('/api/family/:code', (req, res) => {
  const p = store.load().patients.find((x) => x.family.some((f) => f.code === req.params.code));
  if (!p) return res.status(404).json({ error: 'Invite code not found or access was removed' });
  const member = p.family.find((f) => f.code === req.params.code);
  const perms = member.permissions;
  const view = patientView(p);
  const { alerts } = computeAlerts(p);
  res.json({
    member,
    patient: { id: p.id, name: p.name, language: p.language, procedure: p.procedure, planStatus: view.planStatus },
    plan: perms.checklist ? view.plan : null,
    reports: perms.reports ? view.reports : null,
    alerts: perms.alerts ? alerts.filter((a) => a.level !== 'routine') : null,
    today: today()
  });
});

// ---------- helpers ----------
function normalizeDraft(d = {}) {
  return {
    status: 'draft',
    explanation_en: d.explanation_en || '',
    explanation_translated: d.explanation_translated || '',
    medications: (d.medications || []).map((m) => ({
      id: m.id || store.id('m'), name: m.name || '', dose: m.dose || '', time: m.time || '',
      instructions_en: m.instructions_en || '', instructions_translated: m.instructions_translated || ''
    })),
    appointments: (d.appointments || []).map((a) => ({
      id: a.id || store.id('a'), what_en: a.what_en || '', what_translated: a.what_translated || '', when: a.when || '',
      mode: a.mode === 'virtual' ? 'virtual' : 'in_person', // in_person | virtual
      location: a.location || '', // address or clinic + room, for in-person
      link: a.link && !/^https?:\/\//i.test(a.link) ? 'https://' + a.link : a.link || '' // video call link; adds https:// if missing
    })),
    checklist: (d.checklist || []).map((c) => ({
      id: c.id || store.id('c'), type: c.type === 'med' ? 'med' : 'task',
      task_en: c.task_en || '', task_translated: c.task_translated || '', log: c.log || []
    })),
    warning_signs: d.warning_signs || [],
    monitorDays: Math.min(90, Math.max(1, parseInt(d.monitorDays, 10) || 14)) // how many days staff follow this patient
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Platypal running at http://localhost:${PORT}  (AI mode: ${ai.mode()})`);
});