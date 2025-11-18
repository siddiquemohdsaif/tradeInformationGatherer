// bse_quarterly_past_results_fetcher.js
// Usage (programmatic):
//   const { fetchBseQuarterRange } = require('./bse_quarterly_past_results_fetcher');
//   const data = await fetchBseQuarterRange({ companyCode: '532281', from: '2025 mar', to: '2025 sep', rType: 'c' });
//
// CLI usage:
//   node bse_quarterly_past_results_fetcher.js 532281 "2025 mar" "2025 sep" c
//
// Notes:
// - Regular BSE quarter code: qtr = ((year - 1994) * 4) + q, where q: Mar=1, Jun=2, Sep=3, Dec=4
// - NBFC pages use base 322 <=> 2023-Mar and step +4 per quarter.
// - Regular path: results.aspx?Code=...&qtr=...&RType=c|D&Typ=Q
// - NBFC Standalone:   NBFC.aspx?Code=...&qtr=...&Rtype=P
// - NBFC Consolidated: NBFC_Consolidated.aspx?Code=...&qtr=...&Rtype=P

const axios = require('axios');
const cheerio = require('cheerio');
const quarter_parser = require('./bse_quarterly_results_parser');

const BSE_BASE_RESULTS = 'https://www.bseindia.com/corporates/results.aspx';
const BSE_BASE_NBFC_STANDALONE   = 'https://www.bseindia.com/corporates/NBFC.aspx';
const BSE_BASE_NBFC_CONSOLIDATED = 'https://www.bseindia.com/corporates/NBFC_Consolidated.aspx';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Month <-> quarter helpers
const MONTH_TO_Q = {
  mar: 1, march: 1,
  jun: 2, june: 2,
  sep: 3, sept: 3, september: 3,
  dec: 4, december: 4,
};
const Q_TO_MONTH = { 1: 'Mar', 2: 'Jun', 3: 'Sep', 4: 'Dec' };

// NBFC detection (your list)
const KNOWN_NBFC_CODES = new Set([
  '500034','532978','543257','543940','532810','500490','511243','532955',
  '511218','533398','543066','540691','532892','540530','542772','500271'
]);
function isNbfc(companyCode) {
  return KNOWN_NBFC_CODES.has(String(companyCode));
}

// NBFC quarter-code mapping
const NBFC_BASE_CODE = 322;   // 2023-Mar
const NBFC_BASE_YEAR = 2023;
const NBFC_BASE_QINDEX = 0;   // 0: Mar, 1: Jun, 2: Sep, 3: Dec
const NBFC_MONTHS = ['Mar', 'Jun', 'Sep', 'Dec'];
const NBFC_MONTH_TO_QINDEX = { mar:0, march:0, jun:1, june:1, sep:2, sept:2, september:2, dec:3, december:3 };

function nbfcCodeToQuarter(code) {
  if ((code - NBFC_BASE_CODE) % 4 !== 0) {
    throw new Error(`NBFC code ${code} is not aligned to step 4 from base ${NBFC_BASE_CODE}`);
  }
  const quartersFromBase = (code - NBFC_BASE_CODE) / 4;
  const x = NBFC_BASE_QINDEX + quartersFromBase;
  const qIndex = ((x % 4) + 4) % 4;
  const year = NBFC_BASE_YEAR + Math.floor((NBFC_BASE_QINDEX + quartersFromBase) / 4);
  const month = NBFC_MONTHS[qIndex];
  return { year, qIndex, month, label: `${year}-${month}` };
}

function nbfcQuarterToCode({ year, q }) {
  let qIndex;
  if (typeof q === 'number') {
    if (q < 1 || q > 4) throw new Error('q must be 1..4 (1=Mar, 2=Jun, 3=Sep, 4=Dec)');
    qIndex = q - 1;
  } else {
    const k = String(q).toLowerCase();
    if (!(k in NBFC_MONTH_TO_QINDEX)) throw new Error(`Unknown month: ${q}`);
    qIndex = NBFC_MONTH_TO_QINDEX[k];
  }
  const quartersFromBase = (year - NBFC_BASE_YEAR) * 4 + (qIndex - NBFC_BASE_QINDEX);
  return NBFC_BASE_CODE + 4 * quartersFromBase;
}

// Parse flexible quarter string
function parseQuarterString(s) {
  if (!s) throw new Error('Invalid quarter string');
  const norm = s.trim().replace(/\s+/g, ' ').toLowerCase();
  const parts = norm.split(/[\s\-\/]+/);
  if (parts.length < 2) throw new Error(`Cannot parse quarter: ${s}`);

  let y, m;
  if (/^\d{4}$/.test(parts[0])) {
    y = Number(parts[0]);
    m = parts[1];
  } else if (/^\d{4}$/.test(parts[1])) {
    y = Number(parts[1]);
    m = parts[0];
  } else {
    throw new Error(`Cannot parse year/month from: ${s}`);
  }

  const q = MONTH_TO_Q[m];
  if (!q) throw new Error(`Unknown quarter month: ${m} (use Mar/Jun/Sep/Dec)`);
  return { year: y, q };
}

// Regular (non-NBFC) quarter-code
function quarterToCode(year, q) {
  const code = (year - 1994) * 4 + q;
  if (code <= 0) throw new Error(`Quarter out of range for year ${year}, q ${q}`);
  return code;
}

// Range enumerator (auto-switch NBFC vs regular)
function* enumerateQuarters(from, to, nbfc) {
  const a = parseQuarterString(from);
  const b = parseQuarterString(to);
  const key = ({ year, q }) => year * 10 + q;
  if (key(a) > key(b)) throw new Error(`"from" must be <= "to"`);

  let y = a.year;
  let q = a.q;
  while (y < b.year || (y === b.year && q <= b.q)) {
    const qtrCode = nbfc
      ? nbfcQuarterToCode({ year: y, q })
      : quarterToCode(y, q);

    yield { year: y, q, qtrCode };

    q++;
    if (q > 4) { q = 1; y++; }
  }
}

function safeNum(x) {
  if (x == null) return null;
  const s = String(x).trim().replace(/[,]/g, '');
  if (s === '' || s.toLowerCase() === 'na') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cleanText(t) {
  return String(t)
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse table rows into {label, valueRaw, valueNumber}[]
// Supports both regular table (#ContentPlaceHolder1_tbl_typeID) and NBFC grid (#ContentPlaceHolder1_gv_Profit)
function extractRowsFromTable($, $table) {
  const rows = [];

  // Try to detect NBFC grid by header text
  const $head = $table.find('tr').first();
  const ths = $head.find('th');
  const looksLikeNbfcGrid =
    ths.length >= 3 &&
    /Particulars/i.test($(ths.get(1)).text()) &&
    /current/i.test($(ths.get(2)).text());

  if (looksLikeNbfcGrid) {
    // NBFC grid: cols = [blank, Particulars, Current, Previous]
    $table.find('tr').slice(1).each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 3) return;
      const label = cleanText($(tds.get(1)).text());
      const valueText = cleanText($(tds.get(2)).text()); // current period value
      if (!label) return;
      rows.push({
        label,
        valueRaw: valueText || null,
        valueNumber: safeNum(valueText),
      });
    });
    return rows;
  }

  // Fallback: classic two-column label/value table
  $table.find('tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length >= 2) {
      const label = cleanText($(tds[0]).text());
      const valueText = cleanText($(tds[1]).text());
      if (!label) return;
      rows.push({
        label,
        valueRaw: valueText || null,
        valueNumber: safeNum(valueText),
      });
    }
  });

  return rows;
}

// Fetch one quarter page (NBFC vs regular handled internally)
async function fetchQuarterPage({ companyCode, qtrCode, rType = 'c' }) {
  const nbfc = isNbfc(companyCode);

  let url, params;
  if (nbfc) {
    const isConsolidated = String(rType).toLowerCase() === 'c';
    const base = isConsolidated ? BSE_BASE_NBFC_CONSOLIDATED : BSE_BASE_NBFC_STANDALONE;
    params = { Code: companyCode, qtr: String(qtrCode), Rtype: 'P' }; // NBFC requires Rtype=P
    url = `${base}?${new URLSearchParams(params).toString()}`;
  } else {
    params = { Code: companyCode, qtr: String(qtrCode), RType: rType, Typ: 'Q' };
    url = `${BSE_BASE_RESULTS}?${new URLSearchParams(params).toString()}`;
  }

  const res = await axios.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bseindia.com/', Accept: 'text/html,*/*' },
    timeout: 30000,
    transformResponse: (d) => d,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const html = res.data;
  const $ = cheerio.load(html);

  // Try known ids in order: regular first, then NBFC grid, then heuristic fallback
  let $table = $('#ContentPlaceHolder1_tbl_typeID');
  if ($table.length === 0) $table = $('#ContentPlaceHolder1_gv_Profit');

  if ($table.length === 0) {
    // Heuristic fallback: pick a table under #tbl or body that looks like label/value-ish.
    const $root = $('#tbl').length ? $('#tbl') : $('body');
    $root.find('table').each((_, t) => {
      if ($table.length) return;
      const $t = $(t);
      const trs = $t.find('tr');
      if (trs.length >= 4) {
        const ok = trs.slice(0, 4).toArray().every(tr => $(tr).find('td,th').length >= 2);
        if (ok) $table = $t;
      }
    });
  }

  if ($table.length === 0) {
    return {
      url,
      ok: false,
      error: 'Results table not found (no data or structure changed)',
      rawLength: html?.length ?? 0,
      nbfc,
    };
  }

  const rows = extractRowsFromTable($, $table);

  // Extract meta with multiple label variants
  const meta = {};
  function pick(prefixes) {
    const p = Array.isArray(prefixes) ? prefixes : [prefixes];
    const r = rows.find(r =>
      p.some(px => r.label.toLowerCase().startsWith(String(px).toLowerCase()))
    );
    return r?.valueRaw ?? null;
  }

  meta.type = pick(['Type','Whether accounts are audited or unaudited','Nature of report standalone or consolidated']) || null;
  meta.dateBegin = pick(['Date Begin','Date of start of reporting period']) || null;
  meta.dateEnd = pick(['Date End','Date of end of reporting period']) || null;

  // Units header not explicit on NBFC grid; keep null if not found
  const unitRow = rows.find(r => /Amount\s*\(.*\)/i.test(r.label));
  meta.unit = unitRow ? unitRow.label.replace(/^Description\s*/i, '').trim() : null;

  return { ok: true, url, meta, rows, nbfc };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchBseQuarterRange({ companyCode, from, to, rType = 'c', throttleMs = 800 }) {
  const nbfc = isNbfc(companyCode);
  const results = [];

  for (const { year, q, qtrCode } of enumerateQuarters(from, to, nbfc)) {
    const quarterLabel = `${year}-${Q_TO_MONTH[q]}`;
    try {
      const page = await fetchQuarterPage({ companyCode, qtrCode, rType });
      results.push({
        quarter: quarterLabel,
        year,
        q,
        qtrCode,
        rType,
        ...page,
      });
    } catch (e) {
      results.push({
        quarter: quarterLabel,
        year,
        q,
        qtrCode,
        rType,
        ok: false,
        error: String(e && e.message ? e.message : e),
      });
    }
    if (throttleMs > 0) await sleep(throttleMs);
  }

  return {
    companyCode,
    rType,
    from,
    to,
    fetchedAt: new Date().toISOString(),
    results,
  };
}

// If run directly from CLI
if (require.main === module) {
  (async () => {
    const [companyCode, from, to, rType = 'c'] = process.argv.slice(2);
    if (!companyCode || !from || !to) {
      console.error('Usage: node bse_quarterly_past_results_fetcher.js <companyCode> "<from>" "<to>" [rType]');
      console.error('Example: node bse_quarterly_past_results_fetcher.js 532281 "2025 mar" "2025 sep" c');
      process.exit(1);
    }
    try {
      const data = await fetchBseQuarterRange({ companyCode, from, to, rType });
      const data2 = await quarter_parser.parseStockConsolidatedWithSmooth(data);
      console.log(data2.toJSON());
    } catch (e) {
      console.error('Error:', e);
      process.exit(2);
    }
  })();
}

module.exports = {
  fetchBseQuarterRange
};
