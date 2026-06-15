const monthSelect = document.getElementById('monthSelect');
const scrapeBtn = document.getElementById('scrapeBtn');
const previewBtn = document.getElementById('previewBtn');
const statusText = document.getElementById('statusText');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const windowsPreview = document.getElementById('windowsPreview');
const windowsList = document.getElementById('windowsList');
const resultsSection = document.getElementById('resultsSection');
const resultsContainer = document.getElementById('resultsContainer');

let months = [];
let pollTimer = null;

const AIRLINE_CLASS = {
  Aegean: 'aegean',
  Ryanair: 'ryanair',
  'Sky Express': 'skyexpress',
  Eurowings: 'eurowings',
  easyJet: 'easyjet',
};

async function init() {
  try {
    const res = await fetch('/api/months');
    const data = await res.json();
    months = data.months || [];
    monthSelect.innerHTML = months
      .map((m, i) => `<option value="${i}">${m.label}</option>`)
      .join('');
    setStatus('Έτοιμο. Επίλεξε μήνα και πάτα «Έναρξη Scrape».');
  } catch {
    setStatus('Σφάλμα σύνδεσης με τον server. Τρέξε: npm start', true);
  }
}

function getSelectedMonth() {
  const idx = parseInt(monthSelect.value, 10);
  return months[idx];
}

function setStatus(msg, isError = false) {
  statusText.textContent = msg;
  statusText.classList.toggle('error', isError);
}

function setLoading(loading) {
  scrapeBtn.disabled = loading;
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
    renderWindows(data.windows || []);
    windowsPreview.classList.remove('hidden');
    setStatus(`Βρέθηκαν ${data.windows.length} περίοδοι για ${m.label}.`);
  } catch {
    setStatus('Αποτυχία φόρτωσης ημερομηνιών.', true);
  } finally {
    setLoading(false);
  }
}

function renderWindows(windows) {
  windowsList.innerHTML = windows
    .map(
      (w) => `
    <div class="window-chip">
      <span class="pattern">${w.patternLabel}</span>
      <span class="dates">${w.patternDays}</span>
      <span class="dates">Εβδ. ${w.week}: ${w.departLabel} → ${w.returnLabel}</span>
    </div>`
    )
    .join('');
}

async function startScrape() {
  const m = getSelectedMonth();
  if (!m) return;

  if (pollTimer) clearInterval(pollTimer);

  setLoading(true);
  resultsSection.classList.add('hidden');
  resultsContainer.innerHTML = '';
  progressBar.classList.remove('hidden');
  progressFill.style.width = '0%';
  setStatus(`Ξεκινά scrape για ${m.label}… (10–20 λεπτά)`);

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: m.year, month: m.month }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Αποτυχία scrape');
    }

    const { jobId, total } = await res.json();
    pollTimer = setInterval(() => pollJob(jobId, total, m.label), 1500);
    pollJob(jobId, total, m.label);
  } catch (err) {
    setStatus(err.message, true);
    setLoading(false);
    progressBar.classList.add('hidden');
  }
}

async function pollJob(jobId, total, monthLabel) {
  try {
    const res = await fetch(`/api/scrape/${jobId}`);
    const job = await res.json();

    const pct = total > 0 ? Math.round((job.completed / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;

    let statusMsg = `Scraping: ${job.completed}/${total} (${pct}%) — ${monthLabel}`;
    if (job.currentAirline && job.currentWindow) {
      statusMsg = `Scraping: ${job.currentAirline} · ${job.currentWindow.patternLabel} · εβδ. ${job.currentWindow.week} (${job.completed}/${total})`;
    }
    setStatus(statusMsg);

    if (job.status === 'error') {
      clearInterval(pollTimer);
      setStatus(job.error || 'Σφάλμα scrape', true);
      setLoading(false);
      return;
    }

    if (job.status === 'done') {
      clearInterval(pollTimer);
      progressFill.style.width = '100%';
      setStatus(`Ολοκληρώθηκε! ${job.results.length} περίοδοι scraped.`);
      renderResults(job);
      resultsSection.classList.remove('hidden');
      setLoading(false);
    }
  } catch {
    clearInterval(pollTimer);
    setStatus('Απώλεια σύνδεσης κατά το scrape.', true);
    setLoading(false);
  }
}

function airlineBadge(name) {
  const cls = AIRLINE_CLASS[name] || 'default';
  return `<span class="badge ${cls}">${escapeHtml(name)}</span>`;
}

function renderResults(job) {
  const origin = job.origin?.name || 'Θεσσαλονίκη';

  resultsContainer.innerHTML = job.results
    .map((block) => {
      const rows =
        block.flights.length > 0
          ? block.flights
              .map(
                (f, i) => `
          <tr>
            <td class="rank" data-label="#">${i + 1}</td>
            <td data-label="Εταιρεία">${airlineBadge(f.airline)}</td>
            <td data-label="Προορισμός">${escapeHtml(f.destination)}</td>
            <td class="price" data-label="Τιμή">${escapeHtml(f.formatted || `€${f.price}`)}</td>
            <td data-label="Κωδ.">${escapeHtml(f.destinationCode || '—')}</td>
          </tr>`
              )
              .join('')
          : '';

      const errors = block.airlineErrors
        ? block.airlineErrors
            .map((e) => `<li>${escapeHtml(e.airline)}: ${escapeHtml(e.error)}</li>`)
            .join('')
        : '';

      return `
      <article class="result-block">
        <div class="result-header">
          <h3>${escapeHtml(block.patternLabel)} <span style="color:var(--muted);font-weight:400">(${block.patternDays})</span></h3>
          <span class="meta">Εβδ. ${block.week} · ${block.departLabel} → ${block.returnLabel}</span>
        </div>
        ${
          rows
            ? `<table class="flights-table">
            <thead><tr><th>#</th><th>Εταιρεία</th><th>Προορισμός</th><th>Τιμή</th><th>Κωδ.</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`
            : `<p class="no-results">Δεν βρέθηκαν πτήσεις για αυτές τις ημερομηνίες.</p>`
        }
        ${errors ? `<ul class="api-error">${errors}</ul>` : ''}
        <p class="meta" style="margin-top:0.75rem">Αναχώρηση από ${escapeHtml(origin)} · ${block.totalFound || 0} αποτελέσματα συνολικά</p>
      </article>`;
    })
    .join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

scrapeBtn.addEventListener('click', startScrape);
previewBtn.addEventListener('click', previewWindows);

init();
