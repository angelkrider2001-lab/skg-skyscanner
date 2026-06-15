const monthSelect = document.getElementById('monthSelect');
const searchBtn = document.getElementById('searchBtn');
const previewBtn = document.getElementById('previewBtn');
const resetBtn = document.getElementById('resetBtn');
const statusText = document.getElementById('statusText');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const windowsPreview = document.getElementById('windowsPreview');
const windowsList = document.getElementById('windowsList');
const resultsSection = document.getElementById('resultsSection');
const resultsContainer = document.getElementById('resultsContainer');
const flightModal = document.getElementById('flightModal');
const flightModalContent = document.getElementById('flightModalContent');

let months = [];
let pollTimer = null;
let detailsPollTimer = null;
let currentJob = null;
let activeJobId = null;
let detailsAbort = null;
let searchGeneration = 0;

const SUMMARY_INITIAL = 10;
const SUMMARY_MAX = 20;
let summaryVisibleCount = SUMMARY_INITIAL;

const STORAGE_KEY = 'skg-browserless-state';

function countryKey(f) {
  const dest = (f.destination || '').trim().toLowerCase();
  if (dest) return dest;
  return f.entityId || f.skyId || '';
}

function dedupeSummary(summary, limit = SUMMARY_MAX) {
  const sorted = [...summary]
    .filter((f) => f.direct === true)
    .sort((a, b) => a.price - b.price);
  const seen = new Set();
  const unique = [];
  for (const f of sorted) {
    const key = countryKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(f);
    if (unique.length >= limit) break;
  }
  return unique;
}

function buildSummaryFromResults(results, limit = SUMMARY_MAX) {
  const all = [];
  for (const block of results || []) {
    for (const f of block.flights || []) {
      if (f.direct !== true) continue;
      all.push({
        ...f,
        periodLabel: block.patternLabel,
        periodDates: `${block.departLabel} → ${block.returnLabel}`,
        departDate: block.departDate,
        returnDate: block.returnDate,
        week: block.week,
      });
    }
  }
  all.sort((a, b) => a.price - b.price);
  const seen = new Set();
  const unique = [];
  for (const f of all) {
    const key = countryKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(f);
    if (unique.length >= limit) break;
  }
  return unique;
}

function normalizeJob(job) {
  if (!job) return job;
  const summary = job.summary?.length
    ? dedupeSummary(job.summary)
    : buildSummaryFromResults(job.results);
  return { ...job, summary };
}

function isActiveSession(gen) {
  return gen === searchGeneration;
}

function flightDetailsKey(f) {
  return `${f.entityId}|${f.departDate || f.dataset?.departDate}|${f.returnDate || f.dataset?.returnDate}|${f.price ?? f.dataset?.price}`;
}

function findMonthLabel(year, month) {
  const m = months.find((x) => x.year === year && x.month === month);
  return m?.label || `${month}/${year}`;
}

function saveSession(job, monthLabel, gen = searchGeneration) {
  if (!job || gen !== searchGeneration) return;
  try {
    const normalized = normalizeJob(job);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        jobId: normalized.id,
        year: normalized.year,
        month: normalized.month,
        monthLabel: monthLabel || findMonthLabel(normalized.year, normalized.month),
        job: normalized,
        searchGeneration: gen,
        savedAt: new Date().toISOString(),
      })
    );
  } catch {
    // ignore quota errors
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePendingSearch({ jobId, year, month, monthLabel, total, skippedPast, gen }) {
  if (gen !== searchGeneration) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        jobId,
        year,
        month,
        monthLabel,
        total,
        skippedPast,
        searchGeneration: gen,
        job: { id: jobId, status: 'running', year, month, total, skippedPast, completed: 0, results: [] },
        savedAt: new Date().toISOString(),
      })
    );
  } catch {
    // ignore
  }
}

async function restoreSession() {
  const saved = loadSession();
  if (!saved) return false;

  if (saved.year && saved.month) {
    const idx = months.findIndex((m) => m.year === saved.year && m.month === saved.month);
    if (idx >= 0) monthSelect.value = String(idx);
  }

  if (saved.job?.status === 'done') {
    currentJob = normalizeJob(saved.job);
    activeJobId = saved.jobId || saved.job.id;
    renderResults(currentJob);
    resultsSection.classList.remove('hidden');
    progressBar.classList.add('hidden');
    const skip = saved.job.skippedPast ? ` · παράλειψη ${saved.job.skippedPast} παρελθουσών` : '';
    if (saved.job.detailsPrefetch?.running) {
      startDetailsPoll(saved.jobId || saved.job.id, saved.monthLabel);
    } else {
      setStatus(
        `Αποθηκευμένα αποτελέσματα: ${saved.job.results?.length || 0} περίοδοι${skip}.`
      );
    }
    return true;
  }

  if (!saved.jobId) return false;

  try {
    const res = await fetch(`/api/search/${saved.jobId}`);
    if (!res.ok) {
      if (saved.job?.results?.length) {
        currentJob = normalizeJob(saved.job);
        renderResults(currentJob);
        resultsSection.classList.remove('hidden');
        setStatus('Μερικά αποθηκευμένα αποτελέσματα (η αναζήτηση στον server έληξε).');
        return true;
      }
      return false;
    }

    const job = await res.json();
    if (job.status === 'done') {
      currentJob = normalizeJob(job);
      activeJobId = saved.jobId;
      saveSession(currentJob, saved.monthLabel);
      renderResults(currentJob);
      resultsSection.classList.remove('hidden');
      progressBar.classList.add('hidden');
      if (job.detailsPrefetch?.running) {
        startDetailsPoll(saved.jobId, saved.monthLabel);
      } else {
        const skip = job.skippedPast ? ` · παράλειψη ${job.skippedPast} παρελθουσών` : '';
        setStatus(`Ολοκληρώθηκε: ${job.results.length} περίοδοι με αποτελέσματα${skip}.`);
      }
      return true;
    }

    if (job.status === 'running') {
      setLoading(true);
      progressBar.classList.remove('hidden');
      const total = job.total || saved.total || 1;
      const monthLabel = saved.monthLabel || findMonthLabel(job.year, job.month);
      setStatus(`Συνέχιση αναζήτησης… (${job.completed}/${total})`);
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(
        () => pollJob(saved.jobId, total, monthLabel, job.skippedPast ?? saved.skippedPast),
        1200
      );
      pollJob(saved.jobId, total, monthLabel, job.skippedPast ?? saved.skippedPast);
      return true;
    }
  } catch {
    if (saved.job?.results?.length) {
      currentJob = normalizeJob(saved.job);
      renderResults(currentJob);
      resultsSection.classList.remove('hidden');
      setStatus('Αποθηκευμένα αποτελέσματα (offline).');
      return true;
    }
  }

  return false;
}

async function init() {
  try {
    await fetch('/api/health');
    const res = await fetch('/api/months');
    const data = await res.json();
    months = data.months || [];
    monthSelect.innerHTML = months
      .map((m, i) => `<option value="${i}">${m.label}</option>`)
      .join('');
    const restored = await restoreSession();
    if (!restored) {
      setStatus('Έτοιμο. Εμφανίζονται μόνο μελλοντικές ημερομηνίες.');
    }
  } catch {
    setStatus('Σφάλμα σύνδεσης. Τρέξε: cd browserless && npm start', true);
  }
}

function getSelectedMonth() {
  return months[parseInt(monthSelect.value, 10)];
}

function setStatus(msg, isError = false) {
  statusText.textContent = msg;
  statusText.classList.toggle('error', isError);
}

function setLoading(loading) {
  searchBtn.disabled = loading;
  previewBtn.disabled = loading;
  monthSelect.disabled = loading;
}

async function previewWindows() {
  const m = getSelectedMonth();
  if (!m) return;

  setLoading(true);
  try {
    const res = await fetch(`/api/windows?year=${m.year}&month=${m.month}`);
    const data = await res.json();
    renderWindows(data.windows || [], data.skippedPast);
    windowsPreview.classList.remove('hidden');
    const skipNote =
      data.skippedPast > 0 ? ` (παράλειψη ${data.skippedPast} παρελθουσών)` : '';
    setStatus(`${data.windows.length} περίοδοι για ${m.label}${skipNote}.`);
  } catch {
    setStatus('Αποτυχία φόρτωσης ημερομηνιών.', true);
  } finally {
    setLoading(false);
  }
}

function renderWindows(windows, skippedPast = 0) {
  let html = '';
  if (skippedPast > 0) {
    html += `<p class="skip-note">Παράλειψη ${skippedPast} περιόδων που έχουν ήδη περάσει.</p>`;
  }
  html += windows
    .map(
      (w) => `
    <div class="window-chip">
      <span class="pattern">${w.patternLabel}</span>
      <span class="dates">Εβδ. ${w.week}: ${w.departLabel} → ${w.returnLabel}</span>
    </div>`
    )
    .join('');
  windowsList.innerHTML = html || '<p class="no-results">Δεν υπάρχουν μελλοντικές περίοδοι.</p>';
}

async function startSearch() {
  const m = getSelectedMonth();
  if (!m) return;

  searchGeneration += 1;
  const myGen = searchGeneration;
  summaryVisibleCount = SUMMARY_INITIAL;

  if (pollTimer) clearInterval(pollTimer);
  if (detailsPollTimer) clearInterval(detailsPollTimer);
  pollTimer = null;
  detailsPollTimer = null;

  activeJobId = null;
  currentJob = null;
  localStorage.removeItem(STORAGE_KEY);

  try {
    await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch {
    // ignore
  }

  if (!isActiveSession(myGen)) return;

  setLoading(true);
  resultsSection.classList.add('hidden');
  resultsContainer.innerHTML = '';
  progressBar.classList.remove('hidden');
  progressFill.style.width = '0%';
  setStatus(`Αναζήτηση Skyscanner για ${m.label}…`);

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: m.year, month: m.month }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Αποτυχία αναζήτησης');
    }

    const { jobId, total, skippedPast } = data;
    if (!isActiveSession(myGen)) return;

    activeJobId = jobId;
    savePendingSearch({
      jobId,
      year: m.year,
      month: m.month,
      monthLabel: m.label,
      total,
      skippedPast,
      gen: myGen,
    });
    if (skippedPast > 0) {
      setStatus(`Αναζήτηση ${total} περιόδων (παράλειψη ${skippedPast} παρελθουσών)…`);
    }
    pollTimer = setInterval(() => pollJob(jobId, total, m.label, skippedPast, myGen), 1200);
    pollJob(jobId, total, m.label, skippedPast, myGen);
  } catch (err) {
    setStatus(err.message, true);
    setLoading(false);
    progressBar.classList.add('hidden');
  }
}

async function pollJob(jobId, total, monthLabel, skippedPast = 0, gen = searchGeneration) {
  if (!isActiveSession(gen) || jobId !== activeJobId) return;

  try {
    const res = await fetch(`/api/search/${jobId}`);
    const job = await res.json();

    if (!isActiveSession(gen) || jobId !== activeJobId) return;

    saveSession(job, monthLabel, gen);

    const pct = total > 0 ? Math.round((job.completed / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;

    let msg = `Skyscanner: ${job.completed}/${total} (${pct}%) — ${monthLabel}`;
    if (job.currentWindow) {
      msg = `${job.currentWindow.departLabel} → ${job.currentWindow.returnLabel} (${job.completed}/${total})`;
    }
    setStatus(msg);

    if (job.status === 'cancelled') {
      clearInterval(pollTimer);
      setLoading(false);
      progressBar.classList.add('hidden');
      setStatus('Η αναζήτηση ακυρώθηκε.', true);
      return;
    }

    if (job.status === 'error') {
      clearInterval(pollTimer);
      setStatus(job.error || 'Σφάλμα αναζήτησης', true);
      setLoading(false);
      return;
    }

    if (job.status === 'done') {
      clearInterval(pollTimer);
      pollTimer = null;
      if (!isActiveSession(gen) || jobId !== activeJobId) return;

      progressFill.style.width = '100%';
      currentJob = normalizeJob(job);
      renderResults(currentJob);
      resultsSection.classList.remove('hidden');
      setLoading(false);
      progressBar.classList.add('hidden');
      saveSession(currentJob, monthLabel, gen);
      startDetailsPoll(jobId, monthLabel, gen);
    }
  } catch {
    clearInterval(pollTimer);
    setStatus('Απώλεια σύνδεσης.', true);
    setLoading(false);
  }
}

function getCachedDetails(f, period) {
  const key = flightDetailsKey({
    entityId: f.entityId,
    departDate: period.departDate || f.departDate,
    returnDate: period.returnDate || f.returnDate,
    price: f.price,
  });
  const cached = currentJob?.detailsCache?.[key];
  if (cached && !isStaleDetailsCache(cached)) return cached;
  return null;
}

function getTimesBadge(f, period) {
  const cached = getCachedDetails(f, period);
  if (cached?.options?.length) return '';
  if (cached && !cached.error) return '<span class="times-badge ready" title="Έτοιμο">✓</span>';
  if (cached?.error) return '<span class="times-badge error" title="Σφάλμα">✗</span>';
  if (currentJob?.detailsPrefetch?.running) {
    return '<span class="times-badge loading" title="Φόρτωση…">⏳</span>';
  }
  return '<span class="meta">▸</span>';
}

function renderWhenTimes(f, period) {
  const cached = getCachedDetails(f, period);
  if (cached?.options?.length) {
    const best = cached.options[0];
    return `
      <div class="when-times">
        <span class="when-leg" title="Αναχώρηση">↗ ${escapeHtml(best.outboundDepart)} → ${escapeHtml(best.outboundArrive)}</span>
        <span class="when-leg" title="Επιστροφή">↙ ${escapeHtml(best.inboundDepart)} → ${escapeHtml(best.inboundArrive)}</span>
      </div>`;
  }
  if (cached?.error) {
    return '<span class="when-times when-times--muted">—</span>';
  }
  if (currentJob?.detailsPrefetch?.running) {
    return '<span class="when-times when-times--loading">⏳</span>';
  }
  return '';
}

function renderWhenCell(f, period) {
  return `
    <div class="when-cell">
      <div class="when-dates">
        <span class="when-period">${escapeHtml(f.periodLabel || '')}</span>
        <span class="meta when-range">${escapeHtml(f.periodDates || '')}</span>
      </div>
      ${renderWhenTimes(f, period)}
    </div>`;
}

function summaryMetaText(origin) {
  const name = origin || 'SKG';
  const pf = currentJob?.detailsPrefetch;
  if (pf?.running) {
    return `${name} → παντού · αυτόματη φόρτωση ωρών ${pf.done}/${pf.total}${pf.current ? ` (${pf.current})` : ''}`;
  }
  const ready = currentJob?.detailsCache ? Object.keys(currentJob.detailsCache).length : 0;
  if (ready > 0) {
    return `${name} → παντού · κλικ για ώρες (${ready} έτοιμα)`;
  }
  return `${name} → παντού · κλικ για ώρες`;
}

function startDetailsPoll(jobId, monthLabel, gen = searchGeneration) {
  if (!isActiveSession(gen) || jobId !== activeJobId) return;
  if (detailsPollTimer) clearInterval(detailsPollTimer);
  detailsPollTimer = setInterval(() => pollDetailsJob(jobId, monthLabel, gen), 2500);
  pollDetailsJob(jobId, monthLabel, gen);
}

async function pollDetailsJob(jobId, monthLabel, gen = searchGeneration) {
  if (!isActiveSession(gen) || jobId !== activeJobId) return;

  try {
    const res = await fetch(`/api/search/${jobId}`);
    const job = await res.json();

    if (!isActiveSession(gen) || jobId !== activeJobId) return;

    currentJob = normalizeJob(job);
    saveSession(currentJob, monthLabel, gen);
    renderResults(currentJob);

    const skip = job.skippedPast ? ` · παράλειψη ${job.skippedPast} παρελθουσών` : '';
    if (job.detailsPrefetch?.running) {
      const { done, total, current } = job.detailsPrefetch;
      setStatus(`Φόρτωση ωρών Top 10: ${done}/${total}${current ? ` · ${current}` : ''}…`);
      return;
    }

    if (job.status === 'cancelled' || job.detailsPrefetch?.cancelled) {
      clearInterval(detailsPollTimer);
      detailsPollTimer = null;
      return;
    }

    clearInterval(detailsPollTimer);
    detailsPollTimer = null;
    const ready = job.detailsCache ? Object.keys(job.detailsCache).length : 0;
    setStatus(
      `Ολοκληρώθηκε: ${job.results?.length || 0} περίοδοι · ώρες ${ready}/${job.summary?.length || ready}${skip}.`
    );
  } catch {
    clearInterval(detailsPollTimer);
    detailsPollTimer = null;
  }
}

function groupByWeek(results) {
  const map = new Map();
  for (const block of results) {
    if (!map.has(block.week)) map.set(block.week, []);
    map.get(block.week).push(block);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

function directBadge(f) {
  if (f.direct === true) return '';
  if (f.direct === false) return '<span class="stop-badge" title="Με στάση">1+ στάση</span>';
  return '';
}

function flightRowAttrs(f, period) {
  const attrs = {
    'data-entity-id': f.entityId || '',
    'data-sky-id': f.skyId || '',
    'data-destination': f.destination || '',
    'data-price': f.price ?? '',
    'data-direct': f.direct === false ? '0' : f.direct === true ? '1' : '',
    'data-depart-date': period.departDate || f.departDate || '',
    'data-return-date': period.returnDate || f.returnDate || '',
    'data-period-label': period.periodLabel || f.periodLabel || period.patternLabel || '',
    'data-period-dates':
      period.periodDates ||
      f.periodDates ||
      `${period.departLabel || ''} → ${period.returnLabel || ''}`,
  };
  return Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeHtml(String(v))}"`)
    .join(' ');
}

function renderFlightRows(flights, period, showPeriod = false) {
  const clickable =
    Boolean(period.departDate || flights[0]?.departDate) &&
    Boolean(period.returnDate || flights[0]?.returnDate);

  return flights
    .map((f, i) => {
      const rowPeriod = {
        departDate: period.departDate || f.departDate,
        returnDate: period.returnDate || f.returnDate,
        periodLabel: period.periodLabel || f.periodLabel,
        periodDates: period.periodDates || f.periodDates,
        patternLabel: period.patternLabel,
        departLabel: period.departLabel,
        returnLabel: period.returnLabel,
      };
      const canClick = clickable && rowPeriod.departDate && rowPeriod.returnDate;
      const badge = showPeriod && canClick ? getTimesBadge(f, rowPeriod) : canClick ? '<span class="meta">▸</span>' : '';
      return `
    <tr class="${canClick ? 'flight-row-clickable' : ''}" tabindex="${canClick ? '0' : '-1'}" ${canClick ? flightRowAttrs(f, rowPeriod) : ''}>
      <td class="rank" data-label="#">${i + 1}</td>
      <td data-label="Προορισμός">${escapeHtml(f.destination)} ${directBadge(f)} ${badge}</td>
      <td class="price" data-label="Τιμή">${escapeHtml(f.formatted || `€${f.price}`)}</td>
      ${
        showPeriod
          ? `<td data-label="Πότε">${renderWhenCell(f, rowPeriod)}</td>`
          : ''
      }
    </tr>`;
    })
    .join('');
}

function renderResults(job) {
  const normalized = normalizeJob(job);
  const origin = normalized.origin?.name || 'Θεσσαλονίκη';
  const summary = normalized.summary || [];
  const byWeek = groupByWeek(normalized.results);

  let html = '';

  if (summary.length) {
    const shown = summary.slice(0, summaryVisibleCount);
    const canExpand = summary.length > summaryVisibleCount;
    const titleCount = shown.length;

    html += `
    <article class="result-block summary-block">
      <div class="result-header">
        <h3>Top ${titleCount} φθηνότερες του μήνα</h3>
        <span class="meta">${escapeHtml(summaryMetaText(origin))} · μόνο απευθείας · 1 εγγραφή ανά χώρα</span>
      </div>
      <table class="flights-table">
        <thead><tr><th>#</th><th>Προορισμός</th><th>Τιμή</th><th>Πότε</th></tr></thead>
        <tbody>${renderFlightRows(shown, {}, true)}</tbody>
      </table>
      ${
        canExpand
          ? `<button type="button" class="summary-more-btn" aria-label="Εμφάνιση Top ${Math.min(SUMMARY_MAX, summary.length)}">
               <span class="summary-more-arrow">▼</span>
               <span>Συνέχεια · Top ${Math.min(SUMMARY_MAX, summary.length)}</span>
             </button>`
          : summaryVisibleCount > SUMMARY_INITIAL
            ? `<button type="button" class="summary-more-btn summary-more-btn--collapse" aria-label="Λιγότερα">
                 <span class="summary-more-arrow">▲</span>
                 <span>Top ${SUMMARY_INITIAL}</span>
               </button>`
            : ''
      }
    </article>`;
  }

  for (const [week, blocks] of byWeek) {
    html += `
    <article class="result-block">
      <div class="result-header">
        <h3>Εβδομάδα ${week}</h3>
        <span class="meta">${blocks.length} περίοδοι</span>
      </div>
      <div class="week-grid">`;

    for (const block of blocks) {
      const best = block.flights[0];
      html += `
        <div class="week-card">
          <p class="week-card-title">${escapeHtml(block.patternLabel)}</p>
          <p class="week-card-dates">${escapeHtml(block.departLabel)} → ${escapeHtml(block.returnLabel)}</p>
          ${
            best
              ? `<p class="week-card-best">Καλύτερη: <strong>${escapeHtml(best.destination)}</strong> · ${escapeHtml(best.formatted)}</p>
                 <details>
                   <summary>Όλοι οι προορισμοί (${block.flights.length}) · κλικ για ώρες</summary>
                   <table class="flights-table compact">
                     <tbody>${renderFlightRows(block.flights, block)}</tbody>
                   </table>
                 </details>`
              : '<p class="no-results">—</p>'
          }
        </div>`;
    }

    html += `</div></article>`;
  }

  if (!html) {
    html = '<p class="no-results">Δεν βρέθηκαν πτήσεις για τις μελλοντικές περιόδους.</p>';
  }

  resultsContainer.innerHTML = html;
}

function openModal() {
  flightModal.classList.remove('hidden');
  flightModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  flightModal.classList.add('hidden');
  flightModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  detailsAbort = null;
}

function renderModalLoading(destination, statusText) {
  flightModalContent.innerHTML = `
    <h3 class="modal-title" id="modalTitle">${escapeHtml(destination)}</h3>
    <p class="modal-loading">${escapeHtml(statusText || 'Φόρτωση διαθέσιμων ωρών…')}</p>
  `;
}

function modalLimitText(data) {
  const { basePrice, maxPrice } = data;
  if (data.allowStops || data.flightDirect === false) {
    return `Με στάσεις · €${basePrice}–€${maxPrice} (+€${data.maxOver} από την αρχική τιμή)`;
  }
  return `Μόνο απευθείας πτήσεις · €${basePrice}–€${maxPrice} (+€${data.maxOver} από την αρχική τιμή)`;
}

function stopsLabel(stops) {
  if (stops === 0) return 'απευθείας';
  if (stops === 1) return '1 στάση';
  return `${stops} στάσεις`;
}

function renderModalDetails(data) {
  const { destination, basePrice, maxPrice, periodDates, options, cityOnly, deeplink, allowStops } = data;
  const showStops = allowStops || options.some((o) => o.stops > 0);

  let body = '';

  if (options.length) {
    body = `
      <table class="times-table">
        <thead>
          <tr>
            <th>Πόλη</th>
            ${showStops ? '<th>Στάσεις</th>' : ''}
            <th>Αναχ.</th>
            <th>Άφιξη</th>
            <th>Επιστρ. αναχ.</th>
            <th>Επιστρ. άφιξη</th>
            <th>Τιμή</th>
          </tr>
        </thead>
        <tbody>
          ${options
            .map(
              (o) => `
            <tr>
              <td>${escapeHtml(o.city)}</td>
              ${showStops ? `<td>${escapeHtml(stopsLabel(o.stops))}</td>` : ''}
              <td>${escapeHtml(o.outboundDepart)}</td>
              <td>${escapeHtml(o.outboundArrive)}</td>
              <td>${escapeHtml(o.inboundDepart)}</td>
              <td>${escapeHtml(o.inboundArrive)}</td>
              <td class="price">${escapeHtml(o.formatted)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  } else if (data.noCitiesInBudget) {
    body = `<p class="modal-error">Δεν βρέθηκαν πτήσεις μέχρι €${maxPrice} (+€${data.maxOver} από την αρχική τιμή €${basePrice}).</p>`;
  } else {
    body = `<p class="modal-error">Δεν βρέθηκαν πτήσεις στο όριο τιμής.</p>`;
    if (cityOnly.length) {
      body += `
        <div class="city-fallback">
          <h4>Διαθέσιμες πόλεις (έως €${maxPrice}) — ενδεικτικές τιμές:</h4>
          <div class="city-chips">
            ${cityOnly
              .map(
                (c) =>
                  c.deeplink
                    ? `<a class="city-chip city-chip-link" href="${escapeHtml(c.deeplink)}" target="_blank" rel="noopener">${escapeHtml(c.name)} · ${escapeHtml(c.formatted)} ↗</a>`
                    : `<span class="city-chip">${escapeHtml(c.name)} · ${escapeHtml(c.formatted)}</span>`
              )
              .join('')}
          </div>
          <p class="modal-hint">Κλικ σε πόλη για ώρες στο Skyscanner.</p>
        </div>`;
    }
  }

  flightModalContent.innerHTML = `
    <h3 class="modal-title" id="modalTitle">${escapeHtml(destination)}</h3>
    <p class="modal-subtitle">${escapeHtml(periodDates)}</p>
    <p class="modal-limit">${escapeHtml(modalLimitText(data))}</p>
    ${body}
    <a class="modal-link" href="${escapeHtml(deeplink)}" target="_blank" rel="noopener">Άνοιγμα στο Skyscanner →</a>
  `;
}

function waitForDetailsCache(cacheKey, runId, maxMs = 120000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (detailsAbort !== runId) {
        clearInterval(timer);
        resolve(null);
        return;
      }
      const hit = currentJob?.detailsCache?.[cacheKey];
      if (hit) {
        clearInterval(timer);
        resolve(hit);
        return;
      }
      if (!currentJob?.detailsPrefetch?.running || Date.now() - started > maxMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 800);
  });
}

function isStaleDetailsCache(cached) {
  return Boolean(cached && !cached.error && !cached.options?.length && cached.cityOnly?.length);
}

async function handleFlightRowClick(row) {
  if (!row.classList.contains('flight-row-clickable')) return;

  const flight = {
    entityId: row.dataset.entityId,
    skyId: row.dataset.skyId,
    destination: row.dataset.destination,
    price: parseFloat(row.dataset.price, 10),
    direct: row.dataset.direct === '0' ? false : row.dataset.direct === '1' ? true : undefined,
  };

  const period = {
    departDate: row.dataset.departDate,
    returnDate: row.dataset.returnDate,
    periodLabel: row.dataset.periodLabel,
    periodDates: row.dataset.periodDates,
  };

  if (!flight.entityId || !period.departDate || !period.returnDate) return;

  const cacheKey = `${flight.entityId}|${period.departDate}|${period.returnDate}|${flight.price}`;
  const cached = currentJob?.detailsCache?.[cacheKey];

  const runId = Date.now();
  detailsAbort = runId;

  openModal();

  if (cached && !cached.error && !isStaleDetailsCache(cached)) {
    renderModalDetails(cached);
    return;
  }

  if (cached?.error) {
    flightModalContent.innerHTML = `
      <h3 class="modal-title">${escapeHtml(flight.destination)}</h3>
      <p class="modal-error">${escapeHtml(cached.error)}</p>
    `;
    return;
  }

  renderModalLoading(
    flight.destination,
    currentJob?.detailsPrefetch?.running
      ? 'Αναμονή φόρτωσης ωρών…'
      : 'Αναζήτηση ωρών πτήσεων…'
  );

  if (currentJob?.detailsPrefetch?.running) {
    const hit = await waitForDetailsCache(cacheKey, runId);
    if (detailsAbort !== runId) return;
    if (hit) {
      if (hit.error) {
        flightModalContent.innerHTML = `
          <h3 class="modal-title">${escapeHtml(flight.destination)}</h3>
          <p class="modal-error">${escapeHtml(hit.error)}</p>
        `;
        return;
      }
      if (!isStaleDetailsCache(hit)) {
        renderModalDetails(hit);
        return;
      }
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const res = await fetch('/api/flight-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        entityId: flight.entityId,
        skyId: flight.skyId,
        destination: flight.destination,
        price: flight.price,
        direct: flight.direct,
        departDate: period.departDate,
        returnDate: period.returnDate,
        periodLabel: period.periodLabel,
        periodDates: period.periodDates,
      }),
    });

    clearTimeout(timeout);
    const data = await res.json();
    if (detailsAbort !== runId) return;

    if (!res.ok) {
      throw new Error(data.error || 'Αποτυχία φόρτωσης ωρών');
    }

    if (currentJob && !isStaleDetailsCache(data)) {
      currentJob.detailsCache = currentJob.detailsCache || {};
      currentJob.detailsCache[cacheKey] = data;
      saveSession(currentJob, findMonthLabel(currentJob.year, currentJob.month));
    }

    renderModalDetails(data);
  } catch (err) {
    if (detailsAbort !== runId) return;
    flightModalContent.innerHTML = `
      <h3 class="modal-title">${escapeHtml(flight.destination)}</h3>
      <p class="modal-error">${escapeHtml(err.message || 'Αποτυχία φόρτωσης ωρών.')}</p>
    `;
  }
}

resultsContainer.addEventListener('click', (e) => {
  const moreBtn = e.target.closest('.summary-more-btn');
  if (moreBtn) {
    if (moreBtn.classList.contains('summary-more-btn--collapse')) {
      summaryVisibleCount = SUMMARY_INITIAL;
    } else {
      summaryVisibleCount = SUMMARY_MAX;
    }
    if (currentJob) renderResults(currentJob);
    return;
  }

  const row = e.target.closest('tr.flight-row-clickable');
  if (row) handleFlightRowClick(row);
});

resultsContainer.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('tr.flight-row-clickable');
  if (row) {
    e.preventDefault();
    handleFlightRowClick(row);
  }
});

flightModal.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-modal]')) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !flightModal.classList.contains('hidden')) closeModal();
});

async function resetAll() {
  searchGeneration += 1;
  summaryVisibleCount = SUMMARY_INITIAL;
  detailsAbort = Date.now();

  if (pollTimer) clearInterval(pollTimer);
  if (detailsPollTimer) clearInterval(detailsPollTimer);
  pollTimer = null;
  detailsPollTimer = null;

  closeModal();

  try {
    await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch {
    // ignore
  }

  activeJobId = null;
  currentJob = null;
  localStorage.removeItem(STORAGE_KEY);

  resultsSection.classList.add('hidden');
  resultsContainer.innerHTML = '';
  windowsPreview.classList.add('hidden');
  windowsList.innerHTML = '';
  progressBar.classList.add('hidden');
  progressFill.style.width = '0%';

  setLoading(false);
  setStatus('Reset. Έτοιμο για νέα αναζήτηση.');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

searchBtn.addEventListener('click', startSearch);
previewBtn.addEventListener('click', previewWindows);
resetBtn.addEventListener('click', resetAll);

init();
