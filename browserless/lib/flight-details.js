const SKY_BASE = 'https://www.skyscanner.net';
const MARKET = 'GR';
const LOCALE = 'el-GR';
const CURRENCY = 'EUR';
const MAX_OVER_BASE = 70;
const DIRECT_ONLY = true;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 15;
const MAX_CITIES = 5;

const {
  scrapeCityTimes,
  buildCityDeeplink,
  buildSkyDeeplink,
  resolveAirportCode,
  resolveDestinationCode,
} = require('./flight-times-browser');
const { searchEverywhere } = require('./skyscanner');
const { formatTime } = require('./time-format');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDateParts(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}

function formatSkyDate(isoDate) {
  const { year, month, day } = parseDateParts(isoDate);
  const yy = String(year).slice(-2);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}


function skyHeaders(referer) {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Referer: referer || `${SKY_BASE}/`,
    'X-Skyscanner-ChannelId': 'banana',
    'X-Skyscanner-Currency': CURRENCY,
    'X-Skyscanner-Locale': LOCALE,
    'X-Skyscanner-Market': MARKET,
  };
}

async function skyPost(path, body, referer) {
  const res = await fetch(`${SKY_BASE}${path}`, {
    method: 'POST',
    headers: skyHeaders(referer),
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
    throw new Error(data?.errors?.join?.(', ') || data?.message || `HTTP ${res.status}`);
  }
  return data;
}

async function skyPoll(sessionId, referer) {
  const res = await fetch(
    `${SKY_BASE}/g/radar/api/v2/web-unified-search/${encodeURIComponent(sessionId)}`,
    {
      headers: { ...skyHeaders(referer), 'Content-Type': undefined },
      signal: AbortSignal.timeout(45000),
    }
  );
  return res.json();
}

function extractCountryCities(data) {
  const raw = data?.countryDestination?.results;
  const list = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];

  return list
    .filter((item) => item?.type === 'LOCATION')
    .map((item) => {
      const loc = item?.content?.location;
      const cheapest = item?.content?.flightQuotes?.cheapest;
      if (!loc || !cheapest?.rawPrice) return null;
      return {
        name: loc.name,
        entityId: String(loc.id),
        skyCode: loc.skyCode,
        price: cheapest.rawPrice,
        formatted: cheapest.price || `€${Math.round(cheapest.rawPrice)}`,
        direct: Boolean(cheapest.direct),
      };
    })
    .filter(Boolean);
}

function normalizeResults(results) {
  if (!results) return [];
  return Array.isArray(results) ? results : Object.values(results);
}

function resolveLegs(itinerary, lookup) {
  if (Array.isArray(itinerary.legs) && itinerary.legs.length) {
    return itinerary.legs;
  }
  const legIds = itinerary.legIds || [];
  return legIds.map((id) => lookup?.legs?.[id]).filter(Boolean);
}

function parseItinerary(itinerary, lookup, maxPrice, directOnly = true) {
  const price =
    itinerary.price?.raw ??
    itinerary.pricingOptions?.[0]?.price?.amount ??
    itinerary.pricingOptions?.[0]?.price?.raw;

  if (price == null || price > maxPrice) return null;

  const legs = resolveLegs(itinerary, lookup);
  if (!legs.length) return null;

  const outbound = legs[0];
  const inbound = legs[1];
  const stops = legs.reduce((sum, leg) => sum + (leg.stopCount || 0), 0);
  if (directOnly && stops > 0) return null;

  const carrier =
    outbound.carriers?.marketing?.[0]?.name ||
    outbound.carriers?.marketing?.[0]?.alternateId ||
    outbound.segments?.[0]?.marketingCarrier?.name ||
    '';

  return {
    price: Math.round(price),
    formatted: `€${Math.round(price)}`,
    outboundDepart: formatTime(outbound.departure),
    outboundArrive: formatTime(outbound.arrival),
    inboundDepart: inbound ? formatTime(inbound.departure) : '—',
    inboundArrive: inbound ? formatTime(inbound.arrival) : '—',
    stops,
    direct: stops === 0,
    carrier,
  };
}

async function pollItineraries(sessionId, referer, maxPrice, directOnly = true) {
  const seen = new Map();

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const data = await skyPoll(sessionId, referer);
    const ctx = data?.itineraries?.context;
    const results = normalizeResults(data?.itineraries?.results);

    for (const it of results) {
      const parsed = parseItinerary(it, data.itineraries, maxPrice, directOnly);
      if (parsed) seen.set(it.id || JSON.stringify(parsed), parsed);
    }

    if (ctx?.status === 'complete') break;
    if (ctx?.status === 'failure' && i > 2) break;

    await sleep(POLL_INTERVAL_MS);
  }

  return [...seen.values()].sort((a, b) => a.price - b.price);
}

function buildReferer(originCode, destCode, departDate, returnDate) {
  const out = formatSkyDate(departDate);
  const inn = formatSkyDate(returnDate);
  return `${SKY_BASE}/transport/flights/${originCode.toLowerCase()}/${destCode.toLowerCase()}/${out}/${inn}/?adultsv2=1&cabinclass=economy&rtn=1&preferdirects=true`;
}

function buildSearchPayload(originEntityId, destEntityId, departDate, returnDate) {
  const out = parseDateParts(departDate);
  const inn = parseDateParts(returnDate);
  return {
    cabinClass: 'ECONOMY',
    childAges: [],
    adults: 1,
    legs: [
      {
        legOrigin: { '@type': 'entity', entityId: originEntityId },
        legDestination: { '@type': 'entity', entityId: destEntityId },
        dates: { '@type': 'date', ...out },
      },
      {
        legOrigin: { '@type': 'entity', entityId: destEntityId },
        legDestination: { '@type': 'entity', entityId: originEntityId },
        dates: { '@type': 'date', ...inn },
      },
    ],
  };
}

async function resolveCountryEntity(origin, flight, departDate, returnDate) {
  try {
    const destinations = await searchEverywhere(origin, departDate, returnDate);
    const destNorm = (flight.destination || '').trim().toLowerCase();
    const match = destinations.find((d) => {
      const name = (d.destination || '').trim().toLowerCase();
      return name === destNorm || (flight.skyId && d.skyId === flight.skyId);
    });
    if (match?.entityId) return match.entityId;
  } catch {
    // fallback to stored id
  }
  return flight.entityId;
}

async function searchCountryCities(origin, countryEntityId, departDate, returnDate) {
  const payload = buildSearchPayload(origin.entityId, countryEntityId, departDate, returnDate);
  const data = await skyPost('/g/radar/api/v2/web-unified-search', payload, `${SKY_BASE}/`);
  return extractCountryCities(data);
}

async function searchCityItineraries(origin, city, departDate, returnDate, maxPrice, directOnly = true) {
  const destCode = resolveAirportCode(city.skyCode);
  const referer = buildReferer(origin.skyId, destCode, departDate, returnDate);
  const payload = buildSearchPayload(origin.entityId, city.entityId, departDate, returnDate);

  const data = await skyPost('/g/radar/api/v2/web-unified-search', payload, referer);
  const sessionId = data?.context?.sessionId;
  if (!sessionId) return [];

  const initial = normalizeResults(data?.itineraries?.results);
  const options = [];
  for (const it of initial) {
    const parsed = parseItinerary(it, data.itineraries, maxPrice, directOnly);
    if (parsed) options.push(parsed);
  }

  const polled = await pollItineraries(sessionId, referer, maxPrice, directOnly);
  const merged = new Map();
  for (const o of [...options, ...polled]) {
    const key = `${o.outboundDepart}-${o.inboundDepart}-${o.price}`;
    merged.set(key, o);
  }

  return [...merged.values()].sort((a, b) => a.price - b.price);
}

function pickCities(cities, maxPrice, directOnly) {
  return cities
    .filter((c) => c.price <= maxPrice)
    .filter((c) => !directOnly || c.direct)
    .sort((a, b) => a.price - b.price)
    .slice(0, MAX_CITIES);
}

async function fetchCityOptions(origin, city, departDate, returnDate, maxPrice, directOnly) {
  const scrapeOpts = { directOnly, preferDirects: directOnly };
  let options = await scrapeCityTimes(
    origin.skyId,
    city,
    departDate,
    returnDate,
    maxPrice,
    scrapeOpts
  );

  if (!options.length) {
    options = await searchCityItineraries(
      origin,
      city,
      departDate,
      returnDate,
      maxPrice,
      directOnly
    );
  }

  if (!options.length && directOnly) {
    options = await scrapeCityTimes(origin.skyId, city, departDate, returnDate, maxPrice, {
      directOnly: false,
      preferDirects: false,
    });
    if (!options.length) {
      options = await searchCityItineraries(
        origin,
        city,
        departDate,
        returnDate,
        maxPrice,
        false
      );
    }
  }

  return options;
}

async function fetchFlightDetails({ flight, period, origin }) {
  const basePrice = flight.price;
  const maxPrice = basePrice + MAX_OVER_BASE;
  const { departDate, returnDate } = period;

  if (!flight.entityId || !departDate || !returnDate) {
    throw new Error('Λείπουν δεδομένα πτήσης');
  }

  const countryEntityId = await resolveCountryEntity(origin, flight, departDate, returnDate);

  let rawCities = await searchCountryCities(origin, countryEntityId, departDate, returnDate);

  let directOnly = flight.direct !== false;
  let allowStops = flight.direct === false;
  let cities = pickCities(rawCities, maxPrice, directOnly);

  if (!cities.length && directOnly && rawCities.some((c) => c.price <= maxPrice)) {
    directOnly = false;
    allowStops = true;
    cities = pickCities(rawCities, maxPrice, false);
  }

  const preferDirects = directOnly && !allowStops;

  const periodDates =
    period.periodDates ||
    (period.departLabel && period.returnLabel
      ? `${period.departLabel} → ${period.returnLabel}`
      : `${departDate} → ${returnDate}`);

  if (!cities.length) {
    const destCode = resolveDestinationCode(flight);
    return {
      destination: flight.destination,
      basePrice,
      maxPrice,
      maxOver: MAX_OVER_BASE,
      periodDates,
      options: [],
      cityOnly: [],
      deeplink: buildSkyDeeplink(origin.skyId, destCode, departDate, returnDate, false),
      noCitiesInBudget: true,
      directOnly: false,
      allowStops: flight.direct === false,
      flightDirect: flight.direct,
    };
  }

  const allOptions = [];
  const cityOnly = [];

  for (const city of cities) {
    city.deeplink = buildCityDeeplink(origin.skyId, city, departDate, returnDate, preferDirects);

    try {
      const options = await fetchCityOptions(
        origin,
        city,
        departDate,
        returnDate,
        maxPrice,
        directOnly
      );

      if (options.length) {
        if (options.some((o) => o.stops > 0)) allowStops = true;
        for (const opt of options) {
          allOptions.push({ ...opt, city: city.name, cityCode: city.skyCode });
        }
      } else {
        cityOnly.push(city);
      }
    } catch {
      cityOnly.push(city);
    }
    await sleep(400);
  }

  allOptions.sort((a, b) => a.price - b.price);

  const destCode = resolveDestinationCode(flight, allOptions, cities);
  const deeplink = buildSkyDeeplink(
    origin.skyId,
    destCode,
    departDate,
    returnDate,
    directOnly && !allowStops
  );

  return {
    destination: flight.destination,
    basePrice,
    maxPrice,
    maxOver: MAX_OVER_BASE,
    periodDates,
    options: allOptions,
    cityOnly,
    deeplink,
    directOnly: directOnly && !allowStops,
    allowStops,
    flightDirect: flight.direct,
  };
}

module.exports = {
  MAX_OVER_BASE,
  DIRECT_ONLY,
  fetchFlightDetails,
};
