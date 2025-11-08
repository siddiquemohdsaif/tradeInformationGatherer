// bse_quarterly_results_parser.js

/**
 * BSE Quarterly Results Parser → Screener-style rows
 * Input: BSE JSON (values in ₹ million)
 * Output: One row per quarter with Screener-like columns (₹ crore by default)
 *
 * Columns:
 *   Quarter, Sales, Expenses, Operating Profit, OPM %, Other Income,
 *   Interest, Depreciation, Profit before tax, Tax %, Net Profit, EPS in Rs
 */

/////////////////////////////
// Utilities
/////////////////////////////

const LABELS = {
  SALES: [
    "Net Sales",
    "Revenue from operations",
    "Sales"
  ],
  OTHER_INCOME: [
    "Other Income"
  ],
  FINANCE_COSTS: [
    "Finance Costs",
    "Finance cost",
    "Finance charges",
    "Interest and finance charges",
  ],
  DEPRECIATION: [
    "Depreciation and amortisation expense",
    "Depreciation",
  ],
  PBT: [
    "Profit (+)/ Loss (-) from Ordinary Activities before Tax",
    "Profit before exceptional items and tax",
    "Profit before tax",
    "Profit/(loss) before tax",
  ],
  TAX_TOTAL: [
    "Tax",
    "Total tax expense",
    "Tax expense",
    "Provision for tax",
  ],
  TAX_CURRENT: [
    "Current tax",
  ],
  TAX_DEFERRED: [
    "Deferred tax",
  ],
  NET_PROFIT: [
    "Net Profit",
    "Net Profit (+)/ Loss (-) from Ordinary Activities after Tax",
    "Profit for the period",
    "Profit/(loss) for the period",
    "Net Profit after Mino Inter & Share of P & L",
    "Income Attributable to Consolidated Group",
  ],
  EPS_BAS: [
    "Basic EPS for continuing operation",
    "Basic EPS (in Rs.)",
    "Basic EPS",
    "EPS after Extraordinary items (in Rs)"
  ],
  EPS_DIL: [
    "Diluted EPS for continuing operation",
    "Diluted EPS (in Rs.)",
    "Diluted EPS"
  ],
};

function parseNumberLoose(v, fallback = 0) {
  if (v == null) return fallback;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v).match(/[+-]?\d[\d,]*\.?\d*/);
  if (!m) return fallback;
  const num = parseFloat(m[0].replace(/,/g, ""));
  return Number.isFinite(num) ? num : fallback;
}

/** Returns numeric value for first matching label (exact → contains) */
function getValueByLabels(rows, labels) {
  // exact match pass
  for (const l of labels) {
    const hit = rows.find(r => (r.label || "").trim().toLowerCase() === l.toLowerCase());
    if (hit) return hit.valueNumber ?? parseNumberLoose(hit.valueRaw, 0);
  }
  // loose contains pass
  for (const l of labels) {
    const hit = rows.find(r => (r.label || "").toLowerCase().includes(l.toLowerCase()));
    if (hit) return hit.valueNumber ?? parseNumberLoose(hit.valueRaw, 0);
  }
  return 0;
}

/** Coerce negatives used by BSE presentation into positive “expense” magnitudes */
function absVal(x) { return Math.abs(x || 0); }
function millionToCrore(m) { return m / 10; }
function rnd(x) { return Math.round(x); }

function buildScreenerRow(quarterLabel, r) {
  return {
    Quarter: quarterLabel,
    Sales: rnd(r.salesU),
    Expenses: rnd(r.expensesU),
    "Operating Profit": rnd(r.opU),
    "OPM %": rnd(r.opmPct),
    "Other Income": rnd(r.otherIncomeU),
    Interest: rnd(r.interestU),
    Depreciation: rnd(r.depreciationU),
    "Profit before tax": rnd(r.pbtU),
    "Tax %": rnd(r.taxPct),
    "Net Profit": rnd(r.netProfitU),
    "EPS in Rs": +r.eps.toFixed(2),
  };
}

function toTSV(rows) {
  const headers = [
    "Quarter","Sales","Expenses","Operating Profit","OPM %","Other Income",
    "Interest","Depreciation","Profit before tax","Tax %","Net Profit","EPS in Rs"
  ];
  const lines = [headers.join("\t")];
  for (const r of rows) {
    lines.push(headers.map(h => r[h]).join("\t"));
  }
  return lines.join("\n");
}

function toCSV(rows) {
  const headers = [
    "Quarter","Sales","Expenses","Operating Profit","OPM %","Other Income",
    "Interest","Depreciation","Profit before tax","Tax %","Net Profit","EPS in Rs"
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map(h => r[h]).join(","));
  }
  return lines.join("\n");
}

function toJSON(rows, pretty = true) {
  return JSON.stringify(rows, null, pretty ? 2 : 0);
}

function quarterLabelFromItem(item) {
  if (item.quarter) return item.quarter; // e.g., "2025-Jun"
  const end = item?.meta?.dateEnd || "";
  const m = end.match(/(\d{1,2})-(\w{3})-(\d{2,4})/);
  if (m) {
    const mon = m[2];
    const yy = m[3].length === 2 ? ("20" + m[3]) : m[3];
    return `${yy}-${mon}`;
  }
  return "Unknown";
}


// ----- Smooth EPS helpers (rolling 5 logic) -----
function _median(nums) {
  const a = nums.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function _mean(nums) {
  const a = nums.filter(Number.isFinite);
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

/** For index i in [0..n-1], return [start, end] for a x-quarter window.
 *  Prefers past 4 + current; if not enough past, pull future to make x.
 */
function _rollingWindowBounds(i, n, win) {
  if (n <= 0) return [0, -1];
  if (win <= 1) return [i, i];

  // If we have at least 4 past quarters, use [i-4..i]
  if (i >= win - 1) return [i - (win - 1), i];

  // Otherwise, start at 0 and extend into the future as needed
  const end = Math.min(n - 1, win - 1);
  return [0, end];
}

/**
 * rows: array returned by parseStockConsolidated(...).rows
 * totalShares: absolute share count (e.g., 12515990453)
 * Returns { rowsWithSmooth, inputs }
 *
 * NEW: Rolling window (size 5). For each row i:
 *  - Window = past 4 + current; if not enough past, include future to make 5.
 *  - Medians/avgTax computed over window's rows (not the whole series).
 */
function computeSmoothEPS(rows, totalShares) {
  if (!Array.isArray(rows) || !rows.length) {
    return { rowsWithSmooth: [], inputs: { reason: 'no-rows', totalShares } };
  }

  const CRORE_TO_RS = 1e7;
  const n = rows.length;

  const rowsWithSmooth = [];
  const perRowStats = [];

  for (let i = 0; i < n; i++) {
    const [start, end] = _rollingWindowBounds(i, n, 6);
    const win = rows.slice(start, end + 1);

    const otherIncomeSeries = win.map(r => Number(r['Other Income']));
    const depSeries         = win.map(r => Number(r['Depreciation']));
    const intSeries         = win.map(r => Number(r['Interest']));
    const taxPctSeries      = win.map(r => Number(r['Tax %']));

    const medOtherIncome = _median(otherIncomeSeries);
    const medDep         = _median(depSeries);
    const medInt         = _median(intSeries);
    const avgTaxPct      = _mean(taxPctSeries);

    const taxMultiplier = 1 - ((Number(avgTaxPct) || 0) / 100);

    const op = Number(rows[i]['Operating Profit']);
    const earningCrore = (Number.isFinite(op) ? op : 0)
                       + (Number.isFinite(medOtherIncome) ? medOtherIncome : 0)
                       - (Number.isFinite(medDep) ? medDep : 0)
                       - (Number.isFinite(medInt) ? medInt : 0);

    const earningAfterTaxRs = earningCrore * CRORE_TO_RS * taxMultiplier;
    const epsSmooth = (totalShares && totalShares > 0)
      ? (earningAfterTaxRs / totalShares)
      : null;

    rowsWithSmooth.push({
      ...rows[i],
      'EPS smooth in Rs': epsSmooth == null ? null : Number(epsSmooth.toFixed(2)),
    });

    perRowStats.push({
      index: i,
      quarter: rows[i]?.Quarter ?? null,
      windowStartIndex: start,
      windowEndIndex: end,
      windowSize: end >= start ? (end - start + 1) : 0,
      medianOtherIncome: Number.isFinite(medOtherIncome) ? medOtherIncome : 0,
      medianDepreciation: Number.isFinite(medDep) ? medDep : 0,
      medianInterest: Number.isFinite(medInt) ? medInt : 0,
      avgTaxPercent: Number.isFinite(avgTaxPct) ? Number(avgTaxPct.toFixed(2)) : 0,
    });
  }

  return {
    rowsWithSmooth,
    inputs: {
      mode: 'rolling6',
      totalShares: totalShares || null,
      perRow: perRowStats,
    },
  };
}

/**
 * Async convenience:
 * - Parses consolidated rows (₹ crore by default)
 * - Resolves outstanding shares if not provided (BSE code -> NSE -> MarketScreener -> shares)
 * - Computes and attaches "EPS smooth in Rs"
 *
 * @param {object} inputJson BSE fetcher JSON { companyCode, results: [...] }
 * @param {object} opts
 *   - unit: 'crore'|'million' (default 'crore')
 *   - totalShares?: number (absolute)
 *   - autoResolveShares?: boolean (default true)
 *   - companyInfoModulePath?: string (default '../evaluator/companyInfoParser')
 *   - sharesFetcherModulePath?: string (default '../getLatestOutstandingShare')
 *
 * @returns {
 *   meta, rows, rowsWithSmooth, smoothInputs,
 *   toTSV, toCSV, toJSON
 * }
 */
async function parseStockConsolidatedWithSmooth(inputJson, opts = {}) {
  const {
    unit = 'crore',
    totalShares,
    autoResolveShares = true,
    companyInfoModulePath = '../evaluator/companyInfoParser',
    sharesFetcherModulePath = '../getLatestOutstandingShare',
  } = opts;

  // 1) Base parse
  const parsed = parseStockConsolidated(inputJson, { unit });
  const rows = parsed.rows;

  // 2) Resolve shares if needed
  let sharesToUse = totalShares || null;
  let shareSource = { source: null, nseSymbol: null, marketScreenerCode: null, error: null };

  if (!sharesToUse && autoResolveShares && inputJson?.companyCode) {
    try {
      // Lazy require (keeps this file usable stand-alone if user doesn’t need smooth)
      const companyInfo = require(companyInfoModulePath);
      const { getNseSymbolFromBseCompanyCode, getMarketScreenerFromNse } = companyInfo;
      const { getLatestOutstandingShare } = require(sharesFetcherModulePath);

      const nse = getNseSymbolFromBseCompanyCode(String(inputJson.companyCode));
      const ms  = nse ? getMarketScreenerFromNse(nse) : null;
      const fetchedShares = ms ? await getLatestOutstandingShare(ms) : null;

      sharesToUse = fetchedShares || null;
      shareSource = {
        source: 'marketscreener',
        nseSymbol: nse || null,
        marketScreenerCode: ms || null,
        error: null,
      };
    } catch (e) {
      shareSource = {
        source: 'resolve-error',
        nseSymbol: null,
        marketScreenerCode: null,
        error: String(e?.message || e),
      };
    }
  }

  // 3) Compute smooth EPS
  const { rowsWithSmooth, inputs } = computeSmoothEPS(rows, sharesToUse);

  // 4) Return same API as base + extras
  return {
    meta: {
      ...parsed.meta,
      shareSource,
    },
    rows,
    rowsWithSmooth,
    smoothInputs: inputs,
    toTSV: () => toTSV(rowsWithSmooth),
    toCSV: () => toCSV(rowsWithSmooth),
    toJSON: (pretty = true) => toJSON(rowsWithSmooth, pretty),
  };
}


/////////////////////////////
// 1) Consolidated Parser
/////////////////////////////

/**
 * Parse a BSE "stock consolidated" JSON into Screener-style rows.
 * @param {object} inputJson { results: [...] } with values in ₹ million
 * @param {object} opts      { unit: 'crore' | 'million' }  default 'crore'
 * @returns { meta, rows, toTSV, toCSV, toJSON }
 */
function parseStockConsolidated(inputJson, opts = {}) {
  const unitOut = (opts.unit || "crore").toLowerCase(); // 'crore' | 'million'
  const results = Array.isArray(inputJson?.results) ? inputJson.results : [];
  const outRows = [];

  for (const item of results) {
    const rows = Array.isArray(item.rows) ? item.rows : [];

    // Raw (₹ million) from BSE
    const salesM         = getValueByLabels(rows, LABELS.SALES);
    const otherIncomeM   = getValueByLabels(rows, LABELS.OTHER_INCOME);
    const interestM      = absVal(getValueByLabels(rows, LABELS.FINANCE_COSTS));
    const depreciationM  = absVal(getValueByLabels(rows, LABELS.DEPRECIATION));
    const pbtM           = getValueByLabels(rows, LABELS.PBT);

    // Tax: prefer single “Tax” line; else sum current+deferred
    let taxM = getValueByLabels(rows, LABELS.TAX_TOTAL);
    if (!taxM) {
      const cur = getValueByLabels(rows, LABELS.TAX_CURRENT);
      const def = getValueByLabels(rows, LABELS.TAX_DEFERRED);
      taxM = (cur || 0) + (def || 0);
    }
    taxM = absVal(taxM);

    // Net profit
    const netProfitM     = getValueByLabels(rows, LABELS.NET_PROFIT);

    // Expenses derived (₹ million)
    // Screener “Expenses” = Sales + OtherIncome − Interest − Depreciation − PBT
    const expensesM = (salesM || 0) + (otherIncomeM || 0) - (interestM || 0) - (depreciationM || 0) - (pbtM || 0);

    // Unit conversion
    const conv = unitOut === "crore" ? millionToCrore : (x) => x;
    const salesU        = conv(salesM);
    const expensesU     = conv(expensesM);
    const otherIncomeU  = conv(otherIncomeM);
    const interestU     = conv(interestM);
    const depreciationU = conv(depreciationM);
    const pbtU          = conv(pbtM);
    const netProfitU    = conv(netProfitM);

    // Operating Profit & OPM%
    const opU = (salesU - expensesU);
    const opmPct = salesU !== 0 ? ((opU) / salesU) * 100 : 0;

    // Tax %
    const taxPct = pbtU > 0 ? (conv(taxM) / pbtU) * 100 : 0;

    // EPS (choose best available)
    let eps = getValueByLabels(rows, LABELS.EPS_BAS);
    if (!eps) eps = getValueByLabels(rows, LABELS.EPS_DIL);
    eps = typeof eps === "number" && Number.isFinite(eps) ? eps : 0;

    const qLabel = quarterLabelFromItem(item);

    outRows.push(
      buildScreenerRow(qLabel, {
        salesU, expensesU, otherIncomeU, interestU, depreciationU,
        pbtU, opU, opmPct, taxPct, netProfitU, eps
      })
    );
  }

  return {
    meta: {
      companyCode: inputJson?.companyCode || "",
      rType: inputJson?.rType || "c",
      from: inputJson?.from || "",
      to: inputJson?.to || "",
      fetchedAt: inputJson?.fetchedAt,
      unitOut: unitOut === "crore" ? "crore" : "million",
    },
    rows: outRows,
    toTSV: () => toTSV(outRows),
    toCSV: () => toCSV(outRows),
    toJSON: (pretty = true) => toJSON(outRows, pretty),
  };
}

/////////////////////////////
// 2) Standalone / Bank (stub)
/////////////////////////////

function parseStockStandalone(/* inputJson, opts */) {
  throw new Error("parseStockStandalone() not implemented yet.");
}

/////////////////////////////
// 3) Optional: Save helpers
/////////////////////////////

async function saveToFile(path, dataStr) {
  const fs = await import('node:fs/promises');
  await fs.writeFile(path, dataStr, 'utf8');
}

/**
 * Export helper
 * @param {'csv'|'tsv'|'json'} format
 * @param {ReturnType<typeof parseStockConsolidated>} parsed
 * @param {string=} outPath optional file path; if omitted, returns the string
 */
async function exportParsed(format, parsed, outPath) {
  let str;
  if (format === 'csv') str = parsed.toCSV();
  else if (format === 'tsv') str = parsed.toTSV();
  else if (format === 'json') str = parsed.toJSON(true);
  else throw new Error(`Unknown format: ${format}`);

  if (outPath) {
    await saveToFile(outPath, str);
    return { written: outPath, bytes: Buffer.byteLength(str, 'utf8') };
  }
  return str;
}

/////////////////////////////
// Exports
/////////////////////////////

module.exports = {
  parseStockConsolidated,
  parseStockConsolidatedWithSmooth,
  parseStockStandalone,
  exportParsed,
  toCSV,
  toTSV,
  toJSON,
};

/////////////////////////////
// CLI (optional)
// Usage:
//   node bse_quarterly_results_parser.js input.json csv > out.csv
//   node bse_quarterly_results_parser.js input.json json out.json
/////////////////////////////

if (require.main === module) {
  (async () => {
    try {
      const [, , inputPath, format = 'csv', outPath] = process.argv;
      if (!inputPath) {
        console.error("Usage: node bse_quarterly_results_parser.js <input.json> [csv|tsv|json] [outPath]");
        process.exit(1);
      }
      const fs = await import('node:fs/promises');
      const raw = await fs.readFile(inputPath, 'utf8');
      const json = JSON.parse(raw);
      const parsed = parseStockConsolidated(json, { unit: 'crore' });
      const out = await exportParsed(format, parsed, outPath);
      if (typeof out === 'string') process.stdout.write(out + "\n");
      else console.log(`Written ${out.written} (${out.bytes} bytes)`);
    } catch (e) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  })();
}
