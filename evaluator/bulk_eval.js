// bulk_eval.js
// Run evaluator pipeline in bulk for a list of NSE symbols.
//
// Example:
//   node bulk_eval.js "2019 Mar" "2025 Sep" c --concurrency=3
//
// Notes:
// - BSE companyCode is derived from companies_info.json via companyInfoParser.js
// - Each run saves to: data/analyser/performance/[NSE].json (done inside runPipeline)
// - Prints a final JSON summary to STDOUT; progress logs go to STDERR.

"use strict";

const path = require("path");
const os = require("os");

const { runPipeline } = require("./evaluator_manager");
const companyInfo = require("./companyInfoParser");

// --------- Configurable symbol list (from your message) ----------
const NSE_SYMBOLS = [
  "RELIANCE","TCS","HDFCBANK","BHARTIARTL","ICICIBANK","INFY","SBIN","HINDUNILVR","ITC",
  "LICI","BAJFINANCE","LT","HCLTECH","SUNPHARMA","MARUTI","M&M","KOTAKBANK","WIPRO",
  "ULTRACEMCO","ONGC","AXISBANK","NTPC","TITAN","BAJAJFINSV","ADANIENT","POWERGRID"
  ,"HAL","DMART","BAJAJ-AUTO","ADANIPORTS","COALINDIA","JSWSTEEL","ASIANPAINT",
  "NESTLEIND","BEL","ETERNAL","TRENT","SIEMENS","HINDZINC","VBL","ADANIPOWER","DLF",
  "IOC","LTIM","VEDL","INDIGO","TATASTEEL","GRASIM","DIVISLAB","ADANIGREEN","JIOFIN",
  "EICHERMOT","SBILIFE","TECHM","PIDILITIND","PFC"
];

// const NSE_SYMBOLS = [
//   "HINDALCO", "OIL", "IDBI", "INDUSTOWER", "GAIL", "FEDERALBNK", "IOB",
//   "SHRIRAMFIN", "DRREDDY", "BAJAJHLDNG", "ZYDUSLIFE", "AUROPHARMA", "LUPIN",
//   "SAIL", "MUTHOOTFIN", "TORNTPOWER", "JSL", "HEROMOTOCO", "CIPLA", "IRFC",
//   "AMBUJACEM", "SUZLON", "YESBANK", "NHPC", "ABCAPITAL", "ASHOKLEY", "UPL",
//   "OBEROIRLTY", "MOTILALOFS", "COROMANDEL", "ALKEM", "AUBANK", "TATAPOWER",
//   "MPHASIS", "JINDALSTEL", "CHOLAFIN", "TECHM", "MOTHERSON", "ICICIGI", "LTIM",
//   "LODHA", "PIIND", "MRF", "EICHERMOT", "GLENMARK", "ABBOTINDIA", "GODREJPROP",
//   "SBICARD", "GRASIM", "IRCTC", "PATANJALI", "COLPAL", "JSWENERGY", "POLYCAB",
//   "BOSCHLTD", "IDFCFIRSTB", "DLF", "DABUR", "TATACOMM", "CUMMINSIND", "VBL",
//   "MANKIND", "ADANIENSOL", "SRF", "COFORGE", "MARICO", "KALYANKJIL", "SHREECEM",
//   "BERGEPAINT", "PHOENIXLTD", "PERSISTENT", "SCHAEFFLER", "ABB", "INDHOTEL",
//   "TORNTPHARM", "UNITDSPR", "BRITANNIA", "BHARATFORG", "GODREJCP", "HAVELLS",
//   "SIEMENS", "BSE", "TVSMOTOR", "APOLLOHOSP", "PIDILITIND", "UNOMINDA",
//   "ICICIPRULI"
// ];

// --------- CLI args ----------
const [, , argFrom, argTo, argType = "c", ...rest] = process.argv;

if (!argFrom || !argTo) {
  const script = path.basename(process.argv[1]);
  console.error(
    `Usage: node ${script} "<from>" "<to>" <type>\n` +
    `  <type>: c (consolidated) | s (standalone)\n` +
    `Examples:\n` +
    `  node ${script} "2019 Mar" "2025 Sep" c\n` +
    `  node ${script} "2019 Mar" "2025 Sep" s --concurrency=4\n`
  );
  process.exit(1);
}

let concurrency = 3; // sensible default
let companiesPathOverride = null;

for (const tok of rest) {
  if (tok.startsWith("--concurrency=")) {
    const n = parseInt(tok.split("=")[1], 10);
    if (!Number.isNaN(n) && n > 0) concurrency = n;
  } else if (tok.startsWith("--companies=")) {
    companiesPathOverride = tok.split("=")[1];
  }
}

// If the user overrides companies_info.json, apply it.
if (companiesPathOverride) {
  companyInfo.setDataPath(companiesPathOverride);
  try {
    companyInfo.reload();
    console.error(`[bulk_eval] Loaded companies from: ${companiesPathOverride}`);
  } catch (e) {
    console.error(`[bulk_eval] Failed to load companies from override: ${companiesPathOverride} :: ${e?.message || e}`);
    process.exit(2);
  }
}

// --------- Small pool runner for controlled concurrency ----------
async function runPool(items, limit, worker) {
  const results = [];
  let idx = 0;
  let active = 0;

  return new Promise((resolve) => {
    const kick = () => {
      while (active < limit && idx < items.length) {
        const myIndex = idx++;
        const item = items[myIndex];
        active++;
        Promise.resolve(worker(item))
          .then((res) => {
            results[myIndex] = { ok: true, value: res };
          })
          .catch((err) => {
            results[myIndex] = { ok: false, error: err?.message || String(err) };
          })
          .finally(() => {
            active--;
            if (results.length === items.length && !results.includes(undefined)) {
              resolve(results);
            } else {
              kick();
            }
          });
      }
    };
    kick();
  });
}

// --------- Worker for one NSE symbol ----------
async function evalOneSymbol(nseSymbol, from, to, type) {
  // Resolve BSE company code
  const bseCode = companyInfo.getBseCompanyCodeFromNse(nseSymbol);

  if (!bseCode) {
    throw new Error(`BSE code not found for NSE symbol: ${nseSymbol}`);
  }

  // Log progress to STDERR to keep STDOUT clean (final JSON only)
  console.error(`[bulk_eval] ${nseSymbol} -> BSE ${bseCode} :: from="${from}" to="${to}" type=${type}`);

  // Run the pipeline (saves per-symbol JSON internally)
  const out = await runPipeline({ companyCode: bseCode, from, to, type });

  // Expected output file path (for summary only)
  const savedPath = path.join(__dirname, "evaluator", "..", "data", "analyser", "performance", `${nseSymbol}.json`);

  return {
    nseSymbol,
    bseCode,
    expectedFile: savedPath,
    rows: Array.isArray(out) ? out.length : undefined
  };
}

// --------- Main ----------
(async () => {
  const cpu = Math.max(1, Math.min(concurrency, os.cpus()?.length || concurrency));
  console.error(`[bulk_eval] Starting ${NSE_SYMBOLS.length} symbols with concurrency=${cpu}`);

  const results = await runPool(
    NSE_SYMBOLS,
    cpu,
    (sym) => evalOneSymbol(sym, argFrom, argTo, argType)
  );

  // Build a compact summary
  const summary = {
    params: { from: argFrom, to: argTo, type: argType, concurrency: cpu },
    ok: [],
    failed: []
  };

  for (let i = 0; i < NSE_SYMBOLS.length; i++) {
    const sym = NSE_SYMBOLS[i];
    const r = results[i];
    if (r && r.ok) {
      summary.ok.push(r.value);
    } else {
      summary.failed.push({
        nseSymbol: sym,
        error: r?.error || "Unknown error"
      });
    }
  }

  // Final JSON summary to STDOUT
  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed.length > 0) {
    console.error(`[bulk_eval] Completed with ${summary.failed.length} failures.`);
    process.exitCode = 3;
  } else {
    console.error(`[bulk_eval] Completed successfully.`);
  }
})();
