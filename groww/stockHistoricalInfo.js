const https = require("https");

// ---------- Utilities ----------
function assertString(name, v) {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`${name} is required and must be a non-empty string`);
  }
  return v.trim();
}
function assertInt(name, v) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${name} must be an integer`);
  }
  return n;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        { headers: { Accept: "application/json", "User-Agent": "node" } },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return reject(new Error(`HTTP ${res.statusCode}: ${data?.slice(0, 200)}`));
            }
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error("Failed to parse JSON: " + e.message));
            }
          });
        }
      )
      .on("error", reject);
  });
}

function buildUrl(stockCode, startMs, endMs, intervalInMinutes) {
  return `https://groww.in/v1/api/charting_service/v2/chart/delayed/exchange/NSE/segment/CASH/${encodeURIComponent(
    stockCode
  )}?endTimeInMillis=${endMs}&intervalInMinutes=${intervalInMinutes}&startTimeInMillis=${startMs}`;
}

// Epoch seconds -> "YYYY-MM-DD" in Asia/Kolkata (for matching daily candle)
function epochSecToDateIST(epochSec) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(epochSec * 1000));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ---------- IST parsing ----------
function parseISTMillis(dateTimeStr) {
  const s = assertString("dateTimeStr", dateTimeStr);
  const t = s.replace(/\s+/g, " ").trim();

  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [_, y, mo, d] = m;
    return istPartsToEpochMillis(+y, +mo, +d, 0, 0, 0);
  }

  m = t.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [_, y, mo, d, hh, mm, ss] = m;
    return istPartsToEpochMillis(+y, +mo, +d, +hh, +mm, +ss);
  }

  throw new Error('dateTimeStr must be "yyyy-mm-dd" or "yyyy-mm-dd hh:mm:ss" (IST)');
}

// IST is +05:30 fixed.
function istPartsToEpochMillis(y, mo, d, hh, mm, ss) {
  if (
    !Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d) ||
    !Number.isInteger(hh) || !Number.isInteger(mm) || !Number.isInteger(ss)
  ) {
    throw new Error("Invalid date/time numbers");
  }
  const utcMillis = Date.UTC(y, mo - 1, d, hh, mm, ss, 0);
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return utcMillis - IST_OFFSET_MS;
}

// Build IST start-of-day for an arbitrary epoch millis
function startOfISTDay(epochMs) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(epochMs));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const y = +get("year");
  const mo = +get("month");
  const d = +get("day");
  return istPartsToEpochMillis(y, mo, d, 0, 0, 0);
}

// ---------- Core API ----------

/**
 * Fetch historical candles between two IST strings with custom interval.
 * @param {string} stockCode - e.g., "INDUSINDBK"
 * @param {string} startDateTimeStr - "yyyy-mm-dd" or "yyyy-mm-dd hh:mm:ss" (IST)
 * @param {string} endDateTimeStr   - same format (IST)
 * @param {number} intervalInMinutes - integer > 0 (e.g., 1, 5, 15, 60, 1440)
 * @returns {Promise<{candles: number[][], [other]: any}>}
 */
async function fetchHistoricalData(stockCode, startDateTimeStr, endDateTimeStr, intervalInMinutes) {
  stockCode = assertString("stockCode", stockCode);
  const startMs = parseISTMillis(startDateTimeStr);
  const endMs = parseISTMillis(endDateTimeStr);
  const interval = assertInt("intervalInMinutes", intervalInMinutes);

  if (interval <= 0) throw new Error("intervalInMinutes must be > 0");
  if (endMs < startMs) throw new Error("endDateTime must be >= startDateTime");

  const url = buildUrl(stockCode, startMs, endMs, interval);
  return await fetchJSON(url);
}

/**
 * Get the **daily** candle for the given IST date/datetime.
 * Internally queries interval=1440 with:
 *   start = IST 00:00:00 of that date
 *   end   = start + 1439 minutes
 *
 * @param {string} dateTimeStr - "yyyy-mm-dd" or "yyyy-mm-dd hh:mm:ss" (IST)
 * @param {string} stockCode
 * @returns {Promise<{ts:number, open:number, high:number, low:number, close:number, volume:number} | null>}
 */
async function getPriceAt(dateTimeStr, stockCode) {
  stockCode = assertString("stockCode", stockCode);
  const baseMs = parseISTMillis(dateTimeStr);

  const startOfDayMs = startOfISTDay(baseMs);
  const endMs = startOfDayMs + (1439 * 60 * 1000); // daily window
  const url = buildUrl(stockCode, startOfDayMs, endMs, 1440);
  const data = await fetchJSON(url);

  const targetDate = epochSecToDateIST(Math.floor(startOfDayMs / 1000)); // "YYYY-MM-DD"
  const candles = Array.isArray(data?.candles) ? data.candles : [];

  for (const c of candles) {
    const ts = c[0]; // epoch seconds
    if (!Number.isFinite(ts)) continue;
    if (epochSecToDateIST(ts) === targetDate) {
      return { ts, open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] };
    }
  }
  return null;
}

// ---------- Exports ----------
module.exports = {
  fetchHistoricalData,
  getPriceAt,
};


/**
 * PS D:\Node Project\webscrap\ms-events\grow> node -e "const m=require('./stockHistoricalInfo'); m.fetchHistoricalData('INDUSINDBK','2025-09-05 09:15:00','2025-09-05 15:30:00',1440).then(d=>console.log(JSON.stringify(d,null,2))).catch(e=>console.error(e.message))"
{
  "candles": [
    [
      1757010600,
      756.35,
      759.5,
      750,
      757.05,
      2873689
    ]
  ],
  "changeValue": null,
  "changePerc": null,
  "closingPrice": null,
  "startTimeEpochInMillis": 1027017000000
}
PS D:\Node Project\webscrap\ms-events\grow> node -e "const m=require('./stockHistoricalInfo'); m.getPriceAt('2025-09-05','INDUSINDBK').then(console.log).catch(e=>console.error(e.message))"
{
  ts: 1757010600,
  open: 756.35,
  high: 759.5,
  low: 750,
  close: 757.05,
  volume: 2873689
}
PS D:\Node Project\webscrap\ms-events\grow> 
 */