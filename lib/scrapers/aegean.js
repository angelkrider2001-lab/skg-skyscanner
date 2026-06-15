const { getRoutes } = require('./base');
const { scrapeWithPage, lowestFromJson } = require('./playwright-utils');

const AIRLINE = 'Aegean';
const AIRLINE_ID = 'aegean';

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
      searchFn: searchAegeanRoute,
    });
  } finally {
    await page.close();
  }
}

async function searchAegeanRoute(page, { origin, destination, destName, departDate, returnDate }) {
  const pricePromise = new Promise((resolve) => {
    const handler = async (response) => {
      const url = response.url();
      if (!/availability|fare|flight|search|booking/i.test(url)) return;
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
    `https://en.aegeanair.com/plan/book-a-flight/` +
    `?tripType=roundTrip&origin=${origin}&destination=${destination}` +
    `&departureDate=${departDate}&returnDate=${returnDate}&adults=1`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);

  const result = await pricePromise;

  if (result) {
    return {
      ...result,
      bookingUrl: url,
    };
  }

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

module.exports = {
  name: AIRLINE,
  id: AIRLINE_ID,
  scrapeRoundTrip,
};
