// bse_company_result_events_fetcher.js
//
// Scrapes BSE "Company Results" pages:
//   https://www.bseindia.com/corporates/comp_results.aspx?Code=<CODE>&PID=<PAGE>
// and returns a JSON array of rows with clean fields.
//
// CLI:
//   node bse_company_resultevents_fetcher.js <CODE> [PID_START=1] [PID_END=PID_START]
//
// Example:
//   node bse_company_resultevents_fetcher.js 532149 1 3
//
// Output: prints JSON to stdout

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const BASE = "https://www.bseindia.com";
const LIST_URL = `${BASE}/corporates/comp_results.aspx`;

// ---------- where to save ----------
const OUTPUT_DIR = path.resolve(__dirname, "../data/bse/resultEvents");

// ---------- dialing knobs ----------
const SOFT_RATE_LIMIT_MS = 900 + Math.floor(Math.random() * 400); // 0.9–1.3s
const MAX_ATTEMPTS = 6; // total attempts per PID
const SHORT_BACKOFF_MS = (attempt) => 800 * attempt; // for normal transient errors
const LONG_BLOCK_WAIT_MS = 60_000; // 60s when we detect bot block
const LONG_BLOCK_JITTER_MS = 5_000; // + up to 5s jitter

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clean(t) {
  return (t || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(href) {
  if (!href || href === "-" || href === "#") return null;
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

function looksLikeBlock(status, html) {
  if (status === 404 || status === 403 || status === 429) return true;
  const text = (html || "").toString().slice(0, 20000);
  // A few common “block” fingerprints (Akamai/Cloudflare/WAF pages)
  return (
    /access\s+denied/i.test(text) ||
    /request unsuccessful/i.test(text) ||
    /temporarily unavailable/i.test(text) ||
    /captcha/i.test(text) ||
    /web application firewall/i.test(text) ||
    /bot/i.test(text)
  );
}

async function fetchPage(code, pid, attempt = 1) {
  const url = `${LIST_URL}?Code=${encodeURIComponent(code)}&PID=${encodeURIComponent(pid)}`;
  const ua = USER_AGENTS[(attempt - 1) % USER_AGENTS.length];
  try {
    const res = await axios.get(url, {
      timeout: 30_000,
      headers: {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": `${LIST_URL}?Code=${encodeURIComponent(code)}&PID=1`,
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
      },
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 500, // allow us to see 4xx
    });

    // If it looks like a bot block, do a long wait + retry
    if (looksLikeBlock(res.status, res.data)) {
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(`Blocked by BSE/WAF (status ${res.status}) after ${attempt} attempts`);
      }
      const wait = LONG_BLOCK_WAIT_MS + Math.floor(Math.random() * LONG_BLOCK_JITTER_MS);
      console.warn(`[BLOCK] ${url}  status=${res.status}  waiting ${Math.round(wait / 1000)}s then retrying...`);
      await sleep(wait);
      return fetchPage(code, pid, attempt + 1);
    }

    // Otherwise treat 2xx/3xx as OK
    if (res.status >= 200 && res.status < 400) {
      return res.data;
    }

    // Non-block 4xx/5xx: short backoff and retry
    if (attempt < MAX_ATTEMPTS) {
      const wait = SHORT_BACKOFF_MS(attempt);
      console.warn(`[RETRY] ${url}  status=${res.status}  waiting ${wait}ms...`);
      await sleep(wait);
      return fetchPage(code, pid, attempt + 1);
    }

    throw new Error(`HTTP ${res.status} after ${attempt} attempts`);
  } catch (e) {
    // Network/timeouts: retry with short backoff
    if (attempt < MAX_ATTEMPTS) {
      const wait = SHORT_BACKOFF_MS(attempt);
      console.warn(`[ERROR] ${url}  ${e.message}  waiting ${wait}ms...`);
      await sleep(wait);
      return fetchPage(code, pid, attempt + 1);
    }
    throw new Error(`Failed to fetch PID=${pid} after ${attempt} attempts: ${e.message}`);
  }
}

function parseRows(html, code) {
  const $ = cheerio.load(html);

  // Scrip info (nice-to-have)
  const companySpan = $("#ContentPlaceHolder1_spScrip").first();
  const companyName = clean(companySpan.text()).replace(/\(\d+\)\s*$/, "");
  const companyCode = (companySpan.text().match(/\((\d+)\)/) || [])[1] || String(code);

  // Find the main table with headers Financial Year, Quarter, etc.
  let targetTable;
  $("table").each((_i, el) => {
    const headerText = clean($(el).text());
    if (
      /Financial Year/i.test(headerText) &&
      /Quarter/i.test(headerText) &&
      /Filing_Date_Time/i.test(headerText)
    ) {
      targetTable = $(el);
      return false;
    }
    return undefined;
  });

  if (!targetTable) return { companyName, companyCode, rows: [] };

  const rows = [];
  const headerRow = targetTable.find("tr").first();
  const ths = headerRow.find("td,th").map((_i, el) => clean($(el).text())).get();

  const bodyRows = targetTable.find("tr").slice(1); // skip header

  bodyRows.each((_ri, tr) => {
    const $tr = $(tr);
    const tds = $tr.find("td");
    if (tds.length < 5) return; // skip separators or "Prev/Next" row
    if ($tr.find("a").filter((_, a) => /Prev|Next/i.test($(a).text())).length > 0) return;

    const getText = (idx) => clean($(tds[idx]).text());
    const getLinkHref = (idx) => {
      const a = $(tds[idx]).find("a").first();
      const href = a.attr("href");
      return absUrl(href);
    };

    const finYear = getText(0);
    const quarterCell = $(tds[1]);
    const quarterLabel = clean(quarterCell.text());
    const quarterHrefRel = quarterCell.find("a").attr("href");
    const quarterHref = absUrl(quarterHrefRel);

    const rec = {
      financialYear: finYear || null,
      quarterLabel: quarterLabel || null,
      quarterDetailsUrl: quarterHref,
      type: getText(2) || null,
      status: getText(3) || null,
      filingDateTime: getText(4) || null,
      revisedDateTime: getText(5) || null,
      revisionReason: getText(6) || null,
      standaloneXbrlUrl: getLinkHref(7),
      consolidateXbrlUrl: getLinkHref(8),
      standaloneTrendUrl: getLinkHref(9),
      hasStandaloneXbrl: !!getLinkHref(7),
      hasConsolidateXbrl: !!getLinkHref(8),
    };

    rows.push(rec);
  });

  return { companyName, companyCode, rows, headersDetected: ths };
}

async function scrapeRange(code, pidStart = 1, pidEnd = pidStart) {
  const out = {
    meta: {
      companyCode: String(code),
      scrapedAt: new Date().toISOString(),
      source: `${LIST_URL}?Code=${code}`,
      pidStart: Number(pidStart),
      pidEnd: Number(pidEnd),
    },
    companyName: null,
    pages: [],
    rows: [],
  };

  for (let pid = pidStart; pid <= pidEnd; pid++) {
    const startTs = Date.now();
    try {
      const html = await fetchPage(code, pid);
      const parsed = parseRows(html, code);

      if (!out.companyName && parsed.companyName) out.companyName = parsed.companyName;

      out.pages.push({
        pid,
        rows: parsed.rows.length,
        ok: true,
        ms: Date.now() - startTs,
      });
      out.rows.push(...parsed.rows);
    } catch (e) {
      // Capture the error but keep moving
      const msg = e?.message || String(e);
      console.warn(`[PID ${pid}] ${msg}`);
      out.pages.push({
        pid,
        ok: false,
        error: msg,
        ms: Date.now() - startTs,
      });
    }

    // polite global rate limit
    await sleep(SOFT_RATE_LIMIT_MS);
  }

  return out;
}

// Utility to save JSON pretty-printed
function saveJsonToFile(companyCode, data) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outFile = path.join(OUTPUT_DIR, `${companyCode}.json`);
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2), "utf8");
  return outFile;
}

// ---------- CLI ----------
if (require.main === module) {
  (async () => {
    const code = process.argv[2];                    // e.g., "532149"
    const pidStart = Number(process.argv[3] ?? 1);   // e.g., 0 or 1
    const pidEnd = Number(process.argv[4] ?? pidStart);

    if (!code) {
      console.error("Usage: node bse_company_resultevents_fetcher.js <CODE> [PID_START=1] [PID_END=PID_START]");
      process.exit(1);
    }

    try {
      const data = await scrapeRange(code, pidStart, pidEnd);
      const companyCode = String(data?.meta?.companyCode || code);
      const savedPath = saveJsonToFile(companyCode, data);
      console.log(`Saved: ${savedPath}`);
      // If you still want the JSON printed:
      // console.log(JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("Fatal error:", e?.message || e);
      process.exit(1);
    }
  })();
}

module.exports = { scrapeRange };
