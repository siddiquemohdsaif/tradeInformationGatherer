// observer.js
// Polls MarketScreener endpoints per companyCode every minute and saves snapshots.
// Output path (project-relative): ./data/observer/<COMPANY_CODE>/<TIMESTAMP>_<COMPANY_CODE>.json

const fs = require("fs");
const path = require("path");

// import your existing functions
const {
  getAllMarketScreenerData,
} = require("./market_screener_api.js");

// ====== CONFIG ======
// 1) Where to save (project-relative, not absolute)
const BASE_DIR = path.resolve(__dirname, "data", "observer");

// 2) Default company list if none passed via CLI
//    Example: ["ITC-LIMITED-9743470", "IDFC-FIRST-BANK-LIMITED-46731334"]
const DEFAULT_COMPANIES = ["BANK-OF-MAHARASHTRA-9059511","ICICI-LOMBARD-GENERAL-INS-46731374","ICICI-PRUDENTIAL-LIFE-INS-32000303","PERSISTENT-SYSTEMS-LIMITE-9059922","TECH-MAHINDRA-LIMITED-33647041"];

// 3) Poll interval (ms). 60s as requested.
const POLL_INTERVAL_MS = 60_000;

// 4) Optional: small jitter (ms) to avoid exact alignment when many companies
const MAX_STARTUP_JITTER_MS = 3_000;

// 5) What to include on each fetch
const FETCH_OPTIONS = {
  includeAnnual: true,
  includeQuarterly: true,
  includeUpcomingEvents: true,
  includePastEvents: true,
  includePastDividends: true,
};

// ====== UTIL ======
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeForFilename(s) {
  // Windows-safe + general; replace characters that commonly break filenames
  return String(s).replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, " ").trim();
}

function isoForFilename(d = new Date()) {
  // e.g. 2025-10-13T12-34-56.789Z (no colons for Windows safety)
  return d.toISOString().replace(/:/g, "-");
}

function log(...args) {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}]`, ...args);
}

function logErr(...args) {
  const stamp = new Date().toISOString();
  console.error(`[${stamp}]`, ...args);
}

// ====== RUNNER ======
// Per-company state to prevent overlapping runs
const inFlight = new Map();

/**
 * Poll once for a given company and write a snapshot.
 */
async function pollOnce(companyCode) {
  if (inFlight.get(companyCode)) {
    // skip if previous poll hasn't finished
    log(`⏭️  Skip (still running): ${companyCode}`);
    return;
  }
  inFlight.set(companyCode, true);

  try {
    log(`⏳ Fetching: ${companyCode}`);
    const data = await getAllMarketScreenerData(companyCode, FETCH_OPTIONS);

    // Build path: ./data/observer/<COMPANY_CODE>/<TIMESTAMP>_<COMPANY_CODE>.json
    const companyDirName = sanitizeForFilename(companyCode);
    const dir = path.join(BASE_DIR, companyDirName);
    ensureDirSync(dir);

    const ts = isoForFilename();
    const fileName = `${ts}_${companyDirName}.json`;
    const outPath = path.join(dir, fileName);

    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
    log(`✅ Saved: ${outPath}`);
  } catch (err) {
    logErr(`❌ Error for ${companyCode}:`, err && err.stack ? err.stack : err);
  } finally {
    inFlight.set(companyCode, false);
  }
}

/**
 * Start the observer loop for a given company.
 * Returns an interval id so we can clear it on shutdown.
 */
function startCompanyLoop(companyCode, initialDelayMs = 0) {
  // Kick once after an optional stagger, then every minute.
  const timeout = setTimeout(async () => {
    await pollOnce(companyCode);

    const interval = setInterval(() => {
      pollOnce(companyCode);
    }, POLL_INTERVAL_MS);

    // store interval id on the timeout object for cleanup
    timeout._interval = interval; // eslint-disable-line no-underscore-dangle
  }, initialDelayMs);

  return timeout;
}

// ====== ENTRY ======
function parseCompanyListFromCLI() {
  // Usage:
  //   node observer.js IDFC-FIRST-BANK-LIMITED-46731334
  //   node observer.js IDFC-FIRST-BANK-LIMITED-46731334 ITC-LIMITED-9743470
  //   node observer.js "A,B,C"   (comma-separated)
  const args = process.argv.slice(2);
  if (args.length === 0) return DEFAULT_COMPANIES;

  if (args.length === 1 && args[0].includes(",")) {
    return args[0].split(",").map(s => s.trim()).filter(Boolean);
  }
  return args.map(s => s.trim()).filter(Boolean);
}

async function main() {
  ensureDirSync(BASE_DIR);

  const companies = parseCompanyListFromCLI();
  if (companies.length === 0) {
    logErr("No company codes provided. Exiting.");
    process.exit(1);
  }

  log(`Observer starting for ${companies.length} companies...`);
  companies.forEach(c => log(` - ${c}`));

  // Start loops with slight random staggering to avoid all firing at once
  const timers = companies.map((companyCode, idx) => {
    const jitter = Math.floor(Math.random() * MAX_STARTUP_JITTER_MS);
    // Add a small index-based spacing so larger sets spread out a bit more
    const delay = jitter + (idx * 250);
    return startCompanyLoop(companyCode, delay);
  });

  // Graceful shutdown
  const cleanup = () => {
    log("Shutting down observer...");
    for (const t of timers) {
      clearTimeout(t);
      if (t._interval) clearInterval(t._interval); // eslint-disable-line no-underscore-dangle
    }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch(err => {
  logErr("Fatal error:", err && err.stack ? err.stack : err);
  process.exit(1);
});
