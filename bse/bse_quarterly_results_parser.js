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
