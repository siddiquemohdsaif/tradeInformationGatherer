// result_parsers/nbfc_parser.js
const {
  getValueByLabels, absVal, millionToCrore, rnd,
  quarterLabelFromItem
} = require('./utils');

/**
 * NBFC "BANK-TYPE" SCREENER OUTPUT (per quarter):
 * {
 *   Quarter: "YYYY-Mmm",
 *   'Revenue': <₹ crore>,                // Revenue from operations
 *   'Interest': <₹ crore>,               // Finance Costs
 *   'Expenses': <₹ crore>,               // Operating expenses (excl. interest & depreciation)
 *   'Financing Profit': <₹ crore>,       // Revenue - Interest - Expenses
 *   'Financing Margin %': <int %>,       // (Financing Profit / Revenue)*100
 *   'Other Income': <₹ crore>,           // Other Income (II)
 *   'Depreciation': <₹ crore>,
 *   'Profit before tax': <₹ crore>,      // PBT
 *   'Tax %': <int %>,                    // |Tax| / PBT
 *   'Net Profit': <₹ crore>,
 *   'EPS in Rs': <number (2 decimals)>,
 *   'Gross NPA %': <number (2 decimals, optional, default 0)>,
 *   'Net NPA %': <number (2 decimals, optional, default 0)>
 * }
 */

// NBFC-specific labels to assemble operating "Expenses"
const NBFC_LABELS = {
  SALES: [
    "Total Revenue from operations"],
  FEES_COMMISSION_EXP: [
    "Fees and commission expense",
    "Fee and commission expense",
    "Fees & commission expense",
  ],
  IMPAIRMENT: [
    "Impairment on financial instruments",
    "Expected credit loss",
    "Credit loss expense",
    "Provision for expected credit loss",
  ],
  EMPLOYEE_BENEFITS: [
    "Employee Benefits Expenses",
    "Employee benefit expense",
    "Employee cost",
  ],
  DEPRECIATION: [
    "Depreciation and amortisation expense",
    "Depreciation",
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
  PBT: [
    "Profit (+)/ Loss (-) from Ordinary Activities before Tax",
    "Profit before exceptional items and tax",
    "Profit before tax",
    "Profit/(loss) before tax",
  ],
  NET_PROFIT: [
    "Net Profit",
    "Net Profit (+)/ Loss (-) from Ordinary Activities after Tax",
    "Profit for the period",
    "Profit/(loss) for the period",
    "Net Profit after Mino Inter & Share of P & L",
    "Income Attributable to Consolidated Group",
  ],
  OTHER_EXPENSES: [
    "Other expenses",
    "Other operating expenses",
    "Administrative and other expenses",
  ],
  TOTAL_EXPENSES: [
    "Total Expenses",
  ],
  EPS_BAS: [
    "Basic EPS (in Rs.)",
    "Basic (Rs.)",
  ],
  EPS_DIL: [
    "Diluted EPS (in Rs.)",
    "Diluted (Rs.)",
  ],
  GROSS_NPA_PCT: [
    "% of Gross NPAs", "Gross NPA %", "Gross NPA percentage",
  ],
  NET_NPA_PCT: [
    "% of Net NPAs", "Net NPA %", "Net NPA percentage",
  ],
};

/** Parse one NBFC quarter (₹ million in → bank-type Screener row out in ₹ crore). */
function parseNbfcItemToBankRow(item, unitOut = 'crore') {
  const rows = Array.isArray(item.rows) ? item.rows : [];
  const conv = unitOut === 'crore' ? millionToCrore : (x) => x;

  // Core pulls (₹ million)
  const revenueM      = getValueByLabels(rows, NBFC_LABELS.SALES);             // Revenue from operations
  const otherIncomeM  = getValueByLabels(rows, NBFC_LABELS.OTHER_INCOME);          // Other Income (II)
  const interestM     = absVal(getValueByLabels(rows, NBFC_LABELS.FINANCE_COSTS)); // Finance Costs -> "Interest"
  const depreciationM = absVal(getValueByLabels(rows, NBFC_LABELS.DEPRECIATION));
  const pbtM          = getValueByLabels(rows, NBFC_LABELS.PBT);

  const netProfitM  = getValueByLabels(rows, NBFC_LABELS.NET_PROFIT);

//   // Build "Expenses" like banks (operating + credit costs, exclude interest & depreciation)
//   const feesCommM = absVal(getValueByLabels(rows, NBFC_LABELS.FEES_COMMISSION_EXP));
//   const impairM   = absVal(getValueByLabels(rows, NBFC_LABELS.IMPAIRMENT));
//   const empM      = absVal(getValueByLabels(rows, NBFC_LABELS.EMPLOYEE_BENEFITS));
//   const otherExpM = absVal(getValueByLabels(rows, NBFC_LABELS.OTHER_EXPENSES));
//   const expensesM = feesCommM + impairM + empM + otherExpM;

  const totalExpenses = absVal(getValueByLabels(rows, NBFC_LABELS.TOTAL_EXPENSES));
  const expensesM = totalExpenses - interestM - depreciationM;


  // Optional NPA %
  let gnpaPct = getValueByLabels(rows, NBFC_LABELS.GROSS_NPA_PCT);
  let nnpaPct = getValueByLabels(rows, NBFC_LABELS.NET_NPA_PCT);
  if (!Number.isFinite(gnpaPct)) gnpaPct = 0;
  if (!Number.isFinite(nnpaPct)) nnpaPct = 0;
  gnpaPct = Math.abs(gnpaPct);
  nnpaPct = Math.abs(nnpaPct);

  // Convert to output unit
  const revenueU     = conv(revenueM);
  const interestU    = conv(interestM);
  const expensesU    = conv(expensesM);
  const otherIncomeU = conv(otherIncomeM);
  const depU         = conv(depreciationM);
  const pbtU         = conv(pbtM);
  const netProfitU   = conv(netProfitM);

  // Financing Profit & Margin (same as bank)
  const fpU     = revenueU - interestU - expensesU;
  const fpmPct  = revenueU !== 0 ? (fpU / revenueU) * 100 : 0;

  // Tax %
  const taxMabs     = absVal(pbtU - netProfitU);
  const taxPct = pbtU > 0 ? (taxMabs / pbtU) * 100 : 0;


  // EPS (best available from basic→diluted)
  let eps = getValueByLabels(rows, NBFC_LABELS.EPS_BAS);
  if (!eps) eps = getValueByLabels(rows, NBFC_LABELS.EPS_DIL);
  if (!(typeof eps === 'number' && Number.isFinite(eps))) eps = 0;

  const qLabel = quarterLabelFromItem(item);

  return {
    Quarter: qLabel,
    'Revenue':            rnd(revenueU),
    'Interest':           rnd(interestU),
    'Expenses':           rnd(expensesU),
    'Financing Profit':   rnd(fpU),
    'Financing Margin %': Math.round(fpmPct),
    'Other Income':       rnd(otherIncomeU),
    'Depreciation':       rnd(depU),
    'Profit before tax':  rnd(pbtU),
    'Tax %':              Math.round(taxPct),
    'Net Profit':         rnd(netProfitU),
    'EPS in Rs':          +Number(eps).toFixed(2),
    'Gross NPA %':        +Number(gnpaPct).toFixed(2),
    'Net NPA %':          +Number(nnpaPct).toFixed(2),
  };
}

/** Parse whole NBFC payload into bank-type rows */
function parseNbfcConsolidatedBankFormat(inputJson, { unit = 'crore' } = {}) {
  const results = Array.isArray(inputJson?.results) ? inputJson.results : [];
  return results.map(it => parseNbfcItemToBankRow(it, unit));
}

module.exports = {
  parseNbfcConsolidatedBankFormat,
  parseNbfcItemToBankRow,
};
