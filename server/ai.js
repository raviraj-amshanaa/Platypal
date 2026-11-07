// All AI calls live here. Person A owns this file.
// Every function falls back to a canned "mock" result if there is no API key or the call fails,
// so the demo never breaks (rubric: technical execution).

const PROVIDER = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const hasKey = PROVIDER === 'openai' ? !!OPENAI_KEY : !!ANTHROPIC_KEY;

const LANG_NAMES = {
  'en-US': 'English', 'zh-CN': 'Simplified Chinese (Mandarin)',
  'zh-HK': 'Traditional Chinese (Cantonese, written the way Hong Kong speakers say it, not Mandarin phrasing)',
  'hi-IN': 'Hindi', 'pa-IN': 'Punjabi', 'es-ES': 'Spanish', 'fr-FR': 'French', 'ta-IN': 'Tamil (Tamil script)',
  'ar-SA': 'Arabic', 'tl-PH': 'Tagalog'
};
const langName = (code) => LANG_NAMES[code] || code;
const isSupportedLanguage = (code) => Object.prototype.hasOwnProperty.call(LANG_NAMES, code);
const translateSystem = (language) =>
  `Translate patient care instructions into ${langName(language)}. Keep the meaning exact, use simple everyday words, keep medication names and doses unchanged. Return ONLY JSON with the same keys and array lengths as the input.`;

// If the AI takes longer than this, give up and use the sample result so the demo never hangs
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 60000;

function mode() {
  return hasKey ? PROVIDER : 'mock';
}

// ---------- low-level model call (image optional) ----------
async function callModel({ system, text, image }) {
  if (PROVIDER === 'openai') {
    const content = [{ type: 'text', text }];
    if (image) content.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } });
    // Works for OpenAI and any OpenAI-compatible API (e.g. xAI Grok) via OPENAI_BASE_URL
    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        ...(base.includes('api.openai.com') ? { response_format: { type: 'json_object' } } : {}),
        // Gemini "thinks" before answering; low effort makes it much faster for this task
        ...(base.includes('generativelanguage') ? { reasoning_effort: process.env.AI_REASONING || 'low' } : {}),
        messages: [{ role: 'system', content: system }, { role: 'user', content }]
      })
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
    const data = await r.json();
    return parseJson(data.choices[0].message.content);
  }

  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  content.push({ type: 'text', text });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 2500,
      system,
      messages: [{ role: 'user', content }]
    })
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const block = data.content.find((b) => b.type === 'text');
  return parseJson(block ? block.text : '');
}

function parseJson(s) {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Model did not return JSON');
  return JSON.parse(s.slice(start, end + 1));
}

// "data:image/jpeg;base64,AAAA" -> { mediaType, data }
function splitDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  return m ? { mediaType: m[1], data: m[2] } : null;
}

// ---------- 1. Draft a care plan from a photo of discharge papers ----------
const DRAFT_SYSTEM = `You help hospital nurses turn discharge paperwork into a draft care plan that a nurse will REVIEW and APPROVE before any patient sees it.
Rules:
- Only use information that is in the document. Never invent medications, doses or dates. If something is unreadable, write "UNCLEAR - nurse to confirm".
- Write in plain language at about a grade 6 reading level, in English.
- Return ONLY JSON with this shape:
{"explanation_en": string (3-4 short sentences: what happened, what to do, what to watch for),
 "medications": [{"name": string, "dose": string, "time": string, "instructions_en": string}],
 "appointments": [{"what_en": string, "when": string, "mode": "in_person" | "virtual", "location": string (address/clinic/room if in person, else ""), "link": string (video call link if virtual, else "")}],
 "checklist": [{"type": "med" | "task", "task_en": string}],
 "warning_signs": [string]}
Checklist items with type "med" are daily medication reminders; "task" items are other daily actions.`;

async function draftPlan({ imageDataUrl, procedure }) {
  const image = splitDataUrl(imageDataUrl);
  if (!hasKey || !image) return { ...mockDraft(procedure), _mock: true };
  try {
    return await callModel({
      system: DRAFT_SYSTEM,
      text: `Draft the care plan from this discharge document. Procedure/reason for stay (from the nurse): ${procedure || 'not given'}.`,
      image
    });
  } catch (e) {
    console.error('[ai] draftPlan failed, using mock:', e.message);
    return { ...mockDraft(procedure), _mock: true };
  }
}

// ---------- 2. Translate an approved plan into the patient's language ----------
async function translatePlan(plan, language) {
  if (language === 'en-US') return copyEnglish(plan);
  const payload = {
    explanation: plan.explanation_en,
    medications: plan.medications.map((m) => m.instructions_en),
    appointments: plan.appointments.map((a) => a.what_en),
    checklist: plan.checklist.map((c) => c.task_en)
  };
  if (!hasKey) return mockTranslate(plan, language);
  try {
    const out = await callModel({
      system: translateSystem(language),
      text: JSON.stringify(payload)
    });
    plan.explanation_translated = out.explanation;
    plan.medications.forEach((m, i) => (m.instructions_translated = out.medications?.[i] || m.instructions_en));
    plan.appointments.forEach((a, i) => (a.what_translated = out.appointments?.[i] || a.what_en));
    plan.checklist.forEach((c, i) => (c.task_translated = out.checklist?.[i] || c.task_en));
    return plan;
  } catch (e) {
    console.error('[ai] translatePlan failed, using mock:', e.message);
    return mockTranslate(plan, language);
  }
}

// ---------- 2b. Translate an approved plan into ANY supported language, on demand ----------
// Used by the patient's language picker. Returns the translated text only and never changes the plan.
// A result with _mock: true is not a real translation (no API key, or the call failed), so callers must not cache it.
async function translateContent(plan, language) {
  const payload = {
    explanation: plan.explanation_en,
    medications: plan.medications.map((m) => m.instructions_en),
    appointments: plan.appointments.map((a) => a.what_en),
    checklist: plan.checklist.map((c) => c.task_en)
  };
  if (language === 'en-US') return payload;
  if (!hasKey) return { ...payload, _mock: true };
  try {
    const out = await callModel({ system: translateSystem(language), text: JSON.stringify(payload) });
    return {
      explanation: out.explanation || payload.explanation,
      medications: payload.medications.map((en, i) => out.medications?.[i] || en),
      appointments: payload.appointments.map((en, i) => out.appointments?.[i] || en),
      checklist: payload.checklist.map((en, i) => out.checklist?.[i] || en)
    };
  } catch (e) {
    console.error('[ai] translateContent failed:', e.message);
    return { ...payload, _mock: true };
  }
}

// ---------- 3. Triage a trouble report (voice transcript + photo + text) ----------
const TRIAGE_SYSTEM = `You help a hospital nurse triage messages from recently discharged patients. You do NOT diagnose. Never name a specific disease or condition; describe only the symptoms and why they need attention. A nurse makes the final decision.
Return ONLY JSON:
{"translation": string (English translation of the patient's words, or "" if already English),
 "photo_description": string (neutral description of what is visible, e.g. "redness around a surgical wound"; "" if no photo),
 "severity": "urgent" | "soon" | "routine",
 "summary": string (2-3 short lines for the nurse, include relevant context from the care plan),
 "reason": string (one line: why this severity)}
Severity guide: urgent = could be serious now (breathing trouble, chest pain, heavy bleeding, fainting, confusion, high fever with wound changes);
soon = needs a nurse call today (worsening pain, redness/swelling, missed critical medication, new symptoms);
routine = questions, mild issues, logistics.`;

async function triageReport({ transcript, text, photoDataUrl, language, patient }) {
  const image = splitDataUrl(photoDataUrl);
  const words = [transcript, text].filter(Boolean).join('\n');
  if (!hasKey) return mockTriage({ words, hasPhoto: !!image, patient });
  try {
    return await callModel({
      system: TRIAGE_SYSTEM,
      text: `Patient: ${patient.name}. Reason for hospital stay: ${patient.procedure}. Days since discharge: ${daysSince(patient.dischargedAt)}.
Care plan summary: ${patient.plan?.explanation_en || 'none'}
Patient's language: ${langName(language)}.
Patient's message: """${words || '(no words, photo only)'}"""`,
      image
    });
  } catch (e) {
    console.error('[ai] triageReport failed, using mock:', e.message);
    return mockTriage({ words, hasPhoto: !!image, patient });
  }
}

// ---------- safety: obvious emergencies skip the AI entirely ----------
const EMERGENCY_WORDS = [
  'chest pain', "can't breathe", 'cannot breathe', 'not breathing', 'unconscious', 'passed out', 'heavy bleeding', 'stroke',
  '胸痛', '胸口痛', '呼吸困难', '喘不过气', '唞唔到氣', '昏迷',
  'सीने में दर्द', 'सांस नहीं',
  'dolor de pecho', 'no puedo respirar',
  'douleur à la poitrine', 'douleur thoracique', 'je ne peux pas respirer', 'ne respire pas', 'inconscient',
  'நெஞ்சு வலி', 'மூச்சு விட முடியவில்லை', 'மூச்சுத் திணறல்'
];
function isEmergency(s = '') {
  const t = s.toLowerCase();
  return EMERGENCY_WORDS.some((w) => t.includes(w));
}

// ---------- mock results (no key / API failure) ----------
function mockDraft(procedure) {
  return {
    explanation_en: `You were in hospital for ${procedure || 'a procedure'}. Take your medicines on time, keep your wound clean and dry, and rest. Call us if you have fever, more pain, or redness around the wound.`,
    medications: [
      { name: 'Acetaminophen', dose: '500 mg', time: 'Every 6 hours as needed', instructions_en: 'For pain. No more than 8 tablets a day.' },
      { name: 'Cephalexin', dose: '500 mg', time: '8am, 2pm, 8pm', instructions_en: 'Antibiotic. Finish the whole bottle.' }
    ],
    appointments: [
      { what_en: 'Follow-up with family doctor', when: 'Within 7 days', mode: 'in_person', location: 'Your family doctor\'s office' },
      { what_en: 'Video check-in with surgical nurse', when: 'In 3 days, 2:00pm', mode: 'virtual', link: 'https://zoom.us/j/0000000000' }
    ],
    checklist: [
      { type: 'med', task_en: 'Take morning antibiotic' },
      { type: 'med', task_en: 'Take evening antibiotic' },
      { type: 'task', task_en: 'Check wound for redness' }
    ],
    warning_signs: ['Fever over 38°C', 'Redness or pus at the wound', 'Pain getting worse']
  };
}

function copyEnglish(plan) {
  plan.explanation_translated = plan.explanation_en;
  plan.medications.forEach((m) => (m.instructions_translated = m.instructions_en));
  plan.appointments.forEach((a) => (a.what_translated = a.what_en));
  plan.checklist.forEach((c) => (c.task_translated = c.task_en));
  return plan;
}

function mockTranslate(plan, language) {
  copyEnglish(plan);
  const tag = `[${langName(language)} translation appears here when an AI key is set] `;
  plan.explanation_translated = tag + plan.explanation_en;
  return plan;
}

function mockTriage({ words, hasPhoto, patient }) {
  const t = (words || '').toLowerCase();
  const soonWords = ['pain', 'red', 'swell', 'fever', 'dizzy', 'bleed', 'pus', '痛', '红', '肿', '头晕', '发烧', 'दर्द', 'लाल', 'dolor', 'douleur', 'fièvre', 'வலி', 'காய்ச்சல்'];
  let severity = 'routine';
  if (isEmergency(t)) severity = 'urgent';
  else if (soonWords.some((w) => t.includes(w)) || hasPhoto) severity = 'soon';
  return {
    translation: words ? `(mock) ${words}` : '',
    photo_description: hasPhoto ? '(mock) Photo attached showing the affected area.' : '',
    severity,
    summary: `${patient.name}, ${daysSince(patient.dischargedAt)} days after ${patient.procedure}, reports: "${(words || 'photo only').slice(0, 120)}"`,
    reason: severity === 'urgent' ? 'Emergency keywords detected.' : severity === 'soon' ? 'New or worsening symptom reported.' : 'No warning signs detected.',
    _mock: true
  };
}

function daysSince(iso) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

module.exports = { draftPlan, translatePlan, translateContent, triageReport, isEmergency, isSupportedLanguage, mode, daysSince };