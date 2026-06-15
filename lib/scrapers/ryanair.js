const {
  ORIGIN,
  buildFlight,
  fetchJson,
  withRetry,
  parsePrice,
} = require('./base');

const AIRLINE = 'Ryanair';
const AIRLINE_ID = 'ryanair';

async function scrapeRoundTrip({ departDate, returnDate }) {
  const url = new URL('https://www.ryanair.com/api/farfnd/v4/roundTripFares');
  url.searchParams.set('departureAirportIataCode', ORIGIN);
  url.searchParams.set('outboundDepartureDateFrom', departDate);
  url.searchParams.set('outboundDepartureDateTo', departDate);
  url.searchParams.set('inboundDepartureDateFrom', returnDate);
  url.searchParams.set('inboundDepartureDateTo', returnDate);
  url.searchParams.set('market', 'el-gr');
  url.searchParams.set('language', 'el');
  url.searchParams.set('currency', 'EUR');

  const data = await withRetry(() =>
    fetchJson(url.toString(), {
      headers: {
        'x-ryanair-client': 'desktop',
      },
    })
  );

  return await extractFares(data, departDate, returnDate);
}

async function extractFares(data, departDate, returnDate) {
  const flights = [];
  const list = data?.fares || [];

  for (const item of list) {
    const outbound = item.outbound || item;
    const arrival = outbound.arrivalAirport || item.arrivalAirport;
    const code = arrival?.iataCode || item.arrivalAirportIataCode;
    const name = arrival?.city?.name || arrival?.name || code;
    const outPrice = parsePrice(outbound?.price?.value ?? outbound?.price);
    const inPrice = parsePrice(item.inbound?.price?.value ?? item.inbound?.price);
    const price =
      outPrice != null && inPrice != null ? outPrice + inPrice : outPrice ?? inPrice;

    const flight = buildFlight({
      airline: AIRLINE,
      airlineId: AIRLINE_ID,
      destination: name,
      destinationCode: code,
      price,
      departDate,
      returnDate,
      bookingUrl: code
        ? `https://www.ryanair.com/el/gr/trip/flights/select?adults=1&teens=0&children=0&infants=0&dateOut=${departDate}&dateIn=${returnDate}&isConnectedFlight=false&discount=0&promoCode=&originIata=${ORIGIN}&destinationIata=${code}&tpAdults=1&tpTeens=0&tpChildren=0&tpInfants=0&tpStartDate=${departDate}&tpEndDate=${returnDate}&tpDiscount=0&tpPromoCode=&tpOriginIata=${ORIGIN}&tpDestinationIata=${code}`
        : null,
    });

    if (flight) flights.push(flight);
  }

  if (flights.length === 0) {
    return await scrapeViaAvailabilityFallback(departDate, returnDate);
  }

  return flights;
}

async function scrapeViaAvailabilityFallback(departDate, returnDate) {
  const { getRoutes } = require('./base');
  const destinations = getRoutes('ryanair').length
    ? getRoutes('ryanair')
    : [
        { code: 'STN', name: 'Λονδίνο Stansted' },
        { code: 'BGY', name: 'Μπέργκamo' },
        { code: 'BER', name: 'Βερολίνο' },
        { code: 'BUD', name: 'Βουδαπέστη' },
        { code: 'BCN', name: 'Βαρκελώνη' },
        { code: 'CIA', name: 'Ρώμη Ciampino' },
        { code: 'CRL', name: 'Βρυξέλλες Charleroi' },
        { code: 'PFO', name: 'Πάφος' },
        { code: 'CHQ', name: 'Χανιά' },
        { code: 'RHO', name: 'Ρόδος' },
        { code: 'VIE', name: 'Βιέννη' },
        { code: 'PRG', name: 'Πράγα' },
      ];

  const flights = [];
  for (const dest of destinations.slice(0, 12)) {
    try {
      const url = new URL('https://www.ryanair.com/api/booking/v4/el-gr/availability');
      url.searchParams.set('ADT', '1');
      url.searchParams.set('CHD', '0');
      url.searchParams.set('INF', '0');
      url.searchParams.set('TEEN', '0');
      url.searchParams.set('Origin', ORIGIN);
      url.searchParams.set('Destination', dest.code);
      url.searchParams.set('DateOut', departDate);
      url.searchParams.set('DateIn', returnDate);
      url.searchParams.set('RoundTrip', 'true');
      url.searchParams.set('IncludeConnectingFlights', 'false');
      url.searchParams.set('FlexDaysOut', '0');
      url.searchParams.set('FlexDaysIn', '0');
      url.searchParams.set('ToUs', 'AGREED');

      const data = await fetchJson(url.toString(), {
        headers: {
          'fr-correlation-id': `skg-${Date.now()}`,
        },
      });

      const price = findLowestAvailabilityPrice(data);
      const flight = buildFlight({
        airline: AIRLINE,
        airlineId: AIRLINE_ID,
        destination: dest.name,
        destinationCode: dest.code,
        price,
        departDate,
        returnDate,
      });
      if (flight) flights.push(flight);
    } catch {
      // skip destination
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  return flights;
}

function findLowestAvailabilityPrice(data) {
  const trips = data?.trips || data?.data?.trips || [];
  let min = null;

  for (const trip of trips) {
    const dates = trip?.dates || [];
    for (const d of dates) {
      const flights = d?.flights || [];
      for (const f of flights) {
        const p = parsePrice(f?.regularFare?.amount ?? f?.fare?.amount ?? f?.price);
        if (p != null && (min == null || p < min)) min = p;
      }
    }
  }

  return min;
}

module.exports = {
  name: AIRLINE,
  id: AIRLINE_ID,
  scrapeRoundTrip,
};
