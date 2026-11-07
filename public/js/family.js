// Family view (consent-based). Person C owns this file.
const code = qs('code');
const $ = (id) => document.getElementById(id);
let data = null;
let readEnglish = false;
let formReady = false;

async function load() {
  try {
    data = await api('/api/family/' + encodeURIComponent(code || ''));
  } catch (e) {
    $('content').classList.add('hidden');
    $('error').classList.remove('hidden');
    $('error').innerHTML = `<h2>Can't open</h2><p>${esc(e.message)}</p><a href="/">Back</a>`;
    return;
  }
  render();
}

function render() {
  const { member, patient, plan, reports, alerts } = data;
  $('content').classList.remove('hidden');
  $('title').textContent = `${patient.name}'s care`;
  $('subtitle').textContent = `You are ${member.name} (${member.relationship || 'family'}). ${patient.procedure}.`;
  $('read-lang').innerHTML = `<option value="native">${esc(LANGS[patient.language] || patient.language)}</option><option value="en" ${readEnglish ? 'selected' : ''}>English</option>`;
  const t = (en, tr) => (readEnglish || !tr ? en : tr);
  const lang = readEnglish ? 'en-US' : patient.language;

  $('alerts-card').classList.toggle('hidden', !alerts);
  if (alerts) $('alerts').innerHTML = alerts.length
    ? alerts.map((a) => `<div>${sevBadge(a.level)} ${esc(a.text)}</div>`).join('')
    : '<p class="muted">No alerts. Everything looks on track.</p>';

  $('plan-card').classList.toggle('hidden', !member.permissions.checklist);
  if (member.permissions.checklist) {
    $('plan').innerHTML = !plan
      ? '<p class="muted">The care team is still preparing the plan.</p>'
      : `<p lang="${lang}">${esc(t(plan.explanation_en, plan.explanation_translated))}</p>
         <button id="read">🔊 Read aloud</button>
         <h3 style="margin-top:12px">Today</h3>
         ${plan.checklist.map((c) => `<div>${(c.log || []).includes(data.today) ? '✅' : '⬜'} <span lang="${lang}">${esc(t(c.task_en, c.task_translated))}</span></div>`).join('')}
         <h3 style="margin-top:12px">Medicines</h3>
         <ul>${plan.medications.map((m) => `<li><strong>${esc(m.name)}</strong> ${esc(m.dose)}, ${esc(m.time)}</li>`).join('')}</ul>
         <h3>Appointments</h3>
        ${plan.appointments.map((a) => appointmentHtml(a, t(a.what_en, a.what_translated), lang)).join('') || '<p class="muted">None</p>'}`;
    const btn = $('read');
    if (btn) btn.onclick = () => speak(t(plan.explanation_en, plan.explanation_translated), lang);
  }

  $('reports-card').classList.toggle('hidden', !reports);
  if (reports) $('reports').innerHTML = renderReportsList(reports) || '<p class="muted">No messages yet.</p>';

  $('report-card').classList.toggle('hidden', !member.permissions.canReport);
  if (member.permissions.canReport && !formReady) {
    formReady = true;
    setupTroubleForm({
      patientId: patient.id, lang: patient.language, from: 'family',
      fromName: `${member.name} (${member.relationship || 'family'})`, familyCode: member.code, onSent: load
    });
  }
}

$('read-lang').onchange = (e) => { readEnglish = e.target.value === 'en'; render(); };
initA11yToggles();
load();
setInterval(() => {
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  api('/api/family/' + encodeURIComponent(code || '')).then((d) => {
    if (JSON.stringify(d) !== JSON.stringify(data)) { data = d; render(); }
  }).catch(() => load());
}, 5000);
