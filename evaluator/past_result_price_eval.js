// ./evaluator/past_result_price_eval.js
const { getPriceAt } = require("../groww/stockHistoricalInfo");

/**
 * Parse "DD/MM/YYYY" or "DD/MM/YYYY hh:mm am|pm" -> "YYYY-MM-DD" (IST date only).
 * Returns null if it can't parse.
 */
function parseDDMMYYYYtoISO(dmy) {
  if (typeof dmy !== "string") return null;

  // Normalize spaces, lowercase for am/pm handling, strip any commas
  const s = dmy.replace(/,/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

  // Reject obvious non-dates like "today", "yesterday" etc.
  if (!/\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) return null;

  // Capture dd/mm/yyyy at the start
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;

  let [, ddStr, mmStr, yyyyStr] = m;
  const dd = parseInt(ddStr, 10);
  const mm = parseInt(mmStr, 10);
  const yyyy = parseInt(yyyyStr, 10);

  if (
    !Number.isInteger(dd) || !Number.isInteger(mm) || !Number.isInteger(yyyy) ||
    dd < 1 || dd > 31 || mm < 1 || mm > 12 || yyyy < 1900
  ) {
    return null;
  }

  // Format as YYYY-MM-DD
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return `${yyyy}-${pad(mm)}-${pad(dd)}`;
}

/**
 * Add/subtract days from an ISO date string ("YYYY-MM-DD") in IST.
 * Returns "YYYY-MM-DD".
 */
function shiftISODate(isoDate, deltaDays) {
  // Build a UTC date first, then just add days; we'll only output the date part.
  const [y, m, d] = isoDate.split("-").map((x) => parseInt(x, 10));
  if (![y, m, d].every(Number.isFinite)) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getUTCDate().toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Try to get the daily close for a given ISO date. If it's a non-trading day,
 * walk backwards up to `maxBackDays` to find the most recent trading day.
 * Returns { close: number, usedDateISO: string } or { close: null, usedDateISO: null }
 */
async function getNearestClose(stockCode, isoDate, maxBackDays = 7) {
  let tryDate = isoDate;

  for (let i = 0; i <= maxBackDays; i++) {
    try {
      const c = await getPriceAt(tryDate, stockCode); // expects "YYYY-MM-DD"
      if (c && Number.isFinite(c.close)) {
        return { close: c.close, usedDateISO: tryDate };
      }
    } catch (_) {
      // swallow and keep trying previous day
    }
    // move to previous day for next attempt
    tryDate = shiftISODate(tryDate, -1);
  }
  return { close: null, usedDateISO: null };
}

/**
 * Simple in-memory cache to avoid repeated API calls for the same (stock, date).
 * key: `${stockCode}|${isoDate}`
 */
const closeCache = new Map();
async function getCachedNearestClose(stockCode, isoDate, maxBackDays = 7) {
      console.log(stockCode)

  const key = `${stockCode}|${isoDate}`;
  if (closeCache.has(key)) return closeCache.get(key);

  const result = await getNearestClose(stockCode, isoDate, maxBackDays);
  console.log(result)
  closeCache.set(key, result);
  return result;
}

/**
 * For each item in outJson (mutates in place):
 *  - Parse date from item.dateTimeRaw ("DD/MM/YYYY" or "DD/MM/YYYY hh:mm am/pm").
 *  - currentDateClosePrice  := close price on/near that date.
 *  - pastYearDateClosePrice := close price on/near (that date - 1 year).
 *  - price_yoy_pct          := ((current - pastYear)/pastYear)*100
 *
 * If date can't be parsed or prices can't be fetched, set fields to null.
 *
 * @param {Array<Object>} outJson
 * @param {string} stockCode e.g., "HCLTECH", "INDUSINDBK"
 * @returns {Promise<void>}
 */
async function parsePastStockPrice(outJson, stockCode) {
  if (!Array.isArray(outJson)) {
    throw new Error("outJson must be an array");
  }
  if (typeof stockCode !== "string" || !stockCode.trim()) {
    throw new Error("stockCode is required and must be a non-empty string");
  }
  stockCode = stockCode.trim();

  // Process sequentially to be gentle on the API
  for (const item of outJson) {
    let currentDateISO = null;
    let pastYearDateISO = null;

    // Default outputs
    item.currentDateClosePrice = null;
    item.pastYearDateClosePrice = null;
    item.price_yoy_pct = null;

    try {
      const raw = item?.dateTimeRaw;
      currentDateISO = parseDDMMYYYYtoISO(raw);

      if (!currentDateISO) {
        // Unable to parse provided date; leave fields as null
        continue;
      }

      // Compute last year's same calendar date (YYYY-1)
      const [y, m, d] = currentDateISO.split("-").map((x) => parseInt(x, 10));
      pastYearDateISO = `${(y - 1)}-${m.toString().padStart(2, "0")}-${d
        .toString()
        .padStart(2, "0")}`;

      // Find nearest trading closes (with small backoff window)
      const { close: currClose } = await getCachedNearestClose(
        stockCode,
        currentDateISO,
        7
      );
      const { close: pastClose } = await getCachedNearestClose(
        stockCode,
        pastYearDateISO,
        10
      );

      item.currentDateClosePrice = Number.isFinite(currClose) ? currClose : null;
      item.pastYearDateClosePrice = Number.isFinite(pastClose) ? pastClose : null;

      if (
        Number.isFinite(item.currentDateClosePrice) &&
        Number.isFinite(item.pastYearDateClosePrice) &&
        item.pastYearDateClosePrice !== 0
      ) {
        item.price_yoy_pct =
          ((item.currentDateClosePrice - item.pastYearDateClosePrice) /
            item.pastYearDateClosePrice) *
          100;
      } else {
        item.price_yoy_pct = null;
      }
    } catch (_) {
      // On any error, keep the three fields as null for this row
      item.currentDateClosePrice = null;
      item.pastYearDateClosePrice = null;
      item.price_yoy_pct = null;
    }
  }

    console.log(outJson);

}

module.exports = {
  parsePastStockPrice,
};



if (require.main === module) {

    const outJson = [
  {
    "Quarter": "2020-Mar",
    "Sales": 18587,
    "EPS": 11.67,
    "sales_qoq_change": null,
    "sales_qoq_pct": null,
    "sales_yoy_change": null,
    "sales_yoy_pct": null,
    "eps_qoq_change": null,
    "eps_qoq_pct": null,
    "eps_yoy_change": null,
    "eps_yoy_pct": null,
    "dateTimeRaw": "07/05/2020"
  },
  {
    "Quarter": "2020-Jun",
    "Sales": 17842,
    "EPS": 10.8,
    "sales_qoq_change": -745,
    "sales_qoq_pct": -4.008177758648518,
    "sales_yoy_change": null,
    "sales_yoy_pct": null,
    "eps_qoq_change": -0.8699999999999992,
    "eps_qoq_pct": -7.45501285347043,
    "eps_yoy_change": null,
    "eps_yoy_pct": null,
    "dateTimeRaw": "17/07/2020"
  },
  {
    "Quarter": "2020-Sep",
    "Sales": 18594,
    "EPS": 11.58,
    "sales_qoq_change": 752,
    "sales_qoq_pct": 4.214774128460935,
    "sales_yoy_change": null,
    "sales_yoy_pct": null,
    "eps_qoq_change": 0.7799999999999994,
    "eps_qoq_pct": 7.222222222222216,
    "eps_yoy_change": null,
    "eps_yoy_pct": null,
    "dateTimeRaw": "16/10/2020"
  },
  {
    "Quarter": "2020-Dec",
    "Sales": 19302,
    "EPS": 14.63,
    "sales_qoq_change": 708,
    "sales_qoq_pct": 3.8076798967408845,
    "sales_yoy_change": null,
    "sales_yoy_pct": null,
    "eps_qoq_change": 3.0500000000000007,
    "eps_qoq_pct": 26.3385146804836,
    "eps_yoy_change": null,
    "eps_yoy_pct": null,
    "dateTimeRaw": "15/01/2021"
  },

];

    parsePastStockPrice(outJson, "HCLTECH");
}