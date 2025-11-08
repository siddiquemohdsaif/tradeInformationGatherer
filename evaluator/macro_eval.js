// macro_eval.js
// Input: an array of quarterly rows like the one you pasted
// Output: JSON array with QoQ and YoY growth for Sales and EPS

const MONTH_MAP = { Mar: 3, Jun: 6, Sep: 9, Dec: 12 };

/** Parse "YYYY-Mmm" → { y, m, key } where key is "YYYY-Mmm" */
function parseQuarterLabel(label) {
  const [yStr, monStr] = label.split("-");
  const y = Number(yStr);
  const m = MONTH_MAP[monStr];
  if (!y || !m) throw new Error(`Bad Quarter label: ${label}`);
  return { y, m, key: `${yStr}-${monStr}` };
}

/** Sort quarters chronologically */
function sortByQuarter(a, b) {
  const A = parseQuarterLabel(a.Quarter);
  const B = parseQuarterLabel(b.Quarter);
  if (A.y !== B.y) return A.y - B.y;
  return A.m - B.m;
}

/** Compute percentage change safely */
function pctChange(curr, prev) {
  if (prev === 0 || prev == null || curr == null) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

/** Build a map from "YYYY-Mmm" to index for quick YoY lookup */
function indexByKey(rows) {
  const map = new Map();
  rows.forEach((r, idx) => map.set(parseQuarterLabel(r.Quarter).key, idx));
  return map;
}

/** Get the key for the same quarter a year earlier */
function yoyKey(label) {
  const { y, m } = parseQuarterLabel(label);
  const monStr = Object.keys(MONTH_MAP).find(k => MONTH_MAP[k] === m);
  return `${y - 1}-${monStr}`;
}

/**
 * Main: compute growth metrics.
 * Adds:
 *   sales_qoq_change, sales_qoq_pct, sales_yoy_change, sales_yoy_pct
 *   eps_qoq_change,   eps_qoq_pct,   eps_yoy_change,   eps_yoy_pct
 */
function computeQuarterlyGrowth(inputRows, smooth = false) {
  // Defensive clone & sort
  const rows = [...inputRows].sort(sortByQuarter);

  // Helpers
  const toNum = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
  const getSales = (r) =>
    toNum(
      // Prefer Sales; else Revenue.
      r.Sales ?? r.Revenue ??
      null
    );
  const getEps = (r) =>
    smooth
      ? toNum(r["EPS smooth in Rs"] ?? r.EPS)
      : toNum(r["EPS in Rs"] ?? r.EPS);

  const byKey = indexByKey(rows);

  const out = rows.map((row, i) => {
    const sales = getSales(row);
    const eps   = getEps(row);

    // QoQ (previous row)
    const prev = i > 0 ? rows[i - 1] : null;
    const prevSales = prev ? getSales(prev) : null;
    const prevEps   = prev ? getEps(prev)   : null;

    const sales_qoq_change = (prevSales != null && sales != null) ? (sales - prevSales) : null;
    const eps_qoq_change   = (prevEps   != null && eps   != null) ? (eps   - prevEps)   : null;

    const sales_qoq_pct = (prevSales != null && sales != null) ? pctChange(sales, prevSales) : null;
    const eps_qoq_pct   = (prevEps   != null && eps   != null) ? pctChange(eps,   prevEps)   : null;

    // YoY (same quarter last year)
    const prevYearKey = yoyKey(row.Quarter);
    const yoyIdx = byKey.get(prevYearKey);
    const yoyRow = (yoyIdx != null) ? rows[yoyIdx] : null;

    const yoySales = yoyRow ? getSales(yoyRow) : null;
    const yoyEps   = yoyRow ? getEps(yoyRow)   : null;

    const sales_yoy_change = (yoySales != null && sales != null) ? (sales - yoySales) : null;
    const eps_yoy_change   = (yoyEps   != null && eps   != null) ? (eps   - yoyEps)   : null;

    const sales_yoy_pct = (yoySales != null && sales != null) ? pctChange(sales, yoySales) : null;
    const eps_yoy_pct   = (yoyEps   != null && eps   != null) ? pctChange(eps,   yoyEps)   : null;

    return {
      Quarter: row.Quarter,
      Sales: sales,           // <- now uses Sales, or falls back to Revenue
      EPS: eps,               // <- respects smoothing consistently

      sales_qoq_change,
      sales_qoq_pct,
      sales_yoy_change,
      sales_yoy_pct,

      eps_qoq_change,
      eps_qoq_pct,
      eps_yoy_change,
      eps_yoy_pct,
    };
  });

  return out;
}

// ---------- Example usage ----------
// Paste your array into `data` and run `node macro_eval.js`
if (require.main === module) {
  const data = [ { "Quarter": "2020-Mar", "Sales": 18587, "Expenses": 13729, "Operating Profit": 4858, "OPM %": 26, "Other Income": 147, "Interest": 124, "Depreciation": 996, "Profit before tax": 3885, "Tax %": 18, "Net Profit": 3172, "EPS in Rs": 11.67 }, { "Quarter": "2020-Jun", "Sales": 17842, "Expenses": 13085, "Operating Profit": 4757, "OPM %": 27, "Other Income": 295, "Interest": 125, "Depreciation": 1065, "Profit before tax": 3862, "Tax %": 24, "Net Profit": 2935, "EPS in Rs": 10.8 }, { "Quarter": "2020-Sep", "Sales": 18594, "Expenses": 13476, "Operating Profit": 5118, "OPM %": 28, "Other Income": 199, "Interest": 80, "Depreciation": 1092, "Profit before tax": 4145, "Tax %": 24, "Net Profit": 3146, "EPS in Rs": 11.58 }, { "Quarter": "2020-Dec", "Sales": 19302, "Expenses": 13678, "Operating Profit": 5624, "OPM %": 29, "Other Income": 189, "Interest": 147, "Depreciation": 1187, "Profit before tax": 4479, "Tax %": 11, "Net Profit": 3977, "EPS in Rs": 14.63 }, { "Quarter": "2021-Mar", "Sales": 19641, "Expenses": 15092, "Operating Profit": 4549, "OPM %": 23, "Other Income": 244, "Interest": 159, "Depreciation": 1267, "Profit before tax": 3367, "Tax %": 67, "Net Profit": 1111, "EPS in Rs": 4.06 }, { "Quarter": "2021-Jun", "Sales": 20068, "Expenses": 15006, "Operating Profit": 5062, "OPM %": 25, "Other Income": 255, "Interest": 89, "Depreciation": 1128, "Profit before tax": 4100, "Tax %": 22, "Net Profit": 3213, "EPS in Rs": 11.81 }, { "Quarter": "2021-Sep", "Sales": 20655, "Expenses": 15633, "Operating Profit": 5022, "OPM %": 24, "Other Income": 240, "Interest": 83, "Depreciation": 1078, "Profit before tax": 4101, "Tax %": 20, "Net Profit": 3263, "EPS in Rs": 12.01 }, { "Quarter": "2021-Dec", "Sales": 22331, "Expenses": 16938, "Operating Profit": 5393, "OPM %": 24, "Other Income": 255, "Interest": 82, "Depreciation": 1136, "Profit before tax": 4430, "Tax %": 22, "Net Profit": 3448, "EPS in Rs": 12.69 }, { "Quarter": "2022-Mar", "Sales": 22597, "Expenses": 17545, "Operating Profit": 5052, "OPM %": 22, "Other Income": 317, "Interest": 65, "Depreciation": 984, "Profit before tax": 4320, "Tax %": 17, "Net Profit": 3599, "EPS in Rs": 13.27 }, { "Quarter": "2022-Jun", "Sales": 23464, "Expenses": 18489, "Operating Profit": 4975, "OPM %": 21, "Other Income": 409, "Interest": 64, "Depreciation": 983, "Profit before tax": 4337, "Tax %": 24, "Net Profit": 3281, "EPS in Rs": 12.13 }, { "Quarter": "2022-Sep", "Sales": 24686, "Expenses": 19261, "Operating Profit": 5425, "OPM %": 22, "Other Income": 236, "Interest": 79, "Depreciation": 998, "Profit before tax": 4584, "Tax %": 24, "Net Profit": 3487, "EPS in Rs": 12.89 }, { "Quarter": "2022-Dec", "Sales": 26700, "Expenses": 20335, "Operating Profit": 6365, "OPM %": 24, "Other Income": 260, "Interest": 116, "Depreciation": 1137, "Profit before tax": 5372, "Tax %": 24, "Net Profit": 4096, "EPS in Rs": 15.13 }, { "Quarter": "2023-Mar", "Sales": 26606, "Expenses": 20743, "Operating Profit": 5863, "OPM %": 22, "Other Income": 453, "Interest": 94, "Depreciation": 1027, "Profit before tax": 5195, "Tax %": 23, "Net Profit": 3981, "EPS in Rs": 14.71 }, { "Quarter": "2023-Jun", "Sales": 26296, "Expenses": 20931, "Operating Profit": 5365, "OPM %": 20, "Other Income": 344, "Interest": 86, "Depreciation": 927, "Profit before tax": 4696, "Tax %": 25, "Net Profit": 3531, "EPS in Rs": 13.05 }, { "Quarter": "2023-Sep", "Sales": 26672, "Expenses": 20743, "Operating Profit": 5929, "OPM %": 22, "Other Income": 365, "Interest": 156, "Depreciation": 1010, "Profit before tax": 5128, "Tax %": 25, "Net Profit": 3833, "EPS in Rs": 14.15 }, { "Quarter": "2023-Dec", "Sales": 28446, "Expenses": 21659, "Operating Profit": 6787, "OPM %": 24, "Other Income": 370, "Interest": 140, "Depreciation": 1143, "Profit before tax": 5874, "Tax %": 26, "Net Profit": 4351, "EPS in Rs": 16.06 }, { "Quarter": "2024-Mar", "Sales": 28499, "Expenses": 22382, "Operating Profit": 6117, "OPM %": 21, "Other Income": 416, "Interest": 171, "Depreciation": 1093, "Profit before tax": 5269, "Tax %": 24, "Net Profit": 3995, "EPS in Rs": 14.72 }, { "Quarter": "2024-Jun", "Sales": 28057, "Expenses": 22264, "Operating Profit": 5793, "OPM %": 21, "Other Income": 1103, "Interest": 191, "Depreciation": 998, "Profit before tax": 5707, "Tax %": 25, "Net Profit": 4259, "EPS in Rs": 15.7 }, { "Quarter": "2024-Sep", "Sales": 28862, "Expenses": 22493, "Operating Profit": 6369, "OPM %": 22, "Other Income": 456, "Interest": 131, "Depreciation": 1007, "Profit before tax": 5687, "Tax %": 25, "Net Profit": 4237, "EPS in Rs": 15.62 }, { "Quarter": "2024-Dec", "Sales": 29890, "Expenses": 23030, "Operating Profit": 6860, "OPM %": 23, "Other Income": 477, "Interest": 166, "Depreciation": 1039, "Profit before tax": 6132, "Tax %": 25, "Net Profit": 4594, "EPS in Rs": 16.94 }, { "Quarter": "2025-Mar", "Sales": 30246, "Expenses": 23764, "Operating Profit": 6482, "OPM %": 21, "Other Income": 449, "Interest": 156, "Depreciation": 1040, "Profit before tax": 5735, "Tax %": 25, "Net Profit": 4309, "EPS in Rs": 15.9 }, { "Quarter": "2025-Jun", "Sales": 30349, "Expenses": 24314, "Operating Profit": 6035, "OPM %": 20, "Other Income": 456, "Interest": 209, "Depreciation": 1093, "Profit before tax": 5189, "Tax %": 26, "Net Profit": 3844, "EPS in Rs": 14.18 }, { "Quarter": "2025-Sep", "Sales": 31942, "Expenses": 25397, "Operating Profit": 6545, "OPM %": 20, "Other Income": 415, "Interest": 215, "Depreciation": 1043, "Profit before tax": 5702, "Tax %": 26, "Net Profit": 4236, "EPS in Rs": 15.63 } ];

  // If you prefer reading from a file:
  // const fs = require('fs');
  // const data = JSON.parse(fs.readFileSync('./quarters.json', 'utf8'));

  const result = computeQuarterlyGrowth(data);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { computeQuarterlyGrowth };
