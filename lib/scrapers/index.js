const ryanair = require('./ryanair');
const aegean = require('./aegean');
const skyexpress = require('./skyexpress');
const eurowings = require('./eurowings');
const easyjet = require('./easyjet');

const SCRAPERS = [ryanair, aegean, skyexpress, eurowings, easyjet];

module.exports = { SCRAPERS };
