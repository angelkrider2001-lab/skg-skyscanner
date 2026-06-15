const fs = require('fs');
const path = require('path');

const ORIGIN = 'SKG';
const ORIGIN_NAME = 'Θεσσαλονίκη';
const REQUEST_DELAY_MS = 2500;

const routesPath = path.join(__dirname, '../../data/routes-skg.json');
const routesData = JSON.parse(fs.readFileSync(routesPath, 'utf8'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrice(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object') {
    return parsePrice(value.raw ?? value.amount ?? value.total ?? value.formatted);
  }
  const n = parseFloat(String(value).replace(/[^\d.,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function formatPrice(price, currency = 'EUR') {
  if (price == null) return '—';
  if (currency === 'EUR') return `€${Math.round(price)}`;
  return `${price} ${currency}`;
}

function buildFlight({
  airline,
  airlineId,
  destination,
  destinationCode,
  price,
  currency = 'EUR',
  departDate,
  returnDate,
  bookingUrl,
}) {
  const p = parsePrice(price);
  if (p == null || !destinationCode) return null;
  return {
    airline,
    airlineId,
    destination: destination || destinationCode,
    destinationCode,
    price: p,
    currency,
    formatted: formatPrice(p, currency),
    departDate,
    returnDate,
    bookingUrl: bookingUrl || null,
  };
}

function getRoutes(airlineId) {
  return routesData[airlineId] || [];
}

async function withRetry(fn, retries = 1) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) await sleep(1500);
    }
  }
  throw lastErr;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Μη έγκυρη JSON απάντηση (${res.status})`);
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }

  return data;
}

function mergeTopFlights(flights, limit = 10) {
  const sorted = flights
    .filter((f) => f && f.price != null)
    .sort((a, b) => a.price - b.price);
  return sorted.slice(0, limit);
}

module.exports = {
  ORIGIN,
  ORIGIN_NAME,
  REQUEST_DELAY_MS,
  routesData,
  sleep,
  parsePrice,
  formatPrice,
  buildFlight,
  getRoutes,
  withRetry,
  fetchJson,
  mergeTopFlights,
};
