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
  document.getElementById('patient-list').innerHTML = patients.map((p) => `
    <div class="patient-row border-${esc(p.top)} ${p.id === selectedId ? 'active' : ''}" data-id="${esc(p.id)}" tabindex="0" role="button">
      <div class="row" style="justify-content:space-between">
        <strong>${esc(p.name)}</strong>${sevBadge(p.top)}
      </div>
      <div class="muted small">${esc(p.procedure)} · ${esc(LANGS[p.language] || p.language)} · discharged ${timeAgo(p.dischargedAt)}</div>
      ${p.alerts.length ? `<ul class="alert-list">${p.alerts.map((a) => `<li>${esc(a.text)}</li>`).join('')}</ul>` : '<div class="small muted">No alerts</div>'}
    </div>`).join('');
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
      <span class="muted">Approving as <strong>${esc(nurseName())}</strong></span>
      <button class="primary big" id="approve-btn">Approve &amp; send to patient</button>
    </div>`;

  const medRow = (m = {}) => `
    <div class="edit-row" data-kind="med">
      <input data-f="name" value="${esc(m.name)}" aria-label="Medication name" />
      <input data-f="dose" value="${esc(m.dose)}" aria-label="Dose" />
      <input data-f="time" value="${esc(m.time)}" aria-label="When" />
      <input data-f="instructions_en" value="${esc(m.instructions_en)}" aria-label="Instructions" />
      <button class="remove" aria-label="Remove">✕</button>
    </div>`;
  const apptRow = (a = {}) => `
    <div class="edit-row two" data-kind="appt">
      <input data-f="what_en" value="${esc(a.what_en)}" aria-label="Appointment" />
      <input data-f="when" value="${esc(a.when)}" aria-label="When" />
      <button class="remove" aria-label="Remove">✕</button>
    </div>`;
  const checkRow = (c = {}) => `
    <div class="edit-row check" data-kind="check" data-id="${esc(c.id || '')}">
      <select data-f="type" aria-label="Type"><option value="med" ${c.type === 'med' ? 'selected' : ''}>Medicine</option><option value="task" ${c.type !== 'med' ? 'selected' : ''}>Task</option></select>
      <input data-f="task_en" value="${esc(c.task_en)}" aria-label="Checklist item" />
      <button class="remove" aria-label="Remove">✕</button>
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
      warning_signs: plan.warning_signs || []
    };
    if (!edited.explanation_en) return toast('Add an explanation first');
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
      ${p.alerts.length ? `<ul>${p.alerts.map((a) => `<li>${sevBadge(a.level)} ${esc(a.text)}</li>`).join('')}</ul>` : ''}
      <div class="row small"><span class="muted">Patient link:</span> <a href="${patientLink}" target="_blank">${esc(patientLink)}</a></div>
    </div>

    <div class="card">
      <h3>Trouble reports</h3>
      <div id="reports">${p.reports.length ? '' : '<p class="muted">No reports yet.</p>'}</div>
    </div>

    <div class="card">
      <h3>Today's checklist</h3>
      ${plan.checklist.map((c) => {
        const done = (c.log || []).includes(new Date().toISOString().slice(0, 10));
        return `<div>${done ? '✅' : '⬜'} ${esc(c.task_en)} <span class="muted small">(${(c.log || []).length} days done)</span></div>`;
      }).join('')}
      <h3 style="margin-top:14px">Medications</h3>
      <ul>${plan.medications.map((m) => `<li><strong>${esc(m.name)}</strong> ${esc(m.dose)} – ${esc(m.time)}</li>`).join('')}</ul>
      <button id="redraft">Edit care plan</button>
    </div>

    <div class="card">
      <h3>Family Circle</h3>
      ${p.family.length ? p.family.map((f) => `<div>${esc(f.name)} <span class="muted small">(${esc(f.relationship)}) – sees: ${Object.entries(f.permissions).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nothing'}</span></div>`).join('') : '<p class="muted">No family members invited.</p>'}
    </div>`;

  document.getElementById('reports').insertAdjacentHTML('beforeend', p.reports.map(reportCard).join(''));
  document.getElementById('redraft').onclick = () => { current.plan.status = 'draft'; mode = 'review'; render(); };

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
  if (mode === 'detail' && selectedId) api('/api/patients/' + selectedId).then((p) => {
    if (JSON.stringify(p.reports.map((r) => [r.id, r.severity, r.staffResponse])) !== JSON.stringify(current.reports.map((r) => [r.id, r.severity, r.staffResponse]))) {
      current = p;
      renderDetail();
    }
  });
}, 5000);
