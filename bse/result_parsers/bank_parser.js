// parsers/bank_parser.js
const {
  BANK_LABELS, LABELS,
  getValueByLabels, absVal, millionToCrore, rnd,
  quarterLabelFromItem
} = require('./utils');

/**
 * BANKING FORMAT OUTPUT (Screener-style keys) for a single quarter:
 * {
 *   Quarter: "YYYY-Mmm",
 *   'Revenue +': <₹ crore>,
 *   'Interest': <₹ crore>,
 *   'Expenses +': <₹ crore>,
 *   'Financing Profit': <₹ crore>,
 *   'Financing Margin %': <int %>,
 *   'Other Income +': <₹ crore>,
 *   'Depreciation': <₹ crore>,
 *   'Profit before tax': <₹ crore>,
 *   'Tax %': <int %>,
 *   'Net Profit +': <₹ crore>,
 *   'EPS in Rs': <number with 2 decimals>,
 *   'Gross NPA %': <number (2 decimals, 0 if missing)>,
 *   'Net NPA %': <number (2 decimals, 0 if missing)>
 * }
 */
function parseBankItemToRow(item, unitOut = 'crore') {
  const rows = Array.isArray(item.rows) ? item.rows : [];
  const conv = unitOut === 'crore' ? millionToCrore : (x) => x;

  // Core pulls (₹ million, BSE sometimes shows negatives for costs -> abs)
  const revenueM     = getValueByLabels(rows, BANK_LABELS.REVENUE);
  const intExpM      = absVal(getValueByLabels(rows, BANK_LABELS.INTEREST_EXPENDED));
  let   opExpM       = getValueByLabels(rows, BANK_LABELS.OPERATING_EXPENSES);
  if (!opExpM) {
    const empM  = getValueByLabels(rows, BANK_LABELS.EMPLOYEE_COST);
    const opexM = getValueByLabels(rows, BANK_LABELS.OTHER_OPERATING);
    opExpM = absVal(empM) + absVal(opexM);
  }
  const provisionsM  = absVal(getValueByLabels(rows, BANK_LABELS.PROVISIONS));
  const depM         = absVal(getValueByLabels(rows, BANK_LABELS.DEPRECIATION)); // often 0
  const otherIncomeM = getValueByLabels(rows, LABELS.OTHER_INCOME);
  const pbtM         = getValueByLabels(rows, LABELS.PBT);

  // Tax: prefer single "Tax"; else sum Current + Deferred (abs to treat as expense)
  let taxM = getValueByLabels(rows, LABELS.TAX_TOTAL);
  if (!taxM) {
    const cur = getValueByLabels(rows, LABELS.TAX_CURRENT);
    const def = getValueByLabels(rows, LABELS.TAX_DEFERRED);
    taxM = (cur || 0) + (def || 0);
  }
  const taxMabs      = absVal(taxM);

  const netProfitM   = getValueByLabels(rows, LABELS.NET_PROFIT);

  // EPS (best-effort)
  let eps = getValueByLabels(rows, LABELS.EPS_BAS);
  if (!eps) eps = getValueByLabels(rows, LABELS.EPS_DIL);
  if (!(typeof eps === 'number' && Number.isFinite(eps))) eps = 0;

  // NPA %
  let gnpaPct = getValueByLabels(rows, BANK_LABELS.GROSS_NPA_PCT);
  let nnpaPct = getValueByLabels(rows, BANK_LABELS.NET_NPA_PCT);
  if (!Number.isFinite(gnpaPct)) gnpaPct = 0;
  if (!Number.isFinite(nnpaPct)) nnpaPct = 0;
  gnpaPct = Math.abs(gnpaPct);
  nnpaPct = Math.abs(nnpaPct);

  // Convert to output unit
  const revenueU     = conv(revenueM);
  const interestU    = conv(intExpM);
  const expensesU    = conv(opExpM + provisionsM); // Screener "Expenses +" for banks
  const otherIncomeU = conv(otherIncomeM);
  const depU         = conv(depM);
  const pbtU         = conv(pbtM);
  const netProfitU   = conv(netProfitM);

  // Financing Profit/Margin
  const fpU          = revenueU - interestU - expensesU;
  const fpmPct       = revenueU !== 0 ? (fpU / revenueU) * 100 : 0;

  // Tax %
  const taxPct       = pbtU > 0 ? (conv(taxMabs) / pbtU) * 100 : 0;

  const qLabel = quarterLabelFromItem(item);

  // === SCREENER BANKING FORMAT (per quarter) ===
  return {
    Quarter: qLabel,
    'Revenue':          rnd(revenueU),
    'Interest':           rnd(interestU),
    'Expenses':         rnd(expensesU),
    'Financing Profit':   rnd(fpU),
    'Financing Margin %': Math.round(fpmPct),
    'Other Income':     rnd(otherIncomeU),
    'Depreciation':       rnd(depU),
    'Profit before tax':  rnd(pbtU),
    'Tax %':              Math.round(taxPct),
    'Net Profit':       rnd(netProfitU),
    'EPS in Rs':          +Number(eps).toFixed(2),
    'Gross NPA %':        +Number(gnpaPct).toFixed(2),
    'Net NPA %':          +Number(nnpaPct).toFixed(2),
  };
}

function parseBankConsolidated(inputJson, { unit = 'crore' } = {}) {
  const results = Array.isArray(inputJson?.results) ? inputJson.results : [];
  return results.map(it => parseBankItemToRow(it, unit));
}

module.exports = {
  parseBankConsolidated,
  parseBankItemToRow,
};
