// bse_quarterly_past_results_fetcher.js
// Usage (programmatic):
//   const { fetchBseQuarterRange } = require('./bse_quarterly_past_results_fetcher');
//   const data = await fetchBseQuarterRange({ companyCode: '532281', from: '2025 mar', to: '2025 sep', rType: 'c' });
//
// CLI usage:
//   node bse_quarterly_past_results_fetcher.js 532281 "2025 mar" "2025 sep" c
//
// Notes:
// - Quarter code qtr = ((YY - 1994) * 4) + QQ, where QQ: Mar=1, Jun=2, Sep=3, Dec=4
// - Typ=Q (constant), RType: c=Consolidated, D=Standalone

const axios = require('axios');
const cheerio = require('cheerio');
const quarter_parser = require('./bse_quarterly_results_parser');

const BSE_BASE = 'https://www.bseindia.com/corporates/results.aspx';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const MONTH_TO_Q = {
  mar: 1,
  march: 1,
  jun: 2,
  june: 2,
  sep: 3,
  sept: 3,
  september: 3,
  dec: 4,
  december: 4,
};

const Q_TO_MONTH = { 1: 'Mar', 2: 'Jun', 3: 'Sep', 4: 'Dec' };

function parseQuarterString(s) {
  if (!s) throw new Error('Invalid quarter string');
  const norm = s.trim().replace(/\s+/g, ' ').toLowerCase();
  // Accept: "2025 mar", "mar 2025", "2025-mar", "2025/sep"
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

function quarterToCode(year, q) {
  // q: 1..4
  const code = (year - 1994) * 4 + q;
  if (code <= 0) throw new Error(`Quarter out of range for year ${year}, q ${q}`);
  return code;
}

function* enumerateQuarters(from, to) {
  const a = parseQuarterString(from);
  const b = parseQuarterString(to);

  // Make a numeric comparable value: (year, q) -> year*10 + q
  const key = ({ year, q }) => year * 10 + q;
  if (key(a) > key(b)) throw new Error(`"from" must be <= "to"`);

  let y = a.year;
  let q = a.q;
  while (y < b.year || (y === b.year && q <= b.q)) {
    yield { year: y, q, qtrCode: quarterToCode(y, q) };
    q++;
    if (q > 4) {
      q = 1;
      y++;
    }
  }
}

function safeNum(x) {
  if (x == null) return null;
  const s = String(x).trim().replace(/[,]/g, '');
  if (s === '' || s.toLowerCase() === 'na') return null;
  // Allow leading ± and decimals
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cleanText(t) {
  return String(t)
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchQuarterPage({ companyCode, qtrCode, rType = 'c' }) {
  const params = {
    Code: companyCode,
    qtr: String(qtrCode),
    RType: rType, // 'c' or 'D'
    Typ: 'Q',
  };

  const url = `${BSE_BASE}?${new URLSearchParams(params).toString()}`;
  const res = await axios.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bseindia.com/', Accept: 'text/html,*/*' },
    timeout: 30000,
    // Prevent axios from decoding entities; cheerio can handle
    transformResponse: (d) => d,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const html = res.data;
  const $ = cheerio.load(html);
  // The main results table has id "ContentPlaceHolder1_tbl_typeID" inside #tbl
  const $table = $('#ContentPlaceHolder1_tbl_typeID');
  if ($table.length === 0) {
    // No data / page structure changed
    return {
      url,
      ok: false,
      error: 'Results table not found (no data or structure changed)',
      rawLength: html?.length ?? 0,
    };
  }

  // Parse into rows of [label, value]
  const rows = [];
  $table.find('tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length >= 2) {
      const label = cleanText($(tds[0]).text());
      // The value cell might contain a link for Notes
      let valueText = cleanText($(tds[1]).text());
      const link = $(tds[1]).find('a').attr('onclick') || $(tds[1]).find('a').attr('href') || null;

      rows.push({
        label,
        valueRaw: valueText || null,
        // Try to extract number where meaningful (e.g., "3,03,490.00" -> 303490)
        valueNumber: safeNum(valueText),
      });
    }
  });

  // Extract key metadata
  const meta = {};
  function pick(labelStartsWith) {
    const r = rows.find((r) => r.label.toLowerCase().startsWith(labelStartsWith.toLowerCase()));
    return r?.valueRaw ?? null;
  }

  meta.type = pick('Type') || null;
  meta.dateBegin = pick('Date Begin') || null;
  meta.dateEnd = pick('Date End') || null;

  // Units usually in the header row: "Amount (Rs. million)"
  const unitHeader = rows.find((r) => /Amount\s*\(.*\)/i.test(r.label));
  meta.unit = unitHeader ? unitHeader.label.replace(/^Description\s*/i, '').trim() : 'Amount (Rs. million)';

  return {
    ok: true,
    url,
    meta,
    rows,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchBseQuarterRange({ companyCode, from, to, rType = 'c', throttleMs = 800 }) {
  // rType: 'c' for consolidated, 'D' for standalone
  const results = [];
  for (const { year, q, qtrCode } of enumerateQuarters(from, to)) {
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
      //console.log(JSON.stringify(data, null, 2));

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
