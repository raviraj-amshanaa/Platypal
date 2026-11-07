// Care team view. Person B owns this file.
let selectedId = null;
let mode = 'empty'; // empty | new | review | detail
let current = null; // full patient object for review/detail

const nurseName = () => document.getElementById('nurse-name').value.trim() || 'Nurse';
const panel = document.getElementById('panel');

// ---------- left list ----------
async function loadList() {
  const { patients, aiMode } = await api('/api/dashboard');
  document.getElementById('ai-mode').textContent = 'AI: ' + aiMode;
  // Patients whose monitoring ended (and who haven't sent anything new) go in their own section at the bottom
  const ended = patients.filter((p) => p.monitoring?.status === 'ended' && p.openReports === 0);
  const active = patients.filter((p) => !ended.includes(p));
  const row = (p) => `
    <div class="patient-row border-${esc(p.top)} ${p.id === selectedId ? 'active' : ''}" data-id="${esc(p.id)}" tabindex="0" role="button">
      <div class="row" style="justify-content:space-between">
        <strong>${esc(p.name)}</strong>${sevBadge(p.top)}
      </div>
      <div class="muted small">${esc(p.procedure)} · ${esc(LANGS[p.language] || p.language)} · discharged ${timeAgo(p.dischargedAt)}</div>
      ${monitoringLabel(p.monitoring)}
      ${p.alerts.length ? `<ul class="alert-list">${p.alerts.map((a) => `<li>${esc(a.text)}</li>`).join('')}</ul>` : '<div class="small muted">No alerts</div>'}
    </div>`;
  document.getElementById('patient-list').innerHTML =
    active.map(row).join('') +
    (ended.length ? `<h3 class="muted" style="margin:18px 0 8px">Monitoring ended</h3>${ended.map(row).join('')}` : '');
  document.querySelectorAll('.patient-row').forEach((el) => {
    const open = () => openPatient(el.dataset.id);
    el.onclick = open;
    el.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  });
}

async function openPatient(id) {
  selectedId = id;
  current = await api('/api/patients/' + id);
  mode = current.plan?.status === 'approved' ? 'detail' : current.plan?.status === 'draft' ? 'review' : 'nodraft';
  render();
  loadList();
}

function render() {
  if (mode === 'new') return renderNew();
  if (mode === 'review') return renderReview();
  if (mode === 'detail') return renderDetail();
  if (mode === 'nodraft') return renderNoDraft();
}

// ---------- new discharge ----------
function renderNew() {
  panel.innerHTML = document.getElementById('new-discharge-tpl').innerHTML;
  document.getElementById('nd-lang').innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  let photo = null;
  document.getElementById('nd-photo').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    photo = await fileToDataUrl(f);
    const img = document.getElementById('nd-preview');
    img.src = photo;
    img.classList.remove('hidden');
  };
  document.getElementById('nd-submit').onclick = async (e) => {
    const name = document.getElementById('nd-name').value.trim();
    if (!name) return toast('Enter the patient name');
    e.target.disabled = true;
    document.getElementById('nd-status').textContent = 'AI is reading the papers…';
    try {
      const { patient, mock } = await api('/api/patients', {
        method: 'POST',
        body: { name, procedure: document.getElementById('nd-proc').value.trim(), language: document.getElementById('nd-lang').value, imageDataUrl: photo }
      });
      if (mock) toast('Showing a sample draft (no AI key or no photo)');
      await openPatient(patient.id);
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
      document.getElementById('nd-status').textContent = '';
    }
  };
}

function renderNoDraft() {
  panel.innerHTML = `
    <div class="card stack">
      <h2>${esc(current.name)}</h2>
      <p class="muted">${esc(current.procedure)} · ${esc(LANGS[current.language] || current.language)}</p>
      <div class="notice">No care plan yet. Photograph the discharge papers to create an AI draft.</div>
      <input id="nd-photo" type="file" accept="image/*" capture="environment" aria-label="Photo of discharge papers" />
      <button class="primary big" id="draft-btn">Create AI draft</button>
    </div>`;
  let photo = null;
  document.getElementById('nd-photo').onchange = async (e) => { if (e.target.files[0]) photo = await fileToDataUrl(e.target.files[0]); };
  document.getElementById('draft-btn').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'AI is reading the papers…';
    try {
      await api(`/api/patients/${current.id}/draft`, { method: 'POST', body: { imageDataUrl: photo } });
      await openPatient(current.id);
    } catch (err) { toast(err.message); e.target.disabled = false; }
  };
}

// ---------- review & approve ----------
function renderReview() {
  const p = current;
  const plan = p.plan;
  panel.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">Review AI draft: ${esc(p.name)}</h2>
        <span class="sev soon">Draft – patient can't see this yet</span>
      </div>
      <p class="muted small">Check every item against the original. Edit, remove or add anything, then approve. It will be translated to ${esc(LANGS[p.language] || p.language)} on approval.</p>
      <div class="grid cols-2">
        <div>
          <h3>Original</h3>
          ${p.sourceImage ? `<img class="source-img" src="${p.sourceImage}" alt="Discharge papers" />` : '<div class="notice small">No photo uploaded (sample draft)</div>'}
        </div>
        <div class="stack">
          <div><label for="rv-expl">Plain-language explanation</label><textarea id="rv-expl">${esc(plan.explanation_en)}</textarea></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Medications</h3>
      <div class="edit-row small muted"><span>Name</span><span>Dose</span><span>When</span><span>Instructions</span><span></span></div>
      <div id="rv-meds"></div>
      <button id="add-med">+ Add medication</button>
    </div>

    <div class="card">
      <h3>Follow-up appointments</h3>
      <div id="rv-appts"></div>
      <button id="add-appt">+ Add appointment</button>
    </div>

    <div class="card">
      <h3>Daily checklist</h3>
      <div id="rv-checks"></div>
      <button id="add-check">+ Add checklist item</button>
    </div>

    ${plan.warning_signs?.length ? `<div class="card"><h3>Warning signs found</h3><ul>${plan.warning_signs.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}

    <div class="card row" style="justify-content:space-between">
      <div class="row">
        <label for="rv-monitor" style="margin:0">Monitor this patient for</label>
        <select id="rv-monitor" style="width:auto">
          ${[7, 14, 30].map((d) => `<option value="${d}" ${d === (plan.monitorDays || 14) ? 'selected' : ''}>${d} days</option>`).join('')}
        </select>
      </div>
      <span class="muted">Approving as <strong>${esc(nurseName())}</strong></span>
      <button class="primary big" id="approve-btn">Approve &amp; send to patient</button>
    </div>`;

  const medRow = (m = {}) => `
    <div class="edit-row" data-kind="med">
      <input data-f="name" value="${esc(m.name)}" aria-label="Medication name" />
      <input data-f="dose" value="${esc(m.dose)}" aria-label="Dose" />
      <input data-f="time" value="${esc(m.time)}" aria-label="When" />
      <input data-f="instructions_en" value="${esc(m.instructions_en)}" aria-label="Instructions" />
      <button class="remove" aria-label="Remove this item" style="color:var(--urgent);background:var(--urgent-soft);border-color:var(--urgent);font-weight:700;justify-content:center">🗑 Remove</button>
    </div>`;
  // Each appointment: what, when, in person or virtual, then location OR video link
  const apptRow = (a = {}) => {
    const virtual = a.mode === 'virtual';
    return `
    <div class="edit-row appt-edit" data-kind="appt" style="display:block;border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px">
      <div class="grid cols-2" style="gap:8px">
        <div><label class="small">Appointment</label><input data-f="what_en" value="${esc(a.what_en)}" placeholder="e.g. Staple removal" /></div>
        <div><label class="small">Date and time</label><input data-f="when" value="${esc(a.when)}" placeholder="e.g. Nov 14, 10:00am" /></div>
        <div><label class="small">Type</label>
          <select data-f="mode" class="appt-mode">
            <option value="in_person" ${!virtual ? 'selected' : ''}>🏥 In person</option>
            <option value="virtual" ${virtual ? 'selected' : ''}>💻 Virtual (video call)</option>
          </select>
        </div>
        <div class="appt-location ${virtual ? 'hidden' : ''}"><label class="small">Location</label><input data-f="location" value="${esc(a.location)}" placeholder="Hospital, clinic, room number" /></div>
        <div class="appt-link ${virtual ? '' : 'hidden'}"><label class="small">Video call link</label><input data-f="link" value="${esc(a.link)}" placeholder="https://zoom.us/j/..." /></div>
      </div>
      <button class="remove small" style="margin-top:8px;color:var(--urgent);background:var(--urgent-soft);border-color:var(--urgent);font-weight:700">🗑 Remove appointment</button>
    </div>`;
  };
  const checkRow = (c = {}) => `
    <div class="edit-row check" data-kind="check" data-id="${esc(c.id || '')}">
      <select data-f="type" aria-label="Type"><option value="med" ${c.type === 'med' ? 'selected' : ''}>💊 Med</option><option value="task" ${c.type !== 'med' ? 'selected' : ''}>🚶 Task</option></select>
      <input data-f="task_en" value="${esc(c.task_en)}" aria-label="Checklist item" />
      <button class="remove" aria-label="Remove this item" style="color:var(--urgent);background:var(--urgent-soft);border-color:var(--urgent);font-weight:700;justify-content:center">🗑 Remove</button>
    </div>`;

  const meds = document.getElementById('rv-meds');
  const appts = document.getElementById('rv-appts');
  const checks = document.getElementById('rv-checks');
  meds.innerHTML = plan.medications.map(medRow).join('');
  appts.innerHTML = plan.appointments.map(apptRow).join('');
  checks.innerHTML = plan.checklist.map(checkRow).join('');
  document.getElementById('add-med').onclick = () => meds.insertAdjacentHTML('beforeend', medRow());
  document.getElementById('add-appt').onclick = () => appts.insertAdjacentHTML('beforeend', apptRow());
  document.getElementById('add-check').onclick = () => checks.insertAdjacentHTML('beforeend', checkRow());
  panel.onclick = (e) => { if (e.target.classList.contains('remove')) e.target.closest('.edit-row').remove(); };
  // Switching In person / Virtual shows the matching field
  appts.onchange = (e) => {
    if (!e.target.classList.contains('appt-mode')) return;
    const row = e.target.closest('.appt-edit');
    const virtual = e.target.value === 'virtual';
    row.querySelector('.appt-location').classList.toggle('hidden', virtual);
    row.querySelector('.appt-link').classList.toggle('hidden', !virtual);
  };

  const read = (container) => [...container.querySelectorAll('.edit-row')].map((row) => {
    const o = {};
    row.querySelectorAll('[data-f]').forEach((el) => (o[el.dataset.f] = el.value.trim()));
    if (row.dataset.id) o.id = row.dataset.id;
    return o;
  });

  document.getElementById('approve-btn').onclick = async (e) => {
    const edited = {
      explanation_en: document.getElementById('rv-expl').value.trim(),
      medications: read(meds).filter((m) => m.name),
      appointments: read(appts).filter((a) => a.what_en),
      checklist: read(checks).filter((c) => c.task_en),
      warning_signs: plan.warning_signs || [],
      monitorDays: Number(document.getElementById('rv-monitor').value)
    };
    if (!edited.explanation_en) return toast('Add an explanation first');
    // Only keep the field that matches the type, and make sure it's filled in
    for (const a of edited.appointments) {
      if (a.mode === 'virtual') {
        a.location = '';
        // "zoom.us/j/123" -> "https://zoom.us/j/123"
        if (a.link && !/^https?:\/\//i.test(a.link)) a.link = 'https://' + a.link;
        if (!/^https?:\/\//i.test(a.link)) return toast(`Add a video call link (starting with https://) for "${a.what_en}"`);
      } else {
        a.link = '';
        if (!a.location) return toast(`Add a location for "${a.what_en}"`);
      }
    }
    e.target.disabled = true;
    e.target.textContent = 'Translating and sending…';
    try {
      await api(`/api/patients/${p.id}/approve`, { method: 'POST', body: { plan: edited, nurseName: nurseName() } });
      toast('Approved and sent to patient');
      await openPatient(p.id);
    } catch (err) { toast(err.message); e.target.disabled = false; }
  };
}

// ---------- patient detail: reports, plan, family ----------
function renderDetail() {
  const p = current;
  const plan = p.plan;
  const patientLink = `${location.origin}/patient.html?id=${p.id}`;
  panel.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">${esc(p.name)}</h2>${sevBadge(p.top)}
      </div>
      <p class="muted small">${esc(p.procedure)} · ${esc(LANGS[p.language] || p.language)} · plan approved by ${esc(plan.approvedBy)} ${timeAgo(plan.approvedAt)}</p>
      <p><strong>${sinceDischarge(p.dischargedAt)}</strong></p>
      ${p.monitoring && p.monitoring.status !== 'not_started' ? `
      <div class="row" style="justify-content:space-between;padding:10px 12px;border-radius:12px;background:var(--bg);margin-bottom:10px">
        <span>${monitoringLabel(p.monitoring, true)}</span>
        <span class="row">
          ${p.monitoring.status === 'active'
            ? `<button data-monitor="extend">Extend 7 days</button><button data-monitor="end">End monitoring</button>`
            : `<button class="primary" data-monitor="extend">Reopen for 7 days</button>`}
        </span>
      </div>` : ''}
      ${p.alerts.length ? `<ul>${p.alerts.map((a) => `<li>${sevBadge(a.level)} ${esc(a.text)}</li>`).join('')}</ul>` : ''}
      <div class="row small"><span class="muted">Patient link:</span> <a href="${patientLink}" target="_blank">${esc(patientLink)}</a></div>
      ${p.claimCode ? `<div class="row small"><span class="muted">Discharge code (give to the patient so they can create their account):</span> <strong style="letter-spacing:.15em">${esc(p.claimCode)}</strong></div>` : ''}
    </div>

    <div class="card">
      <h3>Trouble reports</h3>
      <div id="reports">${p.reports.length ? '' : '<p class="muted">No reports yet.</p>'}</div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h3 style="margin:0">Checklist progress</h3>
        <span class="muted small">Click an item for details</span>
      </div>
      ${renderStaffChecklist(plan, p.dischargedAt)}
    </div>

    <div class="card">
      <h3>Medications</h3>
      ${plan.medications.map((m) => `
        <div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <strong>${esc(m.name)}</strong> ${esc(m.dose)}
          <div class="muted small">${esc(m.time)}${m.instructions_en ? ` · ${esc(m.instructions_en)}` : ''}</div>
        </div>`).join('') || '<p class="muted">None</p>'}
      <h3 style="margin-top:14px">Appointments</h3>
      ${plan.appointments.map((a) => appointmentHtml(a, a.what_en)).join('') || '<p class="muted">None</p>'}
      <button id="redraft" style="margin-top:12px">Edit care plan</button>
    </div>

    <div class="card">
      <h3>Timeline</h3>
      ${buildTimeline(p)}
    </div>

    <div class="card">
      <h3>Family Circle</h3>
      ${p.family.length ? p.family.map((f) => `<div>${esc(f.name)} <span class="muted small">(${esc(f.relationship)}) – sees: ${Object.entries(f.permissions).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nothing'}</span></div>`).join('') : '<p class="muted">No family members invited.</p>'}
    </div>`;

  document.getElementById('reports').insertAdjacentHTML('beforeend', p.reports.map(reportCard).join(''));
  document.getElementById('redraft').onclick = () => { current.plan.status = 'draft'; mode = 'review'; render(); };
  panel.querySelectorAll('[data-monitor]').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.monitor === 'end' && !confirm('End monitoring? Automatic alerts will stop. The patient can still send reports.')) return;
      try {
        await api(`/api/patients/${p.id}/monitoring`, { method: 'POST', body: { action: btn.dataset.monitor, days: 7 } });
        toast(btn.dataset.monitor === 'end' ? 'Monitoring ended' : 'Monitoring extended by 7 days');
        await openPatient(p.id);
      } catch (err) { toast(err.message); }
    };
  });

  panel.querySelectorAll('[data-respond]').forEach((btn) => {
    btn.onclick = () => {
      const noteBox = panel.querySelector(`[data-note="${btn.dataset.rid}"]`);
      respond(btn.dataset.rid, { response: btn.dataset.respond, note: noteBox ? noteBox.value : '' });
    };
  });
  panel.querySelectorAll('select[data-override]').forEach((sel) => {
    sel.onchange = () => respond(sel.dataset.rid, { severity: sel.value });
  });
  panel.querySelectorAll('[data-photo]').forEach((btn) => {
    btn.onclick = async () => {
      const { photo } = await api(`/api/patients/${p.id}/reports/${btn.dataset.photo}/photo`);
      btn.outerHTML = photo ? `<img class="thumb" src="${photo}" alt="Photo sent by patient" />` : '<span class="muted">No photo</span>';
    };
  });
}

function reportCard(r) {
  return `
    <div class="card border-${esc(r.severity)}" style="box-shadow:none">
      <div class="row" style="justify-content:space-between">
        <div class="row">${sevBadge(r.severity)} ${r.emergency ? '<span class="sev urgent">911 shown</span>' : ''}
          ${r.afterMonitoring ? '<span class="pill">↩ Returned after monitoring ended</span>' : ''}
          <span class="muted small">from ${esc(r.fromName)} (${esc(r.from)}) · ${timeAgo(r.createdAt)}</span></div>
        <label class="small row" style="font-weight:400">Severity
          <select data-override data-rid="${esc(r.id)}" style="width:auto">
            ${['urgent', 'soon', 'routine'].map((s) => `<option ${s === r.severity ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
      </div>
      <p><strong>${esc(r.summary)}</strong></p>
      <p class="small muted">Why: ${esc(r.reason)}${r.aiSeverity !== r.severity ? ` · AI suggested ${esc(r.aiSeverity)}, changed by nurse` : ''}</p>
      ${r.translation ? `<p class="small"><strong>Translation:</strong> ${esc(r.translation)}</p>` : ''}
      ${r.transcript ? `<p class="small muted"><strong>Original:</strong> ${esc(r.transcript)}</p>` : ''}
      ${r.text ? `<p class="small"><strong>Typed:</strong> ${esc(r.text)}</p>` : ''}
      ${r.photoDescription ? `<p class="small"><strong>Photo:</strong> ${esc(r.photoDescription)}</p>` : ''}
      ${r.photo ? `<img class="thumb" src="${r.photo}" alt="Photo sent by ${esc(r.fromName)}" />` : ''}
      ${r.staffResponse
        ? `<div class="notice small">✓ ${esc(r.staffResponse)} – ${esc(r.respondedBy || '')} ${timeAgo(r.respondedAt)}
             ${r.staffNote ? `<div style="margin-top:6px"><strong>Note:</strong> ${esc(r.staffNote)}</div>` : ''}
           </div>`
        : `<label class="small" for="note-${esc(r.id)}">Note for the patient (optional)</label>
           <textarea id="note-${esc(r.id)}" class="staff-note" data-note="${esc(r.id)}" placeholder="e.g. Keep your leg raised. I'll call you within the hour."></textarea>
           <div class="row" style="margin-top:8px">
             <button data-respond="Reviewed – no action needed" data-rid="${esc(r.id)}">Reviewed</button>
             <button class="primary" data-respond="A nurse will call you shortly" data-rid="${esc(r.id)}">Calling patient</button>
             <button class="danger" data-respond="Please go to the emergency room now" data-rid="${esc(r.id)}">Advise ER visit</button>
           </div>`}
    </div>`;
}

// "Day 4 since discharge (Tue, Nov 3)"
function sinceDischarge(iso) {
  if (!iso) return 'Discharge date unknown';
  const start = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  const date = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return days === 0 ? `Discharged today (${date})` : `Day ${days} since discharge (${date})`;
}

// ---------- checklist progress (staff detail) ----------
const dayKey = (daysBack) => {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
};

function renderStaffChecklist(plan, dischargedAt) {
  if (!plan.checklist.length) return '<p class="muted">No checklist items.</p>';
  const start = (plan.approvedAt || '').slice(0, 10);
  const today = dayKey(0);

  return plan.checklist.map((c) => {
    const log = c.log || [];
    const doneToday = log.includes(today);

    // Last 7 days, oldest on the left. Days before the plan started are greyed out.
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const key = dayKey(i);
      const label = new Date(key + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
      let state = 'none';
      if (key >= start) state = log.includes(key) ? 'done' : i === 0 ? 'pending' : 'missed';
      days.push({ key, label, state });
    }

    // Consecutive missed days before today
    let missedInRow = 0;
    for (let i = 1; i <= 7; i++) {
      const key = dayKey(i);
      if (key < start || log.includes(key)) break;
      missedInRow++;
    }
    const activeDays = days.filter((d) => d.state !== 'none' && d.state !== 'pending').length;
    const doneDays = days.filter((d) => d.state === 'done').length;

    let status;
    if (doneToday) status = { text: 'Done today', color: 'var(--routine)', bg: 'var(--routine-soft)' };
    else if (missedInRow >= 2) status = { text: `Missed ${missedInRow} days`, color: 'var(--urgent)', bg: 'var(--urgent-soft)' };
    else status = { text: 'Not done yet today', color: 'var(--muted)', bg: 'var(--bg)' };

    const style = {
      done: 'background:var(--routine);color:#fff',
      missed: 'background:var(--urgent-soft);color:var(--urgent)',
      pending: 'background:var(--bg);color:var(--muted);border:1px dashed var(--border)',
      none: 'background:transparent;color:var(--border)'
    };
    const symbol = { done: '✓', missed: '✗', pending: '…', none: '·' };
    const strip = days.map((d) => `
      <div style="text-align:center;width:52px">
        <div class="small muted">${d.label}</div>
        <div title="${d.key}: ${d.state}" style="height:30px;border-radius:8px;display:grid;place-items:center;font-weight:700;${style[d.state]}">${symbol[d.state]}</div>
      </div>`).join('');

    return `
      <details open style="border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-top:10px">
        <summary style="cursor:pointer;list-style:none">
          <div class="row" style="justify-content:space-between">
            <div class="row">
              <span style="font-size:1.3em" aria-hidden="true">${c.type === 'med' ? '💊' : '🚶'}</span>
              <strong>${esc(c.task_en)}</strong>
            </div>
            <span style="padding:3px 10px;border-radius:999px;font-size:.85em;font-weight:700;color:${status.color};background:${status.bg}">${status.text}</span>
          </div>
          <div class="row" style="gap:6px;margin-top:10px">${strip}</div>
        </summary>
        <div class="small" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
          <div><strong>Since discharge:</strong> ${sinceDischarge(dischargedAt)}</div>
          <div><strong>Type:</strong> ${c.type === 'med' ? 'Daily medicine' : 'Daily task'}</div>
          <div><strong>Last 7 days:</strong> done ${doneDays} of ${activeDays} day${activeDays === 1 ? '' : 's'}${missedInRow ? `, missed the last ${missedInRow} in a row` : ''}</div>
          <div><strong>Last done:</strong> ${log.length ? new Date([...log].sort().pop() + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : 'Never'}</div>
          ${c.task_translated && c.task_translated !== c.task_en ? `<div><strong>Patient sees:</strong> ${esc(c.task_translated)}</div>` : ''}
        </div>
      </details>`;
  }).join('');
}

// Everything that happened to this patient, newest first: discharge, approval, check-offs, reports, replies
function buildTimeline(p) {
  const events = [];
  events.push({ at: p.dischargedAt, icon: '🏥', text: `Discharged after ${p.procedure}` });
  if (p.plan?.approvedAt) events.push({ at: p.plan.approvedAt, icon: '✅', text: `Care plan approved by ${p.plan.approvedBy}` });

  // Check-offs are stored per day, so group them into one line per day
  const byDay = {};
  for (const c of p.plan?.checklist || []) {
    for (const day of c.log || []) (byDay[day] = byDay[day] || []).push(c.task_en);
  }
  for (const [day, tasks] of Object.entries(byDay)) {
    events.push({ at: day + 'T23:00:00', icon: '☑️', text: `Checked off: ${tasks.join(', ')}`, dayOnly: true });
  }

  for (const r of p.reports) {
    events.push({ at: r.createdAt, icon: '⚠️', text: `${r.fromName} reported a problem`, sev: r.severity });
    if (r.respondedAt) events.push({ at: r.respondedAt, icon: '💬', text: `${r.respondedBy}: ${r.staffResponse}${r.staffNote ? ` – "${r.staffNote}"` : ''}` });
  }

  events.sort((a, b) => b.at.localeCompare(a.at));
  return `<ul style="list-style:none;padding:0;margin:0">${events.map((e) => `
    <li style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span aria-hidden="true">${e.icon}</span>
      <span style="flex:1">${esc(e.text)} ${e.sev ? sevBadge(e.sev) : ''}</span>
      <span class="muted small" style="white-space:nowrap">${e.dayOnly ? new Date(e.at).toLocaleDateString() : timeAgo(e.at)}</span>
    </li>`).join('')}</ul>`;
}

// "Day 4 of 14 · monitoring until Nov 17" or "Monitoring ended Nov 6"
function monitoringLabel(m, long) {
  if (!m || m.status === 'not_started') return '';
  const date = new Date(m.endsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (m.status === 'ended') return `<div class="small"><strong>Monitoring ended ${date}</strong>${long ? ' · automatic alerts are off; the patient can still send reports' : ''}</div>`;
  const pct = Math.round((m.day / m.total) * 100);
  return `<div class="small">
      <strong>Day ${m.day} of ${m.total}</strong> · monitoring until ${date}
      <div style="height:6px;border-radius:99px;background:var(--border);margin-top:4px;${long ? 'width:220px' : ''}">
        <div style="height:6px;border-radius:99px;background:var(--brand);width:${pct}%"></div>
      </div>
    </div>`;
}

async function respond(rid, body) {
  try {
    await api(`/api/patients/${current.id}/reports/${rid}/respond`, { method: 'POST', body: { ...body, nurseName: nurseName() } });
    await openPatient(current.id);
  } catch (err) { toast(err.message); }
}

// ---------- boot ----------
document.getElementById('new-btn').onclick = () => { selectedId = null; mode = 'new'; render(); loadList(); };
loadList();
// Poll so new reports appear live during the demo (not while editing a draft)
setInterval(() => {
  loadList();
  // Don't redraw while the nurse is typing a note
  const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (mode === 'detail' && selectedId && !typing) api('/api/patients/' + selectedId).then((p) => {
    if (JSON.stringify(p.reports.map((r) => [r.id, r.severity, r.staffResponse])) !== JSON.stringify(current.reports.map((r) => [r.id, r.severity, r.staffResponse]))) {
      current = p;
      renderDetail();
    }
  });
}, 5000);