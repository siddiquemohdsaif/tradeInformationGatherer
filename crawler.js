// crawler.js
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const {
  getAllMarketScreenerData,
} = require("./market_screener_api.js");

// ---------- CONFIG ----------
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // Asia/Kolkata (no DST)
const RUN_HOUR_IST = 18; // 18:00 IST
const CONCURRENCY = 4;
const RETRIES = 2;

const ROOT_DIR = path.resolve(__dirname);
const DATA_DIR = path.resolve(ROOT_DIR, "data/");
const INFO_DIR = path.resolve(DATA_DIR, "info");
const COMPANIES_FILE = path.resolve(DATA_DIR, "companies_info.json");

// Ensure directories exist
for (const p of [DATA_DIR, INFO_DIR, path.dirname(COMPANIES_FILE)]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ---------- HELPERS ----------
function pickCompanyCode(codeArray) {
  // Prefer slug if available (contains '-'), else numeric/id
  if (!Array.isArray(codeArray) || codeArray.length === 0) return null;
  const slug = codeArray.find((c) => typeof c === "string" && c.includes("-"));
  return slug || codeArray[0] || null;
}

function loadCompaniesMap() {
  if (!fs.existsSync(COMPANIES_FILE)) {
    throw new Error(`companies_info.json not found at ${COMPANIES_FILE}`);
  }
  const raw = fs.readFileSync(COMPANIES_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid companies_info.json format");
  }
  return parsed;
}

function nextRunDelayMs() {
  const nowUtc = Date.now();
  const nowIst = new Date(nowUtc + IST_OFFSET_MS);

  // Today at 18:00 IST
  const targetIst = new Date(nowIst);
  targetIst.setHours(RUN_HOUR_IST, 0, 0, 0);

  let targetUtc = targetIst.getTime() - IST_OFFSET_MS;
  if (targetUtc <= nowUtc) {
    // If already past 18:00 IST today, schedule for tomorrow
    targetUtc += 24 * 60 * 60 * 1000;
  }
  return targetUtc - nowUtc;
}

async function withRetries(fn, retries = RETRIES, label = "") {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const attempt = i + 1;
      const more = i < retries;
      console.warn(
        `[retry] ${label} attempt ${attempt}/${retries + 1} failed: ${err && err.message}`
      );
      if (more) {
        // simple backoff: 1s * attempt
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastErr;
}

async function saveOutputs(symbol, companyCode, data) {
  // Save by companyCode
  const outByCode = path.resolve(INFO_DIR, `${companyCode}.json`);
  fs.writeFileSync(outByCode, JSON.stringify(data, null, 2), "utf8");

//   // Save by symbol too
//   const outBySymbol = path.resolve(INFO_DIR, `${symbol}.json`);
//   fs.writeFileSync(outBySymbol, JSON.stringify(data, null, 2), "utf8");

  console.log(`✅ Saved: ${path.relative(ROOT_DIR, outByCode)} & by_symbol/${symbol}.json`);
}

async function fetchOne(symbol, codeArray) {
  const companyCode = pickCompanyCode(codeArray);
  if (!companyCode) {
    throw new Error(`No usable company code for symbol: ${symbol}`);
  }

  const options = {
    includeAnnual: true,
    includeQuarterly: true,
    includeUpcomingEvents: true, // IMPORTANT: use the correct key your aggregator expects
    includePastEvents: true,
    includePastDividends: true,
  };

  const label = `${symbol}:${companyCode}`;
  const data = await withRetries(
    () => getAllMarketScreenerData(companyCode, options),
    RETRIES,
    label
  );

  await saveOutputs(symbol, companyCode, data);
}

async function runBatch() {
  console.log(`\n=== MarketScreener crawl started @ ${new Date().toISOString()} ===`);
  let companies;
  try {
    companies = loadCompaniesMap();
  } catch (err) {
    console.error(`❌ Failed to load companies: ${err.message}`);
    return;
  }

  const entries = Object.entries(companies);
  console.log(`Found ${entries.length} companies`);

  // Simple concurrency pool
  let index = 0;
  let success = 0;
  let failed = 0;

  async function worker(id) {
    while (index < entries.length) {
      const myIdx = index++;
      const [symbol, codeArray] = entries[myIdx];

      try {
        console.log(`[${id}] → ${symbol} starting`);
        await fetchOne(symbol, codeArray);
        success++;
      } catch (err) {
        failed++;
        console.error(`❌ ${symbol} failed: ${err && err.message}`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  console.log(
    `=== Crawl finished: success=${success}, failed=${failed}, at ${new Date().toISOString()} ===`
  );
}

// ---------- SCHEDULER ----------
function scheduleDailyAt18IST() {
  const delay = nextRunDelayMs();
  const nextRun = new Date(Date.now() + delay);
  console.log(
    `⏰ Scheduling next crawl at ${nextRun.toISOString()} (which is 18:00 IST)`
  );

  setTimeout(async () => {
    await runBatch();
    // Then every 24h thereafter
    setInterval(runBatch, 24 * 60 * 60 * 1000);
  }, delay);
}

// ---------- ENTRY ----------
(async () => {
  const args = process.argv.slice(2);
  const runNow = args.includes("--now");

  if (runNow) {
    await runBatch();
    process.exit(0);
  } else {
    scheduleDailyAt18IST();
  }
})();
