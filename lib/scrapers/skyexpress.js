const { getRoutes } = require('./base');
const { scrapeWithPage, lowestFromJson } = require('./playwright-utils');

const AIRLINE = 'Sky Express';
const AIRLINE_ID = 'skyexpress';

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
      searchFn: searchSkyExpressRoute,
    });
  } finally {
    await page.close();
  }
}

async function searchSkyExpressRoute(page, { origin, destination, departDate, returnDate }) {
  const pricePromise = new Promise((resolve) => {
    const handler = async (response) => {
      const url = response.url();
      if (!/availability|fare|flight|search|booking|api/i.test(url)) return;
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
    }, 18000);
  });

  const url =
    `https://www.skyexpress.gr/en/flights/` +
    `?from=${origin}&to=${destination}&depart=${departDate}&return=${returnDate}&adults=1`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);

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

module.exports = {
  name: AIRLINE,
  id: AIRLINE_ID,
  scrapeRoundTrip,
};
