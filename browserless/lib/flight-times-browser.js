const path = require('path');

const SKY_BASE = 'https://www.skyscanner.net';
const SKY_GR = 'https://www.skyscanner.gr';
const SCRAPE_WAIT_MS = 25000;
const POLL_STEP_MS = 2000;
const DIRECT_ONLY = true;

const SKY_CODE_TO_IATA = {
  BUCH: 'otp',
  BUHS: 'otp',
  OTPA: 'otp',
  BUDA: 'bud',
  KRAK: 'krk',
  WARS: 'waw',
  WAWA: 'waw',
  MALT: 'mla',
  MLTA: 'mla',
  CLUJ: 'clj',
  CLJA: 'clj',
  SOFI: 'sof',
  SOFA: 'sof',
  TIRN: 'tia',
  TIRA: 'tia',
  BEGO: 'beg',
  BELG: 'beg',
  BRAT: 'bts',
  PRAG: 'prg',
  PRGA: 'prg',
  VIEN: 'vie',
  VIEA: 'vie',
  WROCL: 'wro',
  WROC: 'wro',
  TIMI: 'tsr',
  IASI: 'ias',
  CATAN: 'cta',
  CATANIA: 'cta',
  PALER: 'pmo',
  PALERMO: 'pmo',
  CYPR: 'lca',
  LARN: 'lca',
  PAPH: 'pfo',
};

const COUNTRY_SKY_ID_TO_IATA = {
  MT: 'mla',
  MLTA: 'mla',
  MALT: 'mla',
  MALTA: 'mla',
  RO: 'otp',
  HU: 'bud',
  GR: 'ath',
  CY: 'lca',
  PL: 'waw',
  BG: 'sof',
  AL: 'tia',
  RS: 'beg',
  CZ: 'prg',
  AT: 'vie',
  SK: 'bts',
  DE: 'ber',
  FR: 'par',
  ES: 'mad',
  IT: 'mxp',
  GB: 'lon',
  IE: 'dub',
};

const DESTINATION_NAME_TO_IATA = {
  μάλτα: 'mla',
  malta: 'mla',
  ρουμανία: 'otp',
  romania: 'otp',
  ουγγαρία: 'bud',
  hungary: 'bud',
  ελλάδα: 'ath',
  greece: 'ath',
  κύπρος: 'lca',
  cyprus: 'lca',
  πολωνία: 'waw',
  poland: 'waw',
  βουλγαρία: 'sof',
  bulgaria: 'sof',
  αλβανία: 'tia',
  albania: 'tia',
  σερβία: 'beg',
  serbia: 'beg',
  τσεχία: 'prg',
  czech: 'prg',
  αυστρία: 'vie',
  austria: 'vie',
  σλοβακία: 'bts',
  slovakia: 'bts',
  ιταλία: 'mxp',
  italy: 'mxp',
  ισπανία: 'mad',
  spain: 'mad',
  γερμανία: 'ber',
  germany: 'ber',
  γαλλία: 'par',
  france: 'par',
};

let browserPromise = null;
const MAX_SCRAPE_CONCURRENT = 2;
let scrapeActive = 0;
const scrapeWaiters = [];

async function withScrapeSlot(fn) {
  while (scrapeActive >= MAX_SCRAPE_CONCURRENT) {
    await new Promise((resolve) => scrapeWaiters.push(resolve));
  }
  scrapeActive += 1;
  try {
    return await fn();
  } finally {
    scrapeActive -= 1;
    const next = scrapeWaiters.shift();
    if (next) next();
  }
}

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    try {
      return require(path.join(__dirname, '../../node_modules/playwright'));
    } catch {
      return null;
    }
  }
}

function formatSkyDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${String(year).slice(-2)}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

function resolveAirportCode(skyCode) {
  if (!skyCode) return 'xxx';
  const upper = skyCode.toUpperCase();
  if (SKY_CODE_TO_IATA[upper]) return SKY_CODE_TO_IATA[upper];
  if (upper.length === 3) return upper.toLowerCase();
  return upper.slice(0, 3).toLowerCase();
}

function airportCodeCandidates(skyCode) {
  const primary = resolveAirportCode(skyCode);
  const upper = (skyCode || '').toUpperCase();
  const extra = [];
  if (upper.startsWith('BUCH') || upper.startsWith('BUHS')) extra.push('otp', 'buh');
  return [...new Set([primary, ...extra])];
}

const { formatTime } = require('./time-format');

function formatPriceEur(price) {
  if (price == null || !Number.isFinite(price)) return '—';
  return `€${Math.round(price)}`;
}

function parseCapturedItineraries(data, maxPrice, directOnly = true) {
  const results = data?.itineraries?.results;
  const list = Array.isArray(results) ? results : results ? Object.values(results) : [];
  const lookup = data?.itineraries || {};
  const out = [];

  for (const it of list) {
    const price = it.price?.raw;
    if (price == null || price > maxPrice) continue;

    const legs = Array.isArray(it.legs)
      ? it.legs
      : (it.legIds || []).map((id) => lookup.legs?.[id]).filter(Boolean);
    if (!legs.length) continue;

    const outbound = legs[0];
    const inbound = legs[1];
    const stops = legs.reduce((sum, leg) => sum + (leg.stopCount || 0), 0);
    if (directOnly && stops > 0) continue;

    out.push({
      price: Math.round(price),
      formatted: formatPriceEur(price),
      outboundDepart: formatTime(outbound.departure),
      outboundArrive: formatTime(outbound.arrival),
      inboundDepart: inbound ? formatTime(inbound.departure) : '—',
      inboundArrive: inbound ? formatTime(inbound.arrival) : '—',
      stops,
      direct: stops === 0,
      carrier:
        outbound.carriers?.marketing?.[0]?.name ||
        outbound.segments?.[0]?.marketingCarrier?.name ||
        '',
    });
  }

  return out.sort((a, b) => a.price - b.price);
}

async function getBrowser() {
  const pw = loadPlaywright();
  if (!pw) return null;

  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = pw;
      try {
        return await chromium.launch({
          headless: true,
          channel: 'chrome',
          args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
        });
      } catch {
        return chromium.launch({ headless: true, args: ['--no-sandbox'] });
      }
    })();
  }

  return browserPromise;
}

async function scrapeCityTimes(originSkyId, city, departDate, returnDate, maxPrice, opts = {}) {
  if (process.env.VERCEL) return [];
  const directOnly = opts.directOnly !== false;
  const preferDirects = opts.preferDirects ?? directOnly;
  const pw = loadPlaywright();
  if (!pw) return [];

  const codes = airportCodeCandidates(city.skyCode);
  for (const destCode of codes) {
    const results = await scrapeCityTimesForCode(
      pw,
      originSkyId,
      city,
      destCode,
      departDate,
      returnDate,
      maxPrice,
      { directOnly, preferDirects }
    );
    if (results.length) return results;
  }
  return [];
}

async function scrapeCityTimesForCode(
  pw,
  originSkyId,
  city,
  destCode,
  departDate,
  returnDate,
  maxPrice,
  opts = {}
) {
  const directOnly = opts.directOnly !== false;
  const preferDirects = opts.preferDirects ?? directOnly;
  const out = formatSkyDate(departDate);
  const inn = formatSkyDate(returnDate);
  const url = `${SKY_GR}/transport/flights/${originSkyId.toLowerCase()}/${destCode}/${out}/${inn}/?adultsv2=1&cabinclass=economy&rtn=1&preferdirects=${preferDirects ? 'true' : 'false'}`;

  const run = async () => {
    const browser = await getBrowser();
    if (!browser) return [];

    const context = await browser.newContext({
      locale: 'el-GR',
      timezoneId: 'Europe/Athens',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: {
        'Accept-Language': 'el-GR,el;q=0.9',
      },
    });

    await context.addCookies([
      {
        name: 'ssculture',
        value: 'locale:::el-GR&market:::GR&currency:::EUR',
        domain: '.skyscanner.net',
        path: '/',
      },
      {
        name: 'ssculture',
        value: 'locale:::el-GR&market:::GR&currency:::EUR',
        domain: '.skyscanner.gr',
        path: '/',
      },
    ]);

    const page = await context.newPage();

    await page.route('**/web-unified-search**', async (route) => {
      const headers = {
        ...route.request().headers(),
        'X-Skyscanner-Market': 'GR',
        'X-Skyscanner-Currency': 'EUR',
        'X-Skyscanner-Locale': 'el-GR',
        'X-Skyscanner-ChannelId': 'banana',
      };
      await route.continue({ headers });
    });

    let best = [];

    page.on('response', async (response) => {
      if (!response.url().includes('web-unified-search')) return;
      try {
        const data = await response.json();
        const parsed = parseCapturedItineraries(data, maxPrice, directOnly);
        if (parsed.length > best.length) best = parsed;
      } catch {
        // ignore
      }
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      if (page.url().includes('captcha')) {
        return [];
      }

      const deadline = Date.now() + SCRAPE_WAIT_MS;
      while (Date.now() < deadline) {
        await page.waitForTimeout(POLL_STEP_MS);
        if (best.length >= 3) break;
      }

      return best;
    } catch {
      return [];
    } finally {
      await context.close();
    }
  };

  return withScrapeSlot(run);
}

function resolveDestinationCode(flight, options = [], cities = []) {
  if (options[0]?.cityCode) return resolveAirportCode(options[0].cityCode);
  if (cities[0]?.skyCode) return resolveAirportCode(cities[0].skyCode);

  const skyId = (flight?.skyId || '').toUpperCase();
  if (COUNTRY_SKY_ID_TO_IATA[skyId]) return COUNTRY_SKY_ID_TO_IATA[skyId];

  const fromSkyId = resolveAirportCode(skyId);
  if (fromSkyId && fromSkyId !== 'xxx') return fromSkyId;

  const name = (flight?.destination || '').trim().toLowerCase();
  if (DESTINATION_NAME_TO_IATA[name]) return DESTINATION_NAME_TO_IATA[name];
  for (const [key, code] of Object.entries(DESTINATION_NAME_TO_IATA)) {
    if (name.includes(key)) return code;
  }

  return 'xxx';
}

function buildSkyDeeplink(originSkyId, destCode, departDate, returnDate, preferDirects = false) {
  const out = formatSkyDate(departDate);
  const inn = formatSkyDate(returnDate);
  return `${SKY_GR}/transport/flights/${originSkyId.toLowerCase()}/${destCode.toLowerCase()}/${out}/${inn}/?adultsv2=1&cabinclass=economy&rtn=1&preferdirects=${preferDirects ? 'true' : 'false'}`;
}

function buildCityDeeplink(originSkyId, city, departDate, returnDate, preferDirects = false) {
  return buildSkyDeeplink(
    originSkyId,
    resolveAirportCode(city.skyCode),
    departDate,
    returnDate,
    preferDirects
  );
}

module.exports = {
  scrapeCityTimes,
  buildCityDeeplink,
  buildSkyDeeplink,
  resolveAirportCode,
  resolveDestinationCode,
  airportCodeCandidates,
  isAvailable: () => Boolean(loadPlaywright()),
};
