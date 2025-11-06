// getLatestOutstandingShareBulk.js
// Bulk-fetch latest outstanding shares for all companies in companies_info.json
// and save to companies_outstandingshares.json as { "SYMBOL": number|null, ... }.
//
// Usage:
//   node getLatestOutstandingShareBulk.js
//   node getLatestOutstandingShareBulk.js --concurrency=5
//   node getLatestOutstandingShareBulk.js --symbols=ITC,RELIANCE,HDFCBANK
//
// Requires: getLatestOutstandingShare.js in the same folder.

const fs = require("fs");
const path = require("path");
const { getLatestOutstandingShare } = require("./getLatestOutstandingShare");

// ---- CONFIG ----
const DATA_DIR = "D:\\Node Project\\webscrap\\ms-events\\data";
const COMP_INFO_PATH = path.resolve(DATA_DIR, "companies_info.json");
const OUTPUT_PATH = path.resolve(DATA_DIR, "companies_outstandingshares.json");

// Defaults; can be overridden by CLI flags
let CONCURRENCY = 6;     // parallel fetches
const RETRIES = 2;       // per company
const BASE_DELAY_MS = 150; // jitter base between tasks

// ---- UTIL ----
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function pickMarketScreenerCode(entryArr) {
  // companies_info.json format:
  // [ zerodhaInstrument, marketScreenerCode, bsePath ]
  // We need the MarketScreener code (2nd element), e.g. "ITC-LIMITED-9743470"
  return Array.isArray(entryArr) && entryArr.length >= 2 ? entryArr[1] : null;
}

async function withRetry(fn, retries, label) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        const backoff = 300 * (i + 1);
        console.error(`Retry ${i + 1}/${retries} for ${label} after ${backoff}ms: ${err?.message || err}`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

// Simple promise pool for concurrency control
async function mapPool(items, limit, worker) {
  const ret = new Array(items.length);
  let idx = 0, active = 0;

  return new Promise((resolve, reject) => {
    const launchNext = () => {
      if (idx >= items.length && active === 0) return resolve(ret);
      while (active < limit && idx < items.length) {
        const i = idx++;
        active++;
        (async () => {
          try {
            ret[i] = await worker(items[i], i);
          } catch (e) {
            reject(e);
            return;
          } finally {
            active--;
            launchNext();
          }
        })();
      }
    };
    launchNext();
  });
}

// ---- CORE ----
/**
 * Loads companies_info.json, fetches latest outstanding shares for each symbol,
 * writes companies_outstandingshares.json, and returns the mapping object.
 *
 * @param {Object} opts
 * @param {string[]} [opts.onlySymbols]  Optional subset of symbols to fetch.
 * @param {number} [opts.concurrency]    Parallel workers.
 * @returns {Promise<Record<string, number|null>>}
 */
async function getLatestOutstandingShareBulk(opts = {}) {
  if (opts.concurrency && Number.isFinite(+opts.concurrency) && +opts.concurrency > 0) {
    CONCURRENCY = +opts.concurrency;
  }

  // Load companies_info.json
  const raw = fs.readFileSync(COMP_INFO_PATH, "utf8");
  const companyMap = JSON.parse(raw);

  // Create list of [symbol, msCode]
  let entries = Object.entries(companyMap)
    .map(([symbol, arr]) => [symbol, pickMarketScreenerCode(arr)])
    .filter(([, code]) => !!code);

  // Optional filter
  if (opts.onlySymbols && opts.onlySymbols.length) {
    const set = new Set(opts.onlySymbols.map((s) => s.trim().toUpperCase()));
    entries = entries.filter(([symbol]) => set.has(symbol));
  }

  const out = {};
  let done = 0;

  // Worker
  const results = await mapPool(
    entries,
    CONCURRENCY,
    async ([symbol, msCode], i) => {
      // small jitter to avoid bursts
      await sleep(BASE_DELAY_MS + Math.floor(Math.random() * 120));

      const value = await withRetry(
        async () => {
          const n = await getLatestOutstandingShare(msCode); // returns absolute number or null
          return n ?? null;
        },
        RETRIES,
        `${symbol}`
      );

      out[symbol] = value;
      done++;
      if (done % 10 === 0 || done === entries.length) {
        console.error(`Progress: ${done}/${entries.length}`);
      }
      return [symbol, value];
    }
  );

  // Persist
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.error(`✅ Wrote ${results.length} entries to ${OUTPUT_PATH}`);
  return out;
}

// ---- CLI ----
if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv);
    const subset = args.symbols ? args.symbols.split(",").map((s) => s.trim()).filter(Boolean) : null;
    const concurrency = args.concurrency ? Number(args.concurrency) : undefined;

    try {
      const map = await getLatestOutstandingShareBulk({
        onlySymbols: subset || undefined,
        concurrency,
      });
      // Print compact JSON to stdout
      console.log(JSON.stringify(map));
    } catch (err) {
      console.error("❌ Bulk fetch failed:", err?.message || err);
      process.exit(2);
    }
  })();
}

module.exports = { getLatestOutstandingShareBulk };
