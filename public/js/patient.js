// Patient view. Person C owns this file.
const patientId = qs('id');
let data = null;
let showEnglish = false;

const $ = (id) => document.getElementById(id);
const t = (en, translated) => (showEnglish || !translated ? en : translated);

async function load() {
  if (!patientId) { document.body.innerHTML = '<main class="wrap"><p>Missing patient link. Go back to the <a href="/">home page</a>.</p></main>'; return; }
  data = await api('/api/patient-view/' + patientId);
  render();
}

function render() {
  const lang = showEnglish ? 'en-US' : data.language;
  $('hello').textContent = `Hello, ${data.name.split(' ')[0]}`;
  $('lang-toggle').textContent = showEnglish ? (LANGS[data.language] || data.language) : 'English';
  $('lang-toggle').classList.toggle('hidden', data.language === 'en-US');

  const approved = data.planStatus === 'approved';
  $('waiting').classList.toggle('hidden', approved);
  $('plan').classList.toggle('hidden', !approved);

  if (approved) {
    const plan = data.plan;
    $('explanation').textContent = t(plan.explanation_en, plan.explanation_translated);
    $('explanation').lang = lang;
    // Monitoring status: still being followed, or ended (patient can always still reach out)
    const m = data.monitoring;
    const endDate = m && m.endsAt ? new Date(m.endsAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : '';
    $('approved-by').innerHTML = `✓ Reviewed by ${esc(plan.approvedBy)}` + (
      m?.status === 'ended'
        ? `<div class="notice" style="margin-top:10px">Your care team's daily check-ins ended on ${endDate}. You can still contact us anytime with the button below.</div>`
        : m?.status === 'active' ? ` · Your care team is following your recovery until ${endDate}` : '');
    $('read-expl').onclick = () => speak($('explanation').textContent, lang);

    $('checklist').innerHTML = plan.checklist.map((c) => {
      const done = (c.log || []).includes(data.today);
      return `<button class="check-item ${done ? 'done' : ''}" data-id="${esc(c.id)}" aria-pressed="${done}">
        <span class="box">${done ? '✓' : ''}</span>
        <span class="label" lang="${lang}">${esc(t(c.task_en, c.task_translated))}</span>
      </button>`;
    }).join('');
    document.querySelectorAll('.check-item').forEach((b) => (b.onclick = () => toggle(b.dataset.id)));

    $('meds').innerHTML = plan.medications.map((m) => `
      <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
        <div><strong>${esc(m.name)}</strong> ${esc(m.dose)}<br><span class="muted">${esc(m.time)}</span><br><span lang="${lang}">${esc(t(m.instructions_en, m.instructions_translated))}</span></div>
        <button aria-label="Read aloud" data-say="${esc(`${m.name}. ${m.time}. ${t(m.instructions_en, m.instructions_translated)}`)}">🔊</button>
      </div>`).join('');
    $('appts').innerHTML = plan.appointments.map((a) => appointmentHtml(a, t(a.what_en, a.what_translated), lang)).join('') || '<p class="muted">None</p>';
    document.querySelectorAll('[data-say]').forEach((b) => (b.onclick = () => speak(b.dataset.say, lang)));
  }

  $('my-reports').innerHTML = renderReportsList(data.reports);
  renderFamily();
}

async function toggle(itemId) {
  await api(`/api/patients/${patientId}/checklist/${itemId}`, { method: 'POST' });
  await load();
}

function renderFamily() {
  $('family-list').innerHTML = data.family.map((f) => `
    <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <div><strong>${esc(f.name)}</strong> <span class="muted small">${esc(f.relationship)} · code ${esc(f.code)}</span></div>
      <button data-remove="${esc(f.code)}">Remove</button>
    </div>`).join('') || '<p class="muted">No one yet.</p>';
  document.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Remove their access?')) return;
    await api(`/api/patients/${patientId}/family/${b.dataset.remove}`, { method: 'DELETE' });
    await load();
  }));
}

$('invite-btn').onclick = async () => {
  const name = $('fam-name').value.trim();
  if (!name) return toast('Enter their name');
  const permissions = {};
  ['checklist', 'reports', 'alerts', 'canReport'].forEach((k) => (permissions[k] = $('perm-' + k).checked));
  const { member } = await api(`/api/patients/${patientId}/family`, { method: 'POST', body: { name, relationship: $('fam-rel').value.trim(), permissions } });
  $('invite-result').innerHTML = `<div class="notice">Share this code with ${esc(member.name)}: <strong style="font-size:1.4em;letter-spacing:.1em">${esc(member.code)}</strong><br><span class="small">Or send the link: ${esc(location.origin)}/family.html?code=${esc(member.code)}</span></div>`;
  $('fam-name').value = '';
  $('fam-rel').value = '';
  await load();
};

$('lang-toggle').onclick = () => { showEnglish = !showEnglish; render(); };

initA11yToggles();
load().then(() => {
  setupTroubleForm({ patientId, lang: data.language, from: 'patient', fromName: data.name, onSent: load });
});
// Pick up nurse approval and replies live
setInterval(() => {
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  api('/api/patient-view/' + patientId).then((d) => {
    if (JSON.stringify(d) !== JSON.stringify(data)) { data = d; render(); }
  }).catch(() => {});
}, 5000);