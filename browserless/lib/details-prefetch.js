const { fetchFlightDetails } = require('./flight-details');
const { flightDetailsKey } = require('./details-cache');

const PREFETCH_CONCURRENCY = 2;

async function prefetchSummaryDetails(job) {
  const summary = job.summary || [];
  if (!summary.length || !job.origin) return;

  job.detailsCache = job.detailsCache || {};
  job.detailsPrefetch = {
    running: true,
    done: 0,
    total: summary.length,
    startedAt: new Date().toISOString(),
  };

  const queue = summary.map((flight) => ({ ...flight }));

  async function worker() {
    while (queue.length) {
      if (job.cancelled) break;

      const flight = queue.shift();
      if (!flight) break;

      const key = flightDetailsKey(flight);
      if (job.detailsCache[key]) {
        job.detailsPrefetch.done += 1;
        continue;
      }

      if (job.cancelled) break;

      try {
        const details = await fetchFlightDetails({
          flight: {
            entityId: flight.entityId,
            skyId: flight.skyId,
            destination: flight.destination,
            price: flight.price,
            direct: flight.direct,
          },
          period: {
            departDate: flight.departDate,
            returnDate: flight.returnDate,
            periodLabel: flight.periodLabel,
            periodDates: flight.periodDates,
          },
          origin: job.origin,
        });

        const stale =
          !details.error &&
          !details.options?.length &&
          details.cityOnly?.length > 0;

        if (!stale) {
          job.detailsCache[key] = details;
        }
      } catch (err) {
        job.detailsCache[key] = {
          error: err.message,
          destination: flight.destination,
          periodDates: flight.periodDates,
        };
      }

      job.detailsPrefetch.done += 1;
      job.detailsPrefetch.current = flight.destination;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PREFETCH_CONCURRENCY, summary.length) }, worker)
  );

  job.detailsPrefetch.running = false;
  job.detailsPrefetch.current = null;
  job.detailsPrefetch.finishedAt = new Date().toISOString();
  if (job.cancelled) {
    job.detailsPrefetch.cancelled = true;
  }
}

module.exports = { prefetchSummaryDetails, flightDetailsKey };
