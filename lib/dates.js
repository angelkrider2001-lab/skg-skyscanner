const PATTERNS = [
  {
    id: 'thu-sun',
    label: 'Πέμπτη – Κυριακή',
    days: 'Πέμ · Παρ · Σάβ · Κυρ',
    departDay: 4,
    returnOffset: 3,
  },
  {
    id: 'fri-mon',
    label: 'Παρασκευή – Δευτέρα',
    days: 'Παρ · Σάβ · Κυρ · Δευ',
    departDay: 5,
    returnOffset: 3,
  },
  {
    id: 'sat-tue',
    label: 'Σάββατο – Τρίτη',
    days: 'Σάβ · Κυρ · Δευ · Τρί',
    departDay: 6,
    returnOffset: 3,
  },
];

const DAY_NAMES = ['Κυρ', 'Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ'];

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateGR(date) {
  return date.toLocaleDateString('el-GR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/**
 * Για κάθε εβδομάδα του μήνα, βρίσκει τις ημερομηνίες αναχώρησης/επιστροφής
 * ανά pattern (μία ανά εβδομάδα).
 */
function getMonthPatternWindows(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  const windows = [];

  for (const pattern of PATTERNS) {
    const byWeek = new Map();

    for (let day = 1; day <= lastDay; day++) {
      const depart = new Date(year, month - 1, day);
      if (depart.getDay() !== pattern.departDay) continue;

      const ret = new Date(depart);
      ret.setDate(ret.getDate() + pattern.returnOffset);

      const weekKey = `${depart.getFullYear()}-W${getISOWeek(depart)}`;
      if (!byWeek.has(weekKey)) {
        byWeek.set(weekKey, {
          patternId: pattern.id,
          patternLabel: pattern.label,
          patternDays: pattern.days,
          departDate: formatDateISO(depart),
          returnDate: formatDateISO(ret),
          departLabel: formatDateGR(depart),
          returnLabel: formatDateGR(ret),
          week: getISOWeek(depart),
        });
      }
    }

    windows.push(...byWeek.values());
  }

  windows.sort((a, b) => a.departDate.localeCompare(b.departDate));
  return windows;
}

function getAvailableMonths() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleDateString('el-GR', { month: 'long', year: 'numeric' }),
    });
  }
  return months;
}

module.exports = {
  PATTERNS,
  DAY_NAMES,
  formatDateISO,
  formatDateGR,
  getMonthPatternWindows,
  getAvailableMonths,
};
