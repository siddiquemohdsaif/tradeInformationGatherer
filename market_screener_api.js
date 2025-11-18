const path = require("path");
const fs = require("fs");

const { getAnnualResults } = require("./annual_results.js");
const { getQuarterlyResults } = require("./quarterly_results.js");
const { getUpcomingEvents } = require("./upcoming_events.js");
const { getPastEvents } = require("./past_events.js");
const { getPastDividends } = require("./past_dividends.js");

/**
 * all MarketScreener endpoints.
 *
 * @param {string} companyCode - e.g., "ITC-LIMITED-9743470"
 * @param {Object} [options] - Configuration
 * @param {boolean} [options.includeAnnual=true]
 * @param {boolean} [options.includeQuarterly=true]
 * @param {boolean} [options.includeUpcomingEvents=true]
 * @param {boolean} [options.includePastEvents=false]
 * @param {boolean} [options.includePastDividends=false]
 * @returns {Object} Aggregated results
 */
async function getAllMarketScreenerData(companyCode, options = {}) {
  const {
    includeAnnual = true,
    includeQuarterly = true,
    includeUpcomingEvents = true,
    includePastEvents = false,
    includePastDividends = false,
  } = options;

  const results = {
    companyCode,
    timestamp: new Date().toISOString(),
  };

  if (includeAnnual) {
    try {
      results.annualResults = await getAnnualResults(companyCode);
    } catch (err) {
      results.annualResults = { error: err.message || "Failed to fetch annual results" };
    }
  }

  if (includeQuarterly) {
    try {
      results.quarterlyResults = await getQuarterlyResults(companyCode);
    } catch (err) {
      results.quarterlyResults = { error: err.message || "Failed to fetch quarterly results" };
    }
  }

  if (includeUpcomingEvents) {
    try {
      results.upcomingEvents = await getUpcomingEvents(companyCode);
    } catch (err) {
      results.upcomingEvents = { error: err.message || "Failed to fetch upcoming events" };
    }
  }

  if (includePastEvents) {
    try {
      results.pastEvents = await getPastEvents(companyCode);
    } catch (err) {
      results.pastEvents = { error: err.message || "Failed to fetch past events" };
    }
  }

  if (includePastDividends) {
    try {
      results.pastDividends = await getPastDividends(companyCode);
    } catch (err) {
      results.pastDividends = { error: err.message || "Failed to fetch past dividends" };
    }
  }

  return results;
}

// Export everything
module.exports = {
  getAnnualResults,
  getQuarterlyResults,
  getUpcomingEvents,
  getPastEvents,
  getPastDividends,
  getAllMarketScreenerData,
};





(async () => {
  const companyCode = "TITAN-COMPANY-LIMITED-46728594";
  const data = await getAllMarketScreenerData(companyCode, {
    includeAnnual: true,
    includeQuarterly: true,
    includeUpcoming: true,
    includePastEvents: true,
    includePastDividends: true,
  });

  // Print to console
  console.log(JSON.stringify(data, null, 2));

  // Save to JSON file
  const outPath = path.resolve(__dirname + "/data/info_dev/", companyCode + ".json");
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
  console.error(`✅ Saved to ${outPath}`);
})();