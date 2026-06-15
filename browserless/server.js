require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  getMonthPatternWindows,
  getMonthPatternWindowsWithMeta,
  getAvailableMonths,
} = require('./lib/dates');
const { getThessaloniki, getTop10ForWindow } = require('./lib/skyscanner');
const { fetchFlightDetails } = require('./lib/flight-details');
const { prefetchSummaryDetails, flightDetailsKey } = require('./lib/details-prefetch');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/favicon.ico', (_req, res) => {
  res.redirect(301, '/favicon.svg');
});

const searchJobs = new Map();

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: 'browserless',
    provider: 'Skyscanner direct HTTP',
    endpoint: '/g/radar/api/v2/web-unified-search',
  });
});

app.get('/api/months', (_req, res) => {
  res.json({ months: getAvailableMonths() });
});

app.get('/api/windows', (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month) {
    return res.status(400).json({ error: 'Απαιτούνται year και month' });
  }
  const meta = getMonthPatternWindowsWithMeta(year, month);
  res.json(meta);
});

app.post('/api/search', async (req, res) => {
  for (const job of searchJobs.values()) {
    if (job.status === 'running' || job.detailsPrefetch?.running) {
      job.cancelled = true;
      job.status = 'cancelled';
      if (job.detailsPrefetch) {
        job.detailsPrefetch.running = false;
        job.detailsPrefetch.cancelled = true;
      }
    }
  }
  searchJobs.clear();

  const year = parseInt(req.body.year, 10);
  const month = parseInt(req.body.month, 10);

  if (!year || !month) {
    return res.status(400).json({ error: 'Επίλεξε έτος και μήνα' });
  }

  const { windows, skippedPast, totalInMonth } = getMonthPatternWindowsWithMeta(year, month);

  if (windows.length === 0) {
    return res.status(400).json({
      error: 'Δεν υπάρχουν μελλοντικές περίοδοι για αυτόν τον μήνα. Διάλεξε επόμενο μήνα.',
      skippedPast,
      totalInMonth,
    });
  }

  const jobId = `job-${Date.now()}`;

  searchJobs.set(jobId, {
    id: jobId,
    status: 'running',
    year,
    month,
    total: windows.length,
    skippedPast,
    completed: 0,
    currentWindow: null,
    results: [],
    summary: null,
    error: null,
    startedAt: new Date().toISOString(),
  });

  res.json({ jobId, total: windows.length, skippedPast, windows });

  runSearchJob(jobId, windows, skippedPast).catch((err) => {
    const job = searchJobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = err.message;
    }
  });
});

app.get('/api/search/:jobId', (req, res) => {
  const job = searchJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Δεν βρέθηκε η αναζήτηση' });
  if (job.results?.length) {
    job.summary = buildSummary(job.results);
  }
  res.json(job);
});

app.post('/api/reset', (_req, res) => {
  for (const job of searchJobs.values()) {
    job.cancelled = true;
    if (job.status === 'running') {
      job.status = 'cancelled';
    }
    if (job.detailsPrefetch) {
      job.detailsPrefetch.running = false;
      job.detailsPrefetch.cancelled = true;
    }
  }
  searchJobs.clear();

  res.json({ ok: true });
});

app.post('/api/flight-details', async (req, res) => {
  const {
    entityId,
    skyId,
    destination,
    price,
    direct,
    departDate,
    returnDate,
    periodLabel,
    periodDates,
    departLabel,
    returnLabel,
  } = req.body;

  if (!entityId || !departDate || !returnDate || price == null) {
    return res.status(400).json({ error: 'Λείπουν απαιτούμενα πεδία' });
  }

  try {
    const origin = await getThessaloniki();
    const data = await fetchFlightDetails({
      flight: { entityId, skyId, destination, price: Number(price), direct },
      period: {
        departDate,
        returnDate,
        periodLabel,
        periodDates,
        departLabel,
        returnLabel,
      },
      origin,
    });

    const key = flightDetailsKey({
      entityId,
      departDate,
      returnDate,
      price: Number(price),
    });

    const job = findLatestDoneJob();
    if (job?.detailsCache) {
      job.detailsCache[key] = data;
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Αποτυχία φόρτωσης λεπτομερειών' });
  }
});

const SUMMARY_MAX = 20;

function countryKey(flight) {
  const dest = (flight.destination || '').trim().toLowerCase();
  if (dest) return dest;
  return flight.entityId || flight.skyId || '';
}

function buildSummary(results) {
  const all = [];
  for (const block of results) {
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
    if (unique.length >= SUMMARY_MAX) break;
  }
  return unique;
}

async function runSearchJob(jobId, windows, skippedPast) {
  const job = searchJobs.get(jobId);
  if (!job) return;

  job.skippedPast = skippedPast;

  let origin;
  try {
    origin = await getThessaloniki();
    job.origin = origin;
  } catch (err) {
    job.status = 'error';
    job.error = `Αποτυχία εύρεσης αεροδρομίου: ${err.message}`;
    return;
  }

  for (const window of windows) {
    if (job.cancelled) {
      job.status = 'cancelled';
      return;
    }

    job.currentWindow = window;

    const { flights, totalFound, error } = await getTop10ForWindow(
      origin,
      window.departDate,
      window.returnDate
    );

    if (job.cancelled) {
      job.status = 'cancelled';
      return;
    }

    if (flights?.length) {
      job.results.push({
        ...window,
        flights,
        totalFound: totalFound || 0,
      });
    }

    job.completed += 1;
  }

  if (job.cancelled) {
    job.status = 'cancelled';
    return;
  }

  job.summary = buildSummary(job.results);
  job.status = 'done';
  job.finishedAt = new Date().toISOString();
  job.detailsCache = {};
  job.detailsPrefetch = null;

  prefetchSummaryDetails(job).catch((err) => {
    if (job.cancelled) return;
    console.error('Prefetch summary details:', err.message);
    if (job.detailsPrefetch) {
      job.detailsPrefetch.running = false;
      job.detailsPrefetch.error = err.message;
    }
  });
}

function findLatestDoneJob() {
  let latest = null;
  for (const job of searchJobs.values()) {
    if (job.status !== 'done') continue;
    if (!latest || (job.finishedAt || '') > (latest.finishedAt || '')) latest = job;
  }
  return latest;
}

app.listen(PORT, () => {
  console.log(`\n✈  SKG Browserless (Skyscanner) → http://localhost:${PORT}\n`);
});
