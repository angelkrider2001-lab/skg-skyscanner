const fs = require('fs');
const path = require('path');
const { parsePrice, buildFlight, sleep } = require('./base');

const LOGS_DIR = path.join(__dirname, '../../logs');

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

async function captureJsonResponses(page, urlPattern, timeoutMs = 25000) {
  const responses = [];

  const handler = async (response) => {
    const url = response.url();
    if (!urlPattern.test(url)) return;
    try {
      const ct = response.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const json = await response.json();
      responses.push({ url, json });
    } catch {
      // ignore
    }
  };

  page.on('response', handler);
  await sleep(timeoutMs);
  page.off('response', handler);

  return responses;
}

async function scrapeWithPage(page, { airline, airlineId, departDate, returnDate, destinations, searchFn }) {
  const flights = [];

  for (const dest of destinations) {
    try {
      const result = await searchFn(page, {
        origin: 'SKG',
        destination: dest.code,
        destName: dest.name,
        departDate,
        returnDate,
      });

      if (result?.price != null) {
        const flight = buildFlight({
          airline,
          airlineId,
          destination: dest.name,
          destinationCode: dest.code,
          price: result.price,
          currency: result.currency || 'EUR',
          departDate,
          returnDate,
          bookingUrl: result.bookingUrl,
        });
        if (flight) flights.push(flight);
      }
    } catch (err) {
      ensureLogsDir();
      try {
        await page.screenshot({
          path: path.join(LOGS_DIR, `${airlineId}-${dest.code}-${Date.now()}.png`),
        });
      } catch {
        // ignore screenshot errors
      }
    }

    await sleep(1200);
  }

  return flights;
}

function deepFindPrices(obj, prices = []) {
  if (!obj || typeof obj !== 'object') return prices;

  if (Array.isArray(obj)) {
    for (const item of obj) deepFindPrices(item, prices);
    return prices;
  }

  const keys = ['price', 'totalPrice', 'amount', 'fare', 'lowestPrice', 'minPrice'];
  for (const key of keys) {
    if (key in obj) {
      const p = parsePrice(obj[key]);
      if (p != null && p > 0 && p < 5000) prices.push(p);
    }
  }

  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') deepFindPrices(val, prices);
  }

  return prices;
}

function lowestFromJson(json) {
  const prices = deepFindPrices(json, []);
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

module.exports = {
  captureJsonResponses,
  scrapeWithPage,
  deepFindPrices,
  lowestFromJson,
  ensureLogsDir,
};
