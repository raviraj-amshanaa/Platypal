// Family view (consent-based). Person C owns this file.
const code = qs('code');
const $ = (id) => document.getElementById(id);
let data = null;
let currentLang = null; // language this family member reads in; starts as the patient's language
const translateState = {}; // language -> 'loading' | 'unavailable'
let formReady = false;

// Ask the server to translate the approved plan into a language the family picked (cached on the server)
async function fetchTranslation(lang) {
  if (translateState[lang]) return;
  translateState[lang] = 'loading';
  try {
    const r = await api(`/api/patients/${data.patient.id}/translate`, { method: 'POST', body: { language: lang } });
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
  // Language picker: every supported language. Built once so the open dropdown isn't reset.
  if (!currentLang) currentLang = patient.language || 'en-US';
  const sel = $('read-lang');
  if (!sel.options.length) {
    sel.innerHTML = Object.entries(LANGS).map(([c, label]) => `<option value="${esc(c)}">${esc(label)}</option>`).join('');
  }
  sel.value = currentLang;

  let lang = currentLang;
  let view = plan ? planView(plan, lang, patient.language) : null;
  let note = '';
  if (plan && !view) {
    // Not translated yet: show English while it loads (or if the AI can't translate right now)
    fetchTranslation(lang);
    note = translateState[lang] === 'unavailable' ? "We couldn't translate this right now, so it is shown in English. Pick the language again to retry." : 'Translating…';
    lang = 'en-US';
    view = planView(plan, lang, patient.language);
  }

  // Alerts in the chosen language. Task names inside an alert use the plan's translation when it's ready.
  $('alerts-card').classList.toggle('hidden', !alerts);
  if (alerts) {
    const aLang = currentLang;
    const words = alertWords(aLang);
    const taskView = plan ? planView(plan, aLang, patient.language) : null;
    const taskName = (en) => {
      const i = plan ? plan.checklist.findIndex((c) => c.task_en === en) : -1;
      return taskView && i >= 0 ? taskView.tasks[i] : en;
    };
    const heading = $('alerts-card').querySelector('h2');
    if (heading) heading.textContent = words.title;
    $('alerts').innerHTML = alerts.length
      ? alerts.map((a) => `<div dir="auto" lang="${esc(aLang)}" style="margin:4px 0">${sevBadgeIn(a.level, aLang)} ${esc(alertText(a, aLang, taskName))}</div>`).join('')
      : `<p class="muted" dir="auto">${esc(words.none)}</p>`;
  }

  $('plan-card').classList.toggle('hidden', !member.permissions.checklist);
  if (member.permissions.checklist) {
    $('plan').innerHTML = !plan
      ? '<p class="muted">The care team is still preparing the plan.</p>'
      : `${note ? `<p class="small muted" role="status">${esc(note)}</p>` : ''}
         <p lang="${lang}">${esc(view.explanation)}</p>
         <button id="read">🔊 Read aloud</button>
         <h3 style="margin-top:12px">Today</h3>
         ${plan.checklist.map((c, i) => `<div>${(c.log || []).includes(data.today) ? '✅' : '⬜'} <span lang="${lang}">${esc(view.tasks[i])}</span></div>`).join('')}
         <h3 style="margin-top:12px">Medicines</h3>
         <ul>${plan.medications.map((m) => `<li><strong>${esc(m.name)}</strong> ${esc(m.dose)}, ${esc(m.time)}</li>`).join('')}</ul>
         <h3>Appointments</h3>
        ${plan.appointments.map((a, i) => appointmentHtml(a, view.appts[i], lang)).join('') || '<p class="muted">None</p>'}`;
    const btn = $('read');
    if (btn) btn.onclick = () => speak(view.explanation, lang);
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

$('read-lang').onchange = (e) => {
  currentLang = e.target.value;
  if (translateState[currentLang] === 'unavailable') delete translateState[currentLang]; // try again
  render();
};
initA11yToggles();
load();
setInterval(() => {
  if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  api('/api/family/' + encodeURIComponent(code || '')).then((d) => {
    if (JSON.stringify(d) !== JSON.stringify(data)) { data = d; render(); }
  }).catch(() => load());
}, 5000);