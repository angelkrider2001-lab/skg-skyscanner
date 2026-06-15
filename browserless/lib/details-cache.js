function flightDetailsKey(flight) {
  return `${flight.entityId}|${flight.departDate}|${flight.returnDate}|${flight.price}`;
}

module.exports = { flightDetailsKey };
