// Patient view. Person C owns this file.
const patientId = qs('id');
let data = null;
let currentLang = null; // language the patient is reading in; starts as their own language
const translateState = {}; // language -> 'loading' | 'unavailable'

const $ = (id) => document.getElementById(id);

// The text to show for one language, or null if it still has to be fetched.
function langView(plan, lang) {
  const pick = (list, en, tr) => list.map((x, i) => (tr && tr[i]) || x[en]);
  if (lang === 'en-US') {
    return { explanation: plan.explanation_en, meds: pick(plan.medications, 'instructions_en'), appts: pick(plan.appointments, 'what_en'), tasks: pick(plan.checklist, 'task_en') };
  }
  if (lang === data.language) { // translated by the server when the nurse approved the plan
    return {
      explanation: plan.explanation_translated || plan.explanation_en,
      meds: plan.medications.map((m) => m.instructions_translated || m.instructions_en),
      appts: plan.appointments.map((a) => a.what_translated || a.what_en),
      tasks: plan.checklist.map((c) => c.task_translated || c.task_en)
    };
  }
  const tl = plan.translations && plan.translations[lang]; // translated on demand and cached
  if (!tl) return null;
  return {
    explanation: tl.explanation || plan.explanation_en,
    meds: pick(plan.medications, 'instructions_en', tl.medications),
    appts: pick(plan.appointments, 'what_en', tl.appointments),
    tasks: pick(plan.checklist, 'task_en', tl.checklist)
  };
}

async function fetchTranslation(lang) {
  if (translateState[lang]) return; // already loading, or failed (cleared when the patient picks it again)
  translateState[lang] = 'loading';
  try {
    const r = await api(`/api/patients/${patientId}/translate`, { method: 'POST', body: { language: lang } });
    if (r.mock) translateState[lang] = 'unavailable';
    else {
      data.plan.translations = { ...(data.plan.translations || {}), [lang]: r.translation };
      delete translateState[lang];
    }
  } catch {
    translateState[lang] = 'unavailable';
  }
  if (currentLang === lang) render();
}

async function load() {
  if (!patientId) { document.body.innerHTML = '<main class="wrap"><p>Missing patient link. Go back to the <a href="/">home page</a>.</p></main>'; return; }
  data = await api('/api/patient-view/' + patientId);
  render();
}

function render() {
  if (!currentLang) currentLang = 'en-US';
  const sel = $('lang-select');
  if (!sel.options.length) {
    sel.innerHTML = Object.entries(LANGS).map(([code, label]) => `<option value="${esc(code)}">${esc(label)}</option>`).join('');
  }
  sel.value = currentLang;
  $('hello').textContent = `Hello, ${data.name.split(' ')[0]}`;

  const approved = data.planStatus === 'approved';
  $('waiting').classList.toggle('hidden', approved);
  $('plan').classList.toggle('hidden', !approved);

  if (approved) {
    const plan = data.plan;
    let lang = currentLang;
    let view = langView(plan, lang);
    let note = '';
    if (!view) {
      // Not translated yet: show English while it loads (or if it cannot be translated right now)
      fetchTranslation(lang);
      const failed = translateState[lang] === 'unavailable';
      note = failed ? "We couldn't translate this right now, so it is shown in English." : 'Translating…';
      lang = 'en-US';
      view = langView(plan, lang);
    } else if (lang !== data.language && lang !== 'en-US') {
      note = `Translated automatically from the plan ${plan.approvedBy} approved.`;
    }
    $('translate-note').textContent = note;
    $('translate-note').classList.toggle('hidden', !note);

    $('explanation').textContent = view.explanation;
    $('explanation').lang = lang;
    // Monitoring status: still being followed, or ended (patient can always still reach out)
    const m = data.monitoring;
    const endDate = m && m.endsAt ? new Date(m.endsAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : '';
    $('approved-by').innerHTML = `✓ Reviewed by ${esc(plan.approvedBy)}` + (
      m?.status === 'ended'
        ? `<div class="notice" style="margin-top:10px">Your care team's daily check-ins ended on ${endDate}. You can still contact us anytime with the button below.</div>`
        : m?.status === 'active' ? ` · Your care team is following your recovery until ${endDate}` : '');
    $('read-expl').onclick = () => speak($('explanation').textContent, lang);

    $('checklist').innerHTML = plan.checklist.map((c, i) => {
      const done = (c.log || []).includes(data.today);
      return `<button class="check-item ${done ? 'done' : ''}" data-id="${esc(c.id)}" aria-pressed="${done}">
        <span class="box">${done ? '✓' : ''}</span>
        <span class="label" lang="${lang}">${esc(view.tasks[i])}</span>
      </button>`;
    }).join('');
    document.querySelectorAll('.check-item').forEach((b) => (b.onclick = () => toggle(b.dataset.id)));

    $('meds').innerHTML = plan.medications.map((m, i) => `
      <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
        <div><strong>${esc(m.name)}</strong> ${esc(m.dose)}<br><span class="muted">${esc(m.time)}</span><br><span lang="${lang}">${esc(view.meds[i])}</span></div>
        <button aria-label="Read aloud" data-say="${esc(`${m.name}. ${m.time}. ${view.meds[i]}`)}">🔊</button>
      </div>`).join('');
    $('appts').innerHTML = plan.appointments.map((a, i) => appointmentHtml(a, view.appts[i], lang)).join('') || '<p class="muted">None</p>';
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

$('lang-select').onchange = (e) => {
  currentLang = e.target.value;
  if (translateState[currentLang] === 'unavailable') delete translateState[currentLang]; // try again
  render();
};

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