// result_parsers/utils.js

// ===== Label maps (shared) =====
const LABELS = {
  SALES: [
    "Net Sales",
    "Revenue from operations",
    "Sales",
  ],
  OTHER_INCOME: [
    "Other Income",
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
    "EPS after Extraordinary items (in Rs)",
    "Basic EPS after Extraordinary items",
    "Basic EPS before Extraordinary items",
  ],
  EPS_DIL: [
    "Diluted EPS for continuing operation",
    "Diluted EPS (in Rs.)",
    "Diluted EPS",
    "Diluted EPS after Extraordinary items",
    "Diluted EPS before Extraordinary items",
  ],
};

const BANK_LABELS = {
  REVENUE: [
    "Interest Earned/Net Income from sales/services",
    "Interest Earned",
    "Total interest earned",
    "Net Income from sales/services",
  ],
  INTEREST_EXPENDED: [
    "Interest Expended",
    "Interest expended",
  ],
  OPERATING_EXPENSES: [
    "Operating Expenses",
  ],
  EMPLOYEE_COST: [
    "Employee Cost",
    "Employee benefit expense",
  ],
  OTHER_OPERATING: [
    "Other operating expenses",
    "Other Expenses",
  ],
  PROVISIONS: [
    "Provisions (other than tax) and Contingencies",
    "Provisions and contingencies",
  ],
  DEPRECIATION: [
    "Depreciation",
    "Depreciation and amortisation expense",
  ],
    GROSS_NPA_PCT: [
    "% of Gross NPAs", "Gross NPA %", "Gross NPA percentage",
  ],
  NET_NPA_PCT: [
    "% of Net NPAs", "Net NPA %", "Net NPA percentage",
  ],
};


// ADD a quarter sorter helper at bottom (export it)
const MON_IDX = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
function sortQuarterLabels(qs) {
  return (qs || []).slice().sort((a, b) => {
    // expects "YYYY-Mmm" like "2025-Jun"
    const ma = a.match(/^(\d{4})-(\w{3})$/), mb = b.match(/^(\d{4})-(\w{3})$/);
    if (!ma || !mb) return a.localeCompare(b);
    const ya = +ma[1], yb = +mb[1];
    if (ya !== yb) return ya - yb;
    return (MON_IDX[ma[2]] ?? 0) - (MON_IDX[mb[2]] ?? 0);
  });
}


// ===== Common helpers =====
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
  // exact
  for (const l of labels) {
    const hit = rows.find(r => (r.label || "").trim().toLowerCase() === l.toLowerCase());
    if (hit) return hit.valueNumber ?? parseNumberLoose(hit.valueRaw, 0);
  }
  // contains
  for (const l of labels) {
    const hit = rows.find(r => (r.label || "").toLowerCase().includes(l.toLowerCase()));
    if (hit) return hit.valueNumber ?? parseNumberLoose(hit.valueRaw, 0);
  }
  return 0;
}

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
    "EPS in Rs": +Number(r.eps || 0).toFixed(2),
  };
}

function toTSV(rows) {
  const headers = [
    "Quarter","Sales","Expenses","Operating Profit","OPM %","Other Income",
    "Interest","Depreciation","Profit before tax","Tax %","Net Profit","EPS in Rs"
  ];
  const lines = [headers.join("\t")];
  for (const r of rows) lines.push(headers.map(h => r[h]).join("\t"));
  return lines.join("\n");
}

function toCSV(rows) {
  const headers = [
    "Quarter","Sales","Expenses","Operating Profit","OPM %","Other Income",
    "Interest","Depreciation","Profit before tax","Tax %","Net Profit","EPS in Rs"
  ];
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map(h => r[h]).join(","));
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

module.exports = {
  LABELS,
  BANK_LABELS,
  parseNumberLoose,
  getValueByLabels,
  absVal,
  millionToCrore,
  rnd,
  buildScreenerRow,
  toTSV,
  toCSV,
  toJSON,
  quarterLabelFromItem,
  sortQuarterLabels
};
