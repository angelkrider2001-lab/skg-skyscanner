const SKYSCANNER_BASE = 'https://www.skyscanner.net';
const MARKET = 'GR';
const LOCALE = 'el-GR';
const CURRENCY = 'EUR';

const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;
const REQUEST_DELAY_MS = 1000;

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Referer: `${SKYSCANNER_BASE}/`,
  'X-Skyscanner-ChannelId': 'banana',
  'X-Skyscanner-Currency': CURRENCY,
  'X-Skyscanner-Locale': LOCALE,
  'X-Skyscanner-Market': MARKET,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function skyPost(path, body) {
  const cacheKey = `${path}:${JSON.stringify(body)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  await sleep(REQUEST_DELAY_MS);

  const res = await fetch(`${SKYSCANNER_BASE}${path}`, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Μη έγκυρη απάντηση Skyscanner (${res.status})`);
  }

  if (!res.ok) {
    const msg = data?.errors?.join?.(', ') || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  cache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

async function skyGet(path) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  await sleep(500);

  const res = await fetch(`${SKYSCANNER_BASE}${path}`, {
    headers: {
      'User-Agent': DEFAULT_HEADERS['User-Agent'],
      Accept: 'application/json',
      Referer: DEFAULT_HEADERS.Referer,
      'X-Skyscanner-Locale': LOCALE,
      'X-Skyscanner-Market': MARKET,
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`Skyscanner GET ${res.status}`);
  }

  const data = await res.json();
  cache.set(path, { ts: Date.now(), data });
  return data;
}

let thessalonikiCache = null;

async function getThessaloniki() {
  if (thessalonikiCache) return thessalonikiCache;

  const places = await skyGet(
    `/g/autosuggest-search/api/v1/search-flight/${MARKET}/${LOCALE}/Thessaloniki?isDestination=false`
  );

  const match =
    places.find((p) => p.PlaceId === 'SKG') ||
    places.find((p) => /thessalon/i.test(p.PlaceName || p.CityName || ''));

  if (match) {
    thessalonikiCache = {
      entityId: String(match.GeoContainerId || match.GeoId || '95673868'),
      skyId: match.PlaceId || 'SKG',
      name: match.PlaceName || match.CityName || 'Θεσσαλονίκη (SKG)',
    };
    return thessalonikiCache;
  }

  thessalonikiCache = {
    entityId: '95673868',
    skyId: 'SKG',
    name: 'Θεσσαλονίκη (SKG)',
  };
  return thessalonikiCache;
}

function parseDateParts(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}

function extractEverywhereDestinations(data) {
  const results = [];
  const raw = data?.everywhereDestination?.results;

  const list = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];

  for (const item of list) {
    if (item?.type !== 'LOCATION') continue;

    const loc = item?.content?.location;
    const quotes = item?.content?.flightQuotes;
    const cheapest = quotes?.cheapest || quotes?.direct;

    if (!loc || !cheapest?.rawPrice) continue;

    results.push({
      destination: loc.name || loc.skyCode,
      skyId: loc.skyCode || loc.id,
      entityId: loc.id ? String(loc.id) : undefined,
      price: cheapest.rawPrice,
      currency: CURRENCY,
      formatted: cheapest.price || `€${Math.round(cheapest.rawPrice)}`,
      source: 'Skyscanner',
      direct: Boolean(cheapest.direct),
    });
  }

  return results;
}

async function searchEverywhere(origin, departDate, returnDate) {
  const out = parseDateParts(departDate);
  const inn = parseDateParts(returnDate);

  const payload = {
    cabinClass: 'ECONOMY',
    childAges: [],
    adults: 1,
    legs: [
      {
        legOrigin: { '@type': 'entity', entityId: origin.entityId },
        legDestination: { '@type': 'everywhere' },
        dates: { '@type': 'date', ...out },
      },
      {
        legOrigin: { '@type': 'everywhere' },
        legDestination: { '@type': 'entity', entityId: origin.entityId },
        dates: { '@type': 'date', ...inn },
      },
    ],
  };

  const data = await skyPost('/g/radar/api/v2/web-unified-search', payload);
  const results = extractEverywhereDestinations(data);

  if (results.length === 0) {
    throw new Error('Δεν βρέθηκαν προορισμοί');
  }

  return results;
}

const { getTodayISO } = require('./dates');

async function getTop10ForWindow(origin, departDate, returnDate) {
  const today = getTodayISO();
  if (departDate < today || returnDate < today) {
    return { flights: [], totalFound: 0, skipped: true };
  }

  try {
    const destinations = await searchEverywhere(origin, departDate, returnDate);
    destinations.sort((a, b) => a.price - b.price);
    return {
      flights: destinations.slice(0, 10),
      totalFound: destinations.length,
    };
  } catch (err) {
    return { error: err.message, flights: [], totalFound: 0 };
  }
}

module.exports = {
  getThessaloniki,
  getTop10ForWindow,
  searchEverywhere,
};
