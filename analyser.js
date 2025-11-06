// analyser.js
// Usage:
//   node analyser.js                                 -> prints both lists
//   node analyser.js /path/to/folder                 -> scans that folder
//   const { getLatestUpComingEarningReleaseEvent, getLatestLastDividend } = require('./analyser');
//   const list1 = getLatestUpComingEarningReleaseEvent({ dir: "./data" });
//   const list2 = getLatestLastDividend({ dir: "./data" });

const fs = require("fs");
const path = require("path");

/** ---------- Tunables ---------- **/
/** Any of these in the title will make us skip the event (case-insensitive) */
const EXCLUDE_TITLE_KEYWORDS = [
  "projected",
  "tentative",
  "provisional",
  "estimate",
  "estimated",
];

/** ---------- Utilities ---------- **/

/** Safely read & parse JSON file, returns null on failure */
function readJsonFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""); // strip BOM
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[skip] Could not parse JSON: ${filePath} -> ${e.message}`);
    return null;
  }
}

/** Prefer ISO date fields; fall back to raw date; return epoch millis or null */
function parseDateSafe({ iso, raw, assumeUTC = true }) {
  if (iso && typeof iso === "string" && iso.trim()) {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return t;
  }
  if (raw && typeof raw === "string" && raw.trim()) {
    const s = raw.trim();
    if (/^\d{4}[-/]\d{2}[-/]\d{2}(?:\s.*)?$/.test(s) && assumeUTC) {
      const datePart = s.split(/\s+/)[0].replace(/\//g, "-");
      const t = Date.parse(`${datePart}T00:00:00Z`);
      if (!Number.isNaN(t)) return t;
    }
    const t2 = Date.parse(s);
    if (!Number.isNaN(t2)) return t2;
  }
  return null;
}

/** Case-insensitive contains */
function includesCI(haystack, needle) {
  return String(haystack || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

/** Get companyCode from JSON or fallback to filename (without .json) */
function getCompanyCodeFrom(json, fileName) {
  if (json && json.companyCode && String(json.companyCode).trim()) {
    return String(json.companyCode).trim();
  }
  return path.basename(fileName, ".json");
}

/** List JSON files in a directory */
function listJsonFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".json"))
    .map((d) => path.join(dir, d.name));
}

/** ---------- Core Extractors ---------- **/

/**
 * For a single company JSON, find the latest upcoming "Earnings Release" event,
 * EXCLUDING projected/tentative/etc titles.
 * Returns { companyCode, event, _ts } or null if none found.
 */
// Replace your extractLatestUpcomingEarningsRelease with this version
function extractLatestUpcomingEarningsRelease(json, fileName) {
  const companyCode = getCompanyCodeFrom(json, fileName);

  const events = json?.upcomingEvents?.events;
  if (!Array.isArray(events) || events.length === 0) return null;

  // Build candidates (Upcoming + contains "Earnings Release" + not projected/tentative)
  const candidates = events
    .filter(
      (ev) =>
        String(ev?.section).toLowerCase() === "upcoming" &&
        includesCI(ev?.title, "earnings release") &&
        !["estimated"]
          .some((kw) => includesCI(ev?.title, kw))
    )
    .map((ev) => {
      const ts = parseDateSafe({ iso: ev?.dateTimeISO, raw: ev?.dateTimeRaw });
      return { ev, ts };
    })
    .filter(({ ts }) => ts !== null);

  if (candidates.length === 0) return null;

  // Prefer the EARLIEST upcoming date >= now; if none are in the future, fall back to absolute earliest
  const now = Date.now();
  const future = candidates.filter(({ ts }) => ts >= now);
  const pool = future.length ? future : candidates;

  // Pick the nearest (min timestamp)
  pool.sort((a, b) => a.ts - b.ts);
  const { ev /*, ts*/ } = pool[0];

  return {
    companyCode,
    event: {
      section: ev.section ?? null,
      dateTimeRaw: ev.dateTimeRaw ?? null,
      dateTimeISO: ev.dateTimeISO ?? null,
      title: ev.title ?? null,
      icsUrl: ev.icsUrl ?? null,
    },
    // _ts is kept internal by callers
    _ts: parseDateSafe({ iso: ev?.dateTimeISO, raw: ev?.dateTimeRaw }),
  };
}


/**
 * For a single company JSON, find the latest past dividend.
 * Returns { companyCode, pastDividend, _ts } or null if none found.
 */
function extractLatestPastDividend(json, fileName) {
  const companyCode = getCompanyCodeFrom(json, fileName);

  const divs = json?.pastDividends?.dividends;
  if (!Array.isArray(divs) || divs.length === 0) return null;

  const candidates = divs
    .filter((d) => String(d?.section).toLowerCase().includes("dividend"))
    .map((d) => {
      const ts = parseDateSafe({ iso: d?.dateISO, raw: d?.dateRaw });
      return { d, ts };
    })
    .filter(({ ts }) => ts !== null);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.ts - a.ts);
  const { d, ts } = candidates[0];

  return {
    companyCode,
    pastDividend: {
      section: d.section ?? null,
      dateRaw: d.dateRaw ?? null,
      dateISO: d.dateISO ?? null,
      type: d.type ?? null,
      amount: d.amount ?? null,
      currency: d.currency ?? null,
      title: d.title ?? null,
    },
    _ts: ts,
  };
}

/** ---------- Public API ---------- **/

/**
 * Scan a directory and return an array:
 * [
 *   { companyCode, event: { section, dateTimeRaw, dateTimeISO, title, icsUrl } },
 *   ...
 * ]
 * Sorted by descending date (latest on top).
 */
function getLatestUpComingEarningReleaseEvent({ dir = "." } = {}) {
  const files = listJsonFiles(dir);
  const rows = [];

  for (const f of files) {
    const json = readJsonFileSafe(f);
    if (!json) continue;
    const row = extractLatestUpcomingEarningsRelease(json, f);
    if (row) rows.push(row);
  }

    rows.sort((a, b) => a._ts - b._ts); // nearest upcoming first

  // strip internal timestamp
  return rows.map(({ _ts, ...rest }) => rest);
}

/**
 * Scan a directory and return an array:
 * [
 *   { companyCode, pastDividend: { section, dateRaw, dateISO, type, amount, currency, title } },
 *   ...
 * ]
 * Sorted by descending date (latest on top).
 */
function getLatestLastDividend({ dir = "." } = {}) {
  const files = listJsonFiles(dir);
  const rows = [];

  for (const f of files) {
    const json = readJsonFileSafe(f);
    if (!json) continue;
    const row = extractLatestPastDividend(json, f);
    if (row) rows.push(row);
  }

  rows.sort((a, b) => b._ts - a._ts);

  // strip internal timestamp
  return rows.map(({ _ts, ...rest }) => rest);
}

module.exports = {
  getLatestUpComingEarningReleaseEvent,
  getLatestLastDividend,
};

/** ---------- CLI runner ---------- **/
if (require.main === module) {
  const dir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, "data", "info");

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const upcoming = getLatestUpComingEarningReleaseEvent({ dir });
  const dividends = getLatestLastDividend({ dir });

  // Pretty print to console
  console.log("Latest Upcoming Earnings Releases (latest date first):");
  console.log(JSON.stringify(upcoming, null, 2));
  console.log("\nLatest Past Dividends (latest date first):");
  console.log(JSON.stringify(dividends, null, 2));

  // ---- Save combined JSON to ./data/analyser/all_Info.json (relative to script) ----
  try {
    const outDir = path.resolve(__dirname, "data", "analyser"); // relative, not absolute
    fs.mkdirSync(outDir, { recursive: true });

    const outPath = path.join(outDir, "all_Info.json");
    const payload = {
      generatedAt: new Date().toISOString(),
      dirScanned: dir,
      counts: {
        companiesWithUpcoming: upcoming.length,
        companiesWithDividends: dividends.length,
      },
      upcoming,
      dividends,
    };

    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`\nSaved combined output -> ${outPath}`);
  } catch (err) {
    console.error("Failed to write ./data/analyser/all_Info.json:", err.message);
    process.exitCode = 2;
  }
}
