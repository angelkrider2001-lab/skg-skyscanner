function timePeriodLabel(hour) {
  if (hour >= 5 && hour < 12) return 'πρωί';
  if (hour >= 12 && hour < 14) return 'μεσημέρι';
  if (hour >= 14 && hour < 18) return 'απόγευμα';
  return 'βράδυ';
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${String(h).padStart(2, '0')}:${m} ${timePeriodLabel(h)}`;
}

module.exports = { formatTime, timePeriodLabel };
