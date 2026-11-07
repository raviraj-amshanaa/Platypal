// Smart Trouble Report form, shared by the patient and family pages.
// Expects elements: #trouble-open #trouble-form #mic #mic-hint #transcript #photo #photo-preview #send-report #emergency
function setupTroubleForm({ patientId, lang, from, fromName, familyCode, onSent }) {
  const $ = (id) => document.getElementById(id);
  let photo = null;
  let listening = false;

  $('trouble-open').onclick = () => {
    $('trouble-form').classList.toggle('hidden');
    $('trouble-open').classList.toggle('hidden');
  };

  const checkEmergency = () => $('emergency').classList.toggle('hidden', !looksLikeEmergency($('transcript').value));
  $('transcript').oninput = checkEmergency;

  // Voice notes are recognized in English only (most reliable). Patients and family can still TYPE in any language.
  $('mic-hint').textContent = 'Voice notes are in English. Tap again to stop. You can type in any language.';
  const rec = createRecognizer('en-US', (text) => { $('transcript').value = text; checkEmergency(); }, (on) => {
    listening = on;
    $('mic').classList.toggle('listening', on);
    $('mic').textContent = on ? '⏹ Listening… tap to stop' : '🎤 Tap to speak';
  });
  if (!rec) {
    $('mic').disabled = true;
    $('mic-hint').textContent = 'Voice input needs Chrome or Edge. You can type instead.';
  }
  $('mic').onclick = () => (listening ? rec.stop() : rec.start());

  $('photo').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    photo = await fileToDataUrl(f, 1200);
    $('photo-preview').src = photo;
    $('photo-preview').classList.remove('hidden');
  };

  $('send-report').onclick = async (e) => {
    const words = $('transcript').value.trim();
    if (!words && !photo) return toast('Speak, type or add a photo first');
    if (listening) rec.stop();
    e.target.disabled = true;
    e.target.textContent = 'Sending…';
    try {
      const { report } = await api(`/api/patients/${patientId}/reports`, {
        method: 'POST',
        body: { from, fromName, familyCode, transcript: words, photoDataUrl: photo, language: lang }
      });
      if (report.emergency) $('emergency').classList.remove('hidden');
      $('transcript').value = '';
      $('photo').value = '';
      $('photo-preview').classList.add('hidden');
      photo = null;
      $('trouble-form').classList.add('hidden');
      $('trouble-open').classList.remove('hidden');
      toast('Sent. Your care team will see it right away.');
      onSent && onSent(report);
    } catch (err) {
      toast(err.message);
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Send to my care team';
    }
  };
}

// The person's own words (any language), plus the English translation the care team reads
function messageBody(r) {
  const original = [r.transcript, r.text].filter(Boolean).join('\n') || (r.hasPhoto ? 'Photo sent' : '');
  const english = (r.translation || '').trim();
  const showEnglish = english && !english.startsWith('(mock)') && english.toLowerCase() !== original.toLowerCase();
  return `<div style="white-space:pre-wrap">${esc(original)}</div>
    ${r.hasPhoto && original !== 'Photo sent' ? '<div class="small muted">📷 Photo attached</div>' : ''}
    ${showEnglish ? `<div class="small" style="margin-top:6px;padding:8px 10px;border-radius:10px;background:var(--bg)"><span class="muted">English translation:</span> ${esc(english)}</div>` : ''}`;
}

function renderReportsList(reports, { english } = {}) {
  if (!reports.length) return '';
  return '<h3 style="margin-top:12px">Your messages</h3>' + [...reports]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => `
      <div class="card" style="box-shadow:none">
        <div class="small muted">${timeAgo(r.createdAt)} · from ${esc(r.fromName)}</div>
        ${messageBody(r)}
        ${r.staffResponse
          ? `<div class="notice" style="margin-top:8px">💬 <strong>${esc(r.staffResponse)}</strong>${r.staffNote ? `<div style="margin-top:4px">${esc(r.staffNote)}</div>` : ''}<div class="small muted">${esc(r.respondedBy || 'Care team')}, ${timeAgo(r.respondedAt)}</div></div>`
          : `<div class="small muted" style="margin-top:6px">Waiting for your care team…</div>`}
      </div>`).join('');
}