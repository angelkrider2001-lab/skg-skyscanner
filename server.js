require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getMonthPatternWindows, getAvailableMonths } = require('./lib/dates');
const { runScrapeJob, SCRAPERS } = require('./lib/orchestrator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const scrapeJobs = new Map();

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: 'scraping',
    airlines: SCRAPERS.map((s) => s.name),
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
  res.json({ windows: getMonthPatternWindows(year, month) });
});

app.post('/api/scrape', async (req, res) => {
  const year = parseInt(req.body.year, 10);
  const month = parseInt(req.body.month, 10);

  if (!year || !month) {
    return res.status(400).json({ error: 'Επίλεξε έτος και μήνα' });
  }

  const jobId = `scrape-${Date.now()}`;
  const windows = getMonthPatternWindows(year, month);
  const totalSteps = windows.length * SCRAPERS.length;

  scrapeJobs.set(jobId, {
    id: jobId,
    status: 'running',
    year,
    month,
    total: totalSteps,
    completed: 0,
    completedSteps: 0,
    currentAirline: null,
    currentWindow: null,
    results: [],
    error: null,
    startedAt: new Date().toISOString(),
  });

  res.json({ jobId, total: totalSteps, windows });

  runScrapeJob(scrapeJobs.get(jobId), windows).catch((err) => {
    const job = scrapeJobs.get(jobId);
    if (job && job.status !== 'done') {
      job.status = 'error';
      job.error = err.message;
    }
  });
});

app.get('/api/scrape/:jobId', (req, res) => {
  const job = scrapeJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Δεν βρέθηκε το scrape job' });
  res.json(job);
});

app.listen(PORT, () => {
  console.log(`\n✈  SKG Airline Scraper → http://localhost:${PORT}\n`);
});
