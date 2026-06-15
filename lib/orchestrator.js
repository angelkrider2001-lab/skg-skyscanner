const { chromium } = require('playwright');
const { SCRAPERS } = require('./scrapers');
const { mergeTopFlights, REQUEST_DELAY_MS, sleep, ORIGIN_NAME } = require('./scrapers/base');

let browser = null;
let browserContext = null;

async function getBrowserContext() {
  if (browserContext) return browserContext;

  browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  browserContext = await browser.newContext({
    locale: 'el-GR',
    timezoneId: 'Europe/Athens',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  return browserContext;
}

async function closeBrowser() {
  if (browserContext) {
    await browserContext.close();
    browserContext = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}

async function runScrapeJob(job, windows) {
  job.origin = { name: ORIGIN_NAME, code: 'SKG' };
  job.totalSteps = windows.length * SCRAPERS.length;
  job.completedSteps = 0;

  const playwrightScrapers = SCRAPERS.filter((s) => s.id !== 'ryanair');
  let context = null;

  try {
    if (playwrightScrapers.length > 0) {
      context = await getBrowserContext();
    }

    for (const window of windows) {
      const allFlights = [];
      const airlineErrors = [];

      for (const scraper of SCRAPERS) {
        job.currentAirline = scraper.name;
        job.currentWindow = window;

        try {
          const flights = await scraper.scrapeRoundTrip(
            {
              departDate: window.departDate,
              returnDate: window.returnDate,
            },
            context
          );
          allFlights.push(...(flights || []));
        } catch (err) {
          airlineErrors.push({
            airline: scraper.name,
            error: err.message,
          });
        }

        job.completedSteps += 1;
        job.completed = job.completedSteps;
        await sleep(REQUEST_DELAY_MS);
      }

      const top10 = mergeTopFlights(allFlights, 10);

      job.results.push({
        ...window,
        flights: top10,
        totalFound: allFlights.length,
        airlineErrors: airlineErrors.length ? airlineErrors : null,
      });
    }

    job.status = 'done';
    job.finishedAt = new Date().toISOString();
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
  } finally {
    await closeBrowser();
  }
}

module.exports = {
  runScrapeJob,
  closeBrowser,
  SCRAPERS,
};
