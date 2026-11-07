// Rule-based alerts + risk score for sorting the staff dashboard. Person C owns this file.
// Rules are deliberately simple and explainable (rubric: data to insights, Best Technical AI award counts rule-based logic).

const SEVERITY_RANK = { urgent: 3, soon: 2, routine: 1 };

function dateKey(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

// Count consecutive missed days (yesterday, day before, ...) for a daily med item, since approval.
function missedMedDays(item, approvedAt) {
  if (item.type !== 'med' || !approvedAt) return 0;
  const start = approvedAt.slice(0, 10);
  let missed = 0;
  for (let i = 1; i <= 7; i++) {
    const key = dateKey(i);
    if (key < start) break;
    if ((item.log || []).includes(key)) break;
    missed++;
  }
  return missed;
}

// Monitoring period: how long staff actively follow this patient after approval.
// After it ends, automatic alerts stop, but the patient can still send reports.
const DAY_MS = 86400000;
function monitoringInfo(plan) {
  if (!plan || plan.status !== 'approved' || !plan.approvedAt) return { status: 'not_started' };
  const start = new Date(plan.approvedAt);
  const ends = plan.monitorEndsAt ? new Date(plan.monitorEndsAt) : new Date(start.getTime() + (plan.monitorDays || 14) * DAY_MS);
  const total = Math.max(1, Math.round((ends - start) / DAY_MS));
  const day = Math.min(total, Math.floor((Date.now() - start) / DAY_MS) + 1);
  return { status: Date.now() < ends.getTime() ? 'active' : 'ended', day, total, endsAt: ends.toISOString() };
}

function computeAlerts(patient) {
  const monitoring = monitoringInfo(patient.plan);
  const alerts = [];
  const open = (patient.reports || []).filter((r) => !r.staffResponse);

  for (const r of open) {
    if (r.emergency) alerts.push({ level: 'urgent', text: 'Emergency words in a report' });
    else if (r.severity === 'urgent') alerts.push({ level: 'urgent', text: 'Urgent trouble report' });
    else if (r.severity === 'soon') alerts.push({ level: 'soon', text: 'Trouble report needs a call today' });
    else alerts.push({ level: 'routine', text: 'New routine report' });
    if (r.afterMonitoring) alerts.push({ level: 'soon', text: 'Returned after monitoring ended' });
  }

  // Missed-medicine and inactivity alerts only run while monitoring is active
  if (monitoring.status === 'active') {
    for (const item of patient.plan.checklist || []) {
      const days = missedMedDays(item, patient.plan.approvedAt);
      if (days >= 2) alerts.push({ level: 'soon', text: `Missed "${item.task_en}" ${days} days in a row` });
    }
  }

  if (patient.plan?.status === 'draft') alerts.push({ level: 'routine', text: 'Care plan waiting for approval' });
  if (patient.plan?.status === 'none' || !patient.plan) alerts.push({ level: 'routine', text: 'No care plan yet' });

  const hoursInactive = (Date.now() - new Date(patient.lastActive).getTime()) / 3600000;
  if (monitoring.status === 'active' && hoursInactive >= 48) {
    alerts.push({ level: 'soon', text: `No activity for ${Math.floor(hoursInactive / 24)} days` });
  }

  const score =
    alerts.reduce((s, a) => s + (a.level === 'urgent' ? 100 : a.level === 'soon' ? 30 : 5), 0);
  const top = alerts.reduce((best, a) => (SEVERITY_RANK[a.level] > SEVERITY_RANK[best] ? a.level : best), 'routine');
  return { alerts, score, top: alerts.length ? top : 'ok', monitoring };
}

module.exports = { computeAlerts, missedMedDays, monitoringInfo, SEVERITY_RANK };