// Shared helpers for every page.
const APP_NAME = 'Platypal';

const LANGS = {
  'en-US': 'English',
  'zh-CN': '中文 (普通话) Mandarin',
  'zh-HK': '中文 (廣東話) Cantonese',
  'hi-IN': 'हिन्दी Hindi',
  'pa-IN': 'ਪੰਜਾਬੀ Punjabi',
  'es-ES': 'Español Spanish',
  'fr-FR': 'Français French',
  'ta-IN': 'தமிழ் Tamil',
  'ar-SA': 'العربية Arabic',
  'tl-PH': 'Tagalog'
};

// Did the translation made when the nurse approved the plan actually work?
function approvedTranslationOk(plan) {
  return !!plan.explanation_translated && !plan.translationFailed && !plan.explanation_translated.includes('translation appears here');
}

// The plan's text in one language, or null if it still has to be translated on demand.
// ownLang = the patient's language (translated when the nurse approved).
function planView(plan, lang, ownLang) {
  const pick = (list, key, tr) => list.map((x, i) => (tr && tr[i]) || x[key]);
  if (lang === 'en-US') {
    return { explanation: plan.explanation_en, meds: pick(plan.medications, 'instructions_en'), appts: pick(plan.appointments, 'what_en'), tasks: pick(plan.checklist, 'task_en') };
  }
  if (lang === ownLang && approvedTranslationOk(plan)) {
    return {
      explanation: plan.explanation_translated,
      meds: plan.medications.map((m) => m.instructions_translated || m.instructions_en),
      appts: plan.appointments.map((a) => a.what_translated || a.what_en),
      tasks: plan.checklist.map((c) => c.task_translated || c.task_en)
    };
  }
  const tl = plan.translations && plan.translations[lang]; // translated on demand and cached on the server
  if (!tl) return null;
  return {
    explanation: tl.explanation || plan.explanation_en,
    meds: pick(plan.medications, 'instructions_en', tl.medications),
    appts: pick(plan.appointments, 'what_en', tl.appointments),
    tasks: pick(plan.checklist, 'task_en', tl.checklist)
  };
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function sevBadge(level) {
  const label = { urgent: 'Urgent', soon: 'Soon', routine: 'Routine', ok: 'OK' }[level] || level;
  return `<span class="sev ${esc(level)}">${label}</span>`;
}

// Read-aloud with the browser's built-in voices (free, no API key)
function speak(text, lang) {
  if (!('speechSynthesis' in window)) return toast('Read-aloud is not supported in this browser');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang || 'en-US';
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

// Speech-to-text with the browser's Web Speech API (works best in Chrome / Edge)
function createRecognizer(lang, onText, onState) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang || 'en-US';
  rec.interimResults = true;
  rec.continuous = true;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t + ' ';
      else interim += t;
    }
    onText((finalText + interim).trim());
  };
  rec.onstart = () => onState(true);
  rec.onend = () => onState(false);
  rec.onerror = (e) => { toast('Microphone: ' + e.error); onState(false); };
  return {
    start() { finalText = ''; rec.start(); },
    stop() { rec.stop(); }
  };
}

// File input -> data URL (images are shrunk so uploads stay fast)
function fileToDataUrl(file, maxSize = 1600) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(reader.result);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// Client-side emergency check so the 911 banner shows instantly, before any network call
const EMERGENCY_WORDS = ['chest pain', "can't breathe", 'cannot breathe', 'not breathing', 'unconscious', 'passed out', 'heavy bleeding', 'stroke',
  '胸痛', '胸口痛', '呼吸困难', '喘不过气', '唞唔到氣', '昏迷', 'सीने में दर्द', 'सांस नहीं', 'dolor de pecho', 'no puedo respirar',
  'douleur à la poitrine', 'douleur thoracique', 'je ne peux pas respirer', 'ne respire pas', 'inconscient',
  'நெஞ்சு வலி', 'மூச்சு விட முடியவில்லை', 'மூச்சுத் திணறல்'];
function looksLikeEmergency(s = '') {
  const t = s.toLowerCase();
  return EMERGENCY_WORDS.some((w) => t.includes(w));
}

// Accessibility toggles (large text / high contrast), remembered per browser
function initA11yToggles() {
  const apply = (cls, on) => document.body.classList.toggle(cls, on);
  for (const cls of ['large', 'contrast']) {
    try {
      const saved = localStorage.getItem('a11y-' + cls);
      if (saved !== null) apply(cls, saved === '1');
    } catch {}
    const btn = document.getElementById('toggle-' + cls);
    if (btn) btn.onclick = () => {
      const on = !document.body.classList.contains(cls);
      apply(cls, on);
      try { localStorage.setItem('a11y-' + cls, on ? '1' : '0'); } catch {}
    };
  }
}

// One appointment, shown the same way on staff, patient and family pages.
// title = the appointment name in whichever language the viewer reads.
function appointmentHtml(a, title, lang) {
  const virtual = a.mode === 'virtual';
  const safeLink = /^https?:\/\//i.test(a.link || '') ? a.link : '';
  const where = virtual
    ? (safeLink
        ? `<a class="btn primary" href="${esc(safeLink)}" target="_blank" rel="noopener">💻 Join video call</a>`
        : '<span class="muted">Video link coming soon</span>')
    : (a.location
        ? `<div>📍 ${esc(a.location)}</div>
           <a class="small" href="https://www.google.com/maps/search/${encodeURIComponent(a.location)}" target="_blank" rel="noopener">Open in Maps</a>`
        : '<span class="muted">Location coming soon</span>');
  return `
    <div style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div class="row" style="justify-content:space-between">
        <strong ${lang ? `lang="${esc(lang)}"` : ''}>${esc(title)}</strong>
        <span class="pill">${virtual ? '💻 Virtual' : '🏥 In person'}</span>
      </div>
      <div class="muted">🗓 ${esc(a.when)}</div>
      <div style="margin-top:6px">${where}</div>
    </div>`;
}

// Alert wording for family (and patient) screens. Fixed sentences, so no AI wait. {task} and {days} are filled in.
const ALERT_TEXT = {
  'en-US': { title: 'Alerts', none: 'No alerts. Everything looks on track.', urgent: 'Urgent', soon: 'Soon', routine: 'Routine', ok: 'OK',
    emergency: 'Emergency words in a report', report_urgent: 'Urgent trouble report', report_soon: 'Trouble report needs a call today',
    report_routine: 'New routine report', returned: 'Returned after monitoring ended', missed_med: 'Missed "{task}" {days} days in a row',
    plan_waiting: 'Care plan waiting for approval', no_plan: 'No care plan yet', inactive: 'No activity for {days} days' },
  'zh-CN': { title: '提醒', none: '没有提醒，一切正常。', urgent: '紧急', soon: '尽快', routine: '一般', ok: '正常',
    emergency: '报告中出现紧急情况用语', report_urgent: '紧急问题报告', report_soon: '问题报告：今天需要打电话跟进',
    report_routine: '新的一般报告', returned: '监测结束后再次联系', missed_med: '连续 {days} 天未完成“{task}”',
    plan_waiting: '护理计划等待批准', no_plan: '尚无护理计划', inactive: '已 {days} 天没有任何活动' },
  'zh-HK': { title: '提示', none: '冇提示，一切正常。', urgent: '緊急', soon: '盡快', routine: '一般', ok: '正常',
    emergency: '報告入面有緊急字眼', report_urgent: '緊急問題報告', report_soon: '問題報告：今日要打電話跟進',
    report_routine: '新嘅一般報告', returned: '監察結束之後再次聯絡', missed_med: '連續 {days} 日冇完成「{task}」',
    plan_waiting: '護理計劃等緊批核', no_plan: '未有護理計劃', inactive: '已經 {days} 日冇任何活動' },
  'hi-IN': { title: 'अलर्ट', none: 'कोई अलर्ट नहीं। सब ठीक चल रहा है।', urgent: 'तत्काल', soon: 'जल्द', routine: 'सामान्य', ok: 'ठीक',
    emergency: 'रिपोर्ट में आपातकालीन शब्द', report_urgent: 'तत्काल समस्या रिपोर्ट', report_soon: 'समस्या रिपोर्ट: आज कॉल करना ज़रूरी है',
    report_routine: 'नई सामान्य रिपोर्ट', returned: 'निगरानी समाप्त होने के बाद फिर से संपर्क', missed_med: 'लगातार {days} दिन "{task}" छूट गया',
    plan_waiting: 'देखभाल योजना स्वीकृति की प्रतीक्षा में', no_plan: 'अभी कोई देखभाल योजना नहीं', inactive: '{days} दिनों से कोई गतिविधि नहीं' },
  'pa-IN': { title: 'ਅਲਰਟ', none: 'ਕੋਈ ਅਲਰਟ ਨਹੀਂ। ਸਭ ਠੀਕ ਚੱਲ ਰਿਹਾ ਹੈ।', urgent: 'ਜ਼ਰੂਰੀ', soon: 'ਜਲਦੀ', routine: 'ਆਮ', ok: 'ਠੀਕ',
    emergency: 'ਰਿਪੋਰਟ ਵਿੱਚ ਐਮਰਜੈਂਸੀ ਸ਼ਬਦ', report_urgent: 'ਜ਼ਰੂਰੀ ਸਮੱਸਿਆ ਰਿਪੋਰਟ', report_soon: 'ਸਮੱਸਿਆ ਰਿਪੋਰਟ: ਅੱਜ ਫ਼ੋਨ ਕਰਨਾ ਜ਼ਰੂਰੀ',
    report_routine: 'ਨਵੀਂ ਆਮ ਰਿਪੋਰਟ', returned: 'ਨਿਗਰਾਨੀ ਖਤਮ ਹੋਣ ਤੋਂ ਬਾਅਦ ਦੁਬਾਰਾ ਸੰਪਰਕ', missed_med: 'ਲਗਾਤਾਰ {days} ਦਿਨ "{task}" ਨਹੀਂ ਕੀਤਾ',
    plan_waiting: 'ਦੇਖਭਾਲ ਯੋਜਨਾ ਮਨਜ਼ੂਰੀ ਦੀ ਉਡੀਕ ਵਿੱਚ', no_plan: 'ਅਜੇ ਕੋਈ ਦੇਖਭਾਲ ਯੋਜਨਾ ਨਹੀਂ', inactive: '{days} ਦਿਨਾਂ ਤੋਂ ਕੋਈ ਗਤੀਵਿਧੀ ਨਹੀਂ' },
  'es-ES': { title: 'Alertas', none: 'Sin alertas. Todo va bien.', urgent: 'Urgente', soon: 'Pronto', routine: 'Rutina', ok: 'Bien',
    emergency: 'Palabras de emergencia en un reporte', report_urgent: 'Reporte de problema urgente', report_soon: 'Reporte de problema: hay que llamar hoy',
    report_routine: 'Nuevo reporte de rutina', returned: 'Volvió a escribir después de terminar el seguimiento', missed_med: 'No hizo "{task}" {days} días seguidos',
    plan_waiting: 'Plan de cuidado pendiente de aprobación', no_plan: 'Todavía no hay plan de cuidado', inactive: 'Sin actividad desde hace {days} días' },
  'fr-FR': { title: 'Alertes', none: 'Aucune alerte. Tout se passe bien.', urgent: 'Urgent', soon: 'Bientôt', routine: 'Routine', ok: 'OK',
    emergency: 'Mots d’urgence dans un signalement', report_urgent: 'Signalement urgent', report_soon: 'Signalement : appel nécessaire aujourd’hui',
    report_routine: 'Nouveau signalement de routine', returned: 'A recontacté après la fin du suivi', missed_med: '« {task} » oublié {days} jours de suite',
    plan_waiting: 'Plan de soins en attente d’approbation', no_plan: 'Pas encore de plan de soins', inactive: 'Aucune activité depuis {days} jours' },
  'ta-IN': { title: 'எச்சரிக்கைகள்', none: 'எச்சரிக்கைகள் இல்லை. எல்லாம் சரியாக உள்ளது.', urgent: 'அவசரம்', soon: 'விரைவில்', routine: 'வழக்கம்', ok: 'சரி',
    emergency: 'அறிக்கையில் அவசர வார்த்தைகள்', report_urgent: 'அவசர பிரச்சனை அறிக்கை', report_soon: 'பிரச்சனை அறிக்கை: இன்று அழைக்க வேண்டும்',
    report_routine: 'புதிய வழக்கமான அறிக்கை', returned: 'கண்காணிப்பு முடிந்த பிறகு மீண்டும் தொடர்பு', missed_med: 'தொடர்ந்து {days} நாட்கள் "{task}" தவறியது',
    plan_waiting: 'பராமரிப்புத் திட்டம் ஒப்புதலுக்காக காத்திருக்கிறது', no_plan: 'இன்னும் பராமரிப்புத் திட்டம் இல்லை', inactive: '{days} நாட்களாக எந்தச் செயல்பாடும் இல்லை' },
  'ar-SA': { title: 'تنبيهات', none: 'لا توجد تنبيهات. كل شيء على ما يرام.', urgent: 'عاجل', soon: 'قريباً', routine: 'روتيني', ok: 'جيد',
    emergency: 'كلمات طارئة في بلاغ', report_urgent: 'بلاغ عن مشكلة عاجلة', report_soon: 'بلاغ عن مشكلة: يجب الاتصال اليوم',
    report_routine: 'بلاغ روتيني جديد', returned: 'تواصل مجدداً بعد انتهاء المتابعة', missed_med: 'فاتته "{task}" لمدة {days} أيام متتالية',
    plan_waiting: 'خطة الرعاية بانتظار الموافقة', no_plan: 'لا توجد خطة رعاية بعد', inactive: 'لا يوجد نشاط منذ {days} أيام' },
  'tl-PH': { title: 'Mga alerto', none: 'Walang alerto. Maayos ang lahat.', urgent: 'Agaran', soon: 'Malapit na', routine: 'Karaniwan', ok: 'OK',
    emergency: 'May salitang pang-emergency sa ulat', report_urgent: 'Agarang ulat ng problema', report_soon: 'Ulat ng problema: kailangang tumawag ngayong araw',
    report_routine: 'Bagong karaniwang ulat', returned: 'Bumalik matapos ang pagbabantay', missed_med: 'Hindi nagawa ang "{task}" nang {days} araw na sunod-sunod',
    plan_waiting: 'Naghihintay ng pag-apruba ang plano ng pangangalaga', no_plan: 'Wala pang plano ng pangangalaga', inactive: 'Walang aktibidad sa loob ng {days} araw' }
};
const alertWords = (lang) => ALERT_TEXT[lang] || ALERT_TEXT['en-US'];

// One alert in a language. taskName(english) returns that task's name in the same language (or English).
function alertText(a, lang, taskName = (t) => t) {
  const tpl = a.code && alertWords(lang)[a.code];
  if (!tpl) return a.text; // unknown alert: show the server's English
  const p = a.params || {};
  return tpl.replace('{task}', p.task ? taskName(p.task) : '').replace('{days}', p.days ?? '');
}

// Severity badge with its label in a language
function sevBadgeIn(level, lang) {
  return `<span class="sev ${esc(level)}">${esc(alertWords(lang)[level] || level)}</span>`;
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}
// Signed-in bar: shows a Sign out button in the top bar and pre-fills the nurse's name.
(async function initSession() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return;
    const { user } = await res.json();
    const nurse = document.getElementById('nurse-name');
    if (nurse && user.role === 'staff' && user.fullName) nurse.value = user.fullName;
    const btn = document.createElement('button');
    btn.textContent = 'Sign out';
    btn.title = 'Signed in as ' + user.username;
    btn.onclick = async () => {
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      location.href = '/';
    };
    bar.appendChild(btn);
  } catch {}
})();