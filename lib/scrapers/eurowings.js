const { getRoutes } = require('./base');
const { scrapeWithPage, lowestFromJson } = require('./playwright-utils');

const AIRLINE = 'Eurowings';
const AIRLINE_ID = 'eurowings';

async function scrapeRoundTrip({ departDate, returnDate }, browserContext) {
  const page = await browserContext.newPage();
  const destinations = getRoutes(AIRLINE_ID);

  try {
    return await scrapeWithPage(page, {
      airline: AIRLINE,
      airlineId: AIRLINE_ID,
      departDate,
      returnDate,
      destinations,
      searchFn: searchEurowingsRoute,
    });
  } finally {
    await page.close();
  }
}

async function searchEurowingsRoute(page, { origin, destination, departDate, returnDate }) {
  const pricePromise = new Promise((resolve) => {
    const handler = async (response) => {
      const url = response.url();
      if (!/shop|availability|fare|flight|search|booking/i.test(url)) return;
      try {
        const json = await response.json();
        const price = lowestFromJson(json);
        if (price != null) resolve({ price, currency: 'EUR' });
      } catch {
        // ignore
      }
    };
    page.on('response', handler);
    setTimeout(() => {
      page.off('response', handler);
      resolve(null);
    }, 20000);
  });

  const url =
    `https://www.eurowings.com/en/booking/flights/flight-search.html` +
    `?isReward=false&destination=${destination}&origin=${origin}` +
    `&fromdate=${formatEurowingsDate(departDate)}&todate=${formatEurowingsDate(returnDate)}` +
    `&adults=1&children=0&infants=0`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3500);

  const result = await pricePromise;
  if (result) return { ...result, bookingUrl: url };

  const text = await page.textContent('body');
  const match = text?.match(/€\s*([\d.,]+)/);
  if (match) {
    const price = parseFloat(match[1].replace(',', '.'));
    if (Number.isFinite(price)) {
      return { price, currency: 'EUR', bookingUrl: url };
    }
  }

  return null;
}

function formatEurowingsDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

module.exports = {
  name: AIRLINE,
  id: AIRLINE_ID,
  scrapeRoundTrip,
};
