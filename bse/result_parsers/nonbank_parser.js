// result_parsers/nonbank_parser.js
const {
  LABELS,
  getValueByLabels, absVal, millionToCrore,
  buildScreenerRow, quarterLabelFromItem
} = require('./utils');

/**
 * Parse *one* non-bank item (₹ million in, Screener-style row out with ₹ crore).
 */
function parseNonBankItemToRow(item, unitOut = 'crore') {
  const rows = Array.isArray(item.rows) ? item.rows : [];
  const conv = unitOut === 'crore' ? millionToCrore : (x) => x;

  // Raw (₹ million)
  const salesM        = getValueByLabels(rows, LABELS.SALES);
  const otherIncomeM  = getValueByLabels(rows, LABELS.OTHER_INCOME);
  const interestM     = absVal(getValueByLabels(rows, LABELS.FINANCE_COSTS));
  const depreciationM = absVal(getValueByLabels(rows, LABELS.DEPRECIATION));
  const pbtM          = getValueByLabels(rows, LABELS.PBT);

  // Tax (prefer single; else current+deferred)
  let taxM = getValueByLabels(rows, LABELS.TAX_TOTAL);
  if (!taxM) {
    const cur = getValueByLabels(rows, LABELS.TAX_CURRENT);
    const def = getValueByLabels(rows, LABELS.TAX_DEFERRED);
    taxM = (cur || 0) + (def || 0);
  }
  const netProfitM = getValueByLabels(rows, LABELS.NET_PROFIT);

  // Screener “Expenses” = Sales + OtherIncome − Interest − Depreciation − PBT
  const expensesM = (salesM || 0) + (otherIncomeM || 0) - (interestM || 0) - (depreciationM || 0) - (pbtM || 0);

  // Convert to unit
  const salesU        = conv(salesM);
  const expensesU     = conv(expensesM);
  const otherIncomeU  = conv(otherIncomeM);
  const interestU     = conv(interestM);
  const depreciationU = conv(depreciationM);
  const pbtU          = conv(pbtM);
  const netProfitU    = conv(netProfitM);

  // OP & OPM%
  const opU    = (salesU - expensesU);
  const opmPct = salesU !== 0 ? ((opU) / salesU) * 100 : 0;

  // Tax %
  const taxPct = pbtU > 0 ? (conv(Math.abs(taxM)) / pbtU) * 100 : 0;

  // EPS (best available)
  let eps = getValueByLabels(rows, LABELS.EPS_BAS);
  if (!eps) eps = getValueByLabels(rows, LABELS.EPS_DIL);
  eps = typeof eps === "number" && Number.isFinite(eps) ? eps : 0;

  const qLabel = quarterLabelFromItem(item);

  return buildScreenerRow(qLabel, {
    salesU, expensesU, otherIncomeU, interestU, depreciationU,
    pbtU, opU, opmPct, taxPct, netProfitU, eps
  });
}

/** Parse a whole inputJson (non-bank) into rows */
function parseNonBankConsolidated(inputJson, { unit = 'crore' } = {}) {
  const results = Array.isArray(inputJson?.results) ? inputJson.results : [];
  const rows = results.map(it => parseNonBankItemToRow(it, unit));
  return rows;
}

module.exports = {
  parseNonBankConsolidated,
  parseNonBankItemToRow,
};
