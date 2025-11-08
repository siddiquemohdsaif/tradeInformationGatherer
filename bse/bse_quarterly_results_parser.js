// bse_quarterly_results_parser.js

const {
  LABELS, BANK_LABELS,
  getValueByLabels, toTSV, toCSV, toJSON,
} = require('./result_parsers/utils');

const { parseBankConsolidated }    = require('./result_parsers/bank_parser');
const { parseNonBankConsolidated } = require('./result_parsers/nonbank_parser');

// ---------- Type detection ----------
function detectIsBank(rows) {
  if (!Array.isArray(rows) || !rows.length) return false;
  const hasRevenue = !!getValueByLabels(rows, BANK_LABELS.REVENUE);
  const hasIntExp  = !!getValueByLabels(rows, BANK_LABELS.INTEREST_EXPENDED);
  const hasOps     = !!getValueByLabels(rows, BANK_LABELS.OPERATING_EXPENSES)
                  || !!getValueByLabels(rows, BANK_LABELS.EMPLOYEE_COST)
                  || !!getValueByLabels(rows, BANK_LABELS.OTHER_OPERATING);
  return (hasRevenue && hasIntExp && hasOps);
}

// ---------- EPS smoothing helpers (kept same for non-bank) ----------
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
function _rollingWindowBounds(i, n, win) {
  if (n <= 0) return [0, -1];
  if (win <= 1) return [i, i];
  if (i >= win - 1) return [i - (win - 1), i];
  const end = Math.min(n - 1, win - 1);
  return [0, end];
}

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

// ---------- Public API ----------
function parseStockConsolidated(inputJson, opts = {}) {
  const unitOut = (opts.unit || "crore").toLowerCase();
  const results = Array.isArray(inputJson?.results) ? inputJson.results : [];

  // detect type using first item that has rows
  let entityType = 'nonbank';
  for (const it of results) {
    if (Array.isArray(it?.rows) && it.rows.length) {
      if (detectIsBank(it.rows)) entityType = 'bank';
      break;
    }
  }

  const rows = entityType === 'bank'
    ? parseBankConsolidated(inputJson, { unit: unitOut })
    : parseNonBankConsolidated(inputJson, { unit: unitOut });

  return {
    meta: {
      companyCode: inputJson?.companyCode || "",
      rType: inputJson?.rType || "c",
      from: inputJson?.from || "",
      to: inputJson?.to || "",
      fetchedAt: inputJson?.fetchedAt,
      unitOut: unitOut === "crore" ? "crore" : "million",
      entityType,
    },
    rows,
    toTSV: () => toTSV(rows),
    toCSV: () => toCSV(rows),
    toJSON: (pretty = true) => toJSON(rows, pretty),
  };
}

/**
 * parseStockConsolidatedWithSmooth:
 * - Non-bank: resolves shares (if needed) & computes smooth EPS
 * - Bank: **does not** smooth; copies EPS → 'EPS smooth in Rs'
 */
async function parseStockConsolidatedWithSmooth(inputJson, opts = {}) {
  const {
    unit = 'crore',
    totalShares,
    autoResolveShares = true,
    companyInfoModulePath = '../evaluator/companyInfoParser',
    sharesFetcherModulePath = '../getLatestOutstandingShare',
  } = opts;

  const parsed = parseStockConsolidated(inputJson, { unit });
  const rows = parsed.rows;

  if (parsed?.meta?.entityType === 'bank') {
    const rowsWithSmooth = rows.map(r => ({
      ...r,
      'EPS smooth in Rs': r['EPS in Rs'],
    }));
    return {
      meta: parsed.meta,
      rows,
      rowsWithSmooth,
      smoothInputs: { mode: 'bank-pass-through', reason: 'bank-no-smooth', totalShares: null, perRow: [] },
      toTSV: () => toTSV(rowsWithSmooth),
      toCSV: () => toCSV(rowsWithSmooth),
      toJSON: (pretty = true) => toJSON(rowsWithSmooth, pretty),
    };
  }

  // non-bank: optionally resolve outstanding shares
  let sharesToUse = totalShares || null;
  let shareSource = { source: null, nseSymbol: null, marketScreenerCode: null, error: null };

  if (!sharesToUse && autoResolveShares && inputJson?.companyCode) {
    try {
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

  const { rowsWithSmooth, inputs } = computeSmoothEPS(rows, sharesToUse);

  return {
    meta: { ...parsed.meta, shareSource },
    rows,
    rowsWithSmooth,
    smoothInputs: inputs,
    toTSV: () => toTSV(rowsWithSmooth),
    toCSV: () => toCSV(rowsWithSmooth),
    toJSON: (pretty = true) => toJSON(rowsWithSmooth, pretty),
  };
}

// ---------- Save & export ----------
async function saveToFile(path, dataStr) {
  const fs = await import('node:fs/promises');
  await fs.writeFile(path, dataStr, 'utf8');
}

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

module.exports = {
  parseStockConsolidated,
  parseStockConsolidatedWithSmooth,
  exportParsed,
  // optional re-exports for convenience
  toCSV: (rows) => toCSV(rows),
  toTSV: (rows) => toTSV(rows),
  toJSON: (rows, pretty = true) => toJSON(rows, pretty),
};

// ---------- CLI (optional) ----------
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
