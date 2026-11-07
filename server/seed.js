// Fake patients so the dashboard and alerts look real in the demo. No real patient data.
function daysAgo(n, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
function dateKey(n) {
  return daysAgo(n).slice(0, 10);
}

function seed() {
  return {
    patients: [
      {
        id: 'p_patel',
        name: 'Raj Patel',
        language: 'hi-IN',
        procedure: 'Knee replacement',
        dischargedAt: daysAgo(4),
        lastActive: daysAgo(0, 8),
        plan: {
          status: 'approved',
          approvedBy: 'Nurse Kim',
          approvedAt: daysAgo(4),
          explanation_en:
            'You had your knee replaced. For the next two weeks, take your pain medicine on schedule, keep the wound clean and dry, and walk a little every few hours.',
          explanation_translated:
            'आपके घुटने का प्रत्यारोपण हुआ है। अगले दो सप्ताह तक दर्द की दवा समय पर लें, घाव को साफ और सूखा रखें, और हर कुछ घंटों में थोड़ा चलें।',
          medications: [
            { id: 'm1', name: 'Acetaminophen', dose: '1000 mg', time: '8am, 2pm, 8pm', instructions_en: 'For pain', instructions_translated: 'दर्द के लिए' },
            { id: 'm2', name: 'Apixaban', dose: '2.5 mg', time: '8am, 8pm', instructions_en: 'Prevents blood clots. Do not skip.', instructions_translated: 'खून के थक्के रोकता है। न छोड़ें।' }
          ],
          appointments: [
            { id: 'a1', what_en: 'Staple removal', what_translated: 'टांके हटाना', when: 'Nov 14, 10:00am', mode: 'in_person', location: 'Riverside Hospital, Orthopedic Clinic, 2nd floor, Room 204', link: '' },
            { id: 'a2', what_en: 'Physiotherapy video check-in', what_translated: 'फिजियोथेरेपी वीडियो जांच', when: 'Nov 10, 3:00pm', mode: 'virtual', location: '', link: 'https://zoom.us/j/1234567890' }
          ],
          checklist: [
            { id: 'c1', type: 'med', task_en: 'Take morning medicines', task_translated: 'सुबह की दवाएं लें', log: [dateKey(4), dateKey(3)] },
            { id: 'c2', type: 'med', task_en: 'Take evening medicines', task_translated: 'शाम की दवाएं लें', log: [dateKey(4), dateKey(3)] },
            { id: 'c3', type: 'task', task_en: 'Walk for 5 minutes', task_translated: '5 मिनट चलें', log: [dateKey(1)] }
          ]
        },
        reports: [
          {
            id: 'r_patel1',
            from: 'patient',
            fromName: 'Raj Patel',
            createdAt: daysAgo(0, 8),
            language: 'hi-IN',
            transcript: 'मेरे घुटने के आसपास लाल हो गया है और दो दिन से दर्द बढ़ रहा है',
            translation: 'The area around my knee has turned red and the pain has been increasing for two days.',
            text: '',
            photo: null,
            photoDescription: '',
            severity: 'soon',
            aiSeverity: 'soon',
            summary: 'Patient reports redness around the knee incision and pain increasing over 2 days. Discharged 4 days ago after knee replacement.',
            reason: 'Worsening pain plus redness near the incision can be early signs of infection.',
            emergency: false,
            staffResponse: null,
            respondedAt: null
          }
        ],
        family: [
          { code: '482913', name: 'Priya Patel', relationship: 'Daughter', permissions: { checklist: true, reports: true, alerts: true, canReport: true }, createdAt: daysAgo(4) }
        ]
      },
      {
        id: 'p_chen',
        name: 'Mei Chen',
        language: 'zh-CN',
        procedure: 'Heart medication change',
        dischargedAt: daysAgo(2),
        lastActive: daysAgo(0, 7),
        plan: {
          status: 'approved',
          approvedBy: 'Nurse Kim',
          approvedAt: daysAgo(2),
          explanation_en: 'Your heart medicine was changed. Take the new dose every morning and stand up slowly, because it can make you dizzy.',
          explanation_translated: '您的心脏药物已更换。每天早上服用新剂量，起身时要慢，因为这种药可能会让您头晕。',
          medications: [
            { id: 'm1', name: 'Metoprolol', dose: '25 mg', time: '8am', instructions_en: 'Heart rate. Stand up slowly.', instructions_translated: '控制心率。起身要慢。' }
          ],
          appointments: [
            { id: 'a1', what_en: 'Cardiology follow-up', what_translated: '心脏科复诊', when: 'Nov 20, 2:30pm', mode: 'virtual', location: '', link: 'https://zoom.us/j/9876543210' }
          ],
          checklist: [
            { id: 'c1', type: 'med', task_en: 'Take morning heart medicine', task_translated: '服用早晨的心脏药', log: [dateKey(2), dateKey(1), dateKey(0)] }
          ]
        },
        reports: [
          {
            id: 'r_chen1',
            from: 'patient',
            fromName: 'Mei Chen',
            createdAt: daysAgo(0, 7),
            language: 'zh-CN',
            transcript: '我今天早上很头晕，差点摔倒，心跳很慢',
            translation: 'I was very dizzy this morning, almost fell, and my heartbeat feels very slow.',
            text: '',
            photo: null,
            photoDescription: '',
            severity: 'urgent',
            aiSeverity: 'urgent',
            summary: 'Severe dizziness with a near-fall and a slow-feeling heartbeat, 2 days after a heart medication change.',
            reason: 'Near-fall and possible slow heart rate after starting a heart-rate medicine needs prompt review.',
            emergency: false,
            staffResponse: null,
            respondedAt: null
          }
        ],
        family: []
      },
      {
        id: 'p_garcia',
        name: 'Elena Garcia',
        language: 'es-ES',
        procedure: 'Gallbladder removal',
        dischargedAt: daysAgo(5),
        lastActive: daysAgo(3),
        plan: {
          status: 'approved',
          approvedBy: 'Nurse Osei',
          approvedAt: daysAgo(5),
          monitorDays: 4, // ended yesterday, to demo "Monitoring ended"
          explanation_en: 'Your gallbladder was removed. Eat small, low-fat meals and keep the small wounds clean.',
          explanation_translated: 'Le quitaron la vesícula. Coma comidas pequeñas y bajas en grasa y mantenga limpias las heridas.',
          medications: [
            { id: 'm1', name: 'Ibuprofen', dose: '400 mg', time: 'Every 8 hours with food', instructions_en: 'For pain', instructions_translated: 'Para el dolor' }
          ],
          appointments: [{ id: 'a1', what_en: 'Surgeon follow-up', what_translated: 'Cita con el cirujano', when: 'Nov 18, 9:00am', mode: 'in_person', location: 'Riverside Hospital, General Surgery Clinic, Room 110', link: '' }],
          checklist: [
            { id: 'c1', type: 'med', task_en: 'Take pain medicine with food', task_translated: 'Tome el analgésico con comida', log: [dateKey(5), dateKey(4), dateKey(3)] }
          ]
        },
        reports: [],
        family: []
      },
      {
        id: 'p_lee',
        name: 'Wing Lee',
        language: 'zh-HK',
        procedure: 'Pneumonia',
        dischargedAt: daysAgo(0),
        lastActive: daysAgo(0, 8),
        plan: { status: 'none' },
        reports: [],
        family: []
      }
    ]
  };
}

module.exports = { seed };
