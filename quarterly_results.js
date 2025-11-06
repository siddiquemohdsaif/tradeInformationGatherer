// quarterly_result.js (CommonJS)
// Scrapes ONLY the "Quarterly results" card: dynamic header periods + per-metric Released/Forecast/Spread.
// Prints JSON to stdout and writes quarterly_results.json
//
// Usage: node quarterly_result.js

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// Example calendar page (ITC)
const CALENDAR_URL =
  "https://in.marketscreener.com/quote/stock/LIFE-INSURANCE-CORPORATIO-137965464/calendar/";

const WRITE_JSON = true;
const USE_PUPPETEER = true;
const JSON_PATH = path.resolve(__dirname, "quarterly_results.json");

// ---------- utils ----------
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const squeeze = (s) => (s || "").replace(/\s+/g, " ").trim();

// Liberal numeric parser (handles spaces, EU-style commas, dashes)
function parseNumberLoose(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t || t === "-" || /^n\/a$/i.test(t)) return null;
  let x = t.replace(/\s+/g, "");
  if (x.includes(",") && !x.includes(".")) {
    x = x.replace(/,/g, "."); // treat comma as decimal sep if no dot exists
  } else {
    x = x.replace(/,/g, ""); // thousands
  }
  const m = x.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const val = Number(m[0]);
  return Number.isFinite(val) ? val : null;
}

function parseSpreadPercent(raw) {
  if (!raw) return null;
  const m = String(raw).match(/-?\d[\d.,]*\s*%/);
  if (!m) return null;
  return parseNumberLoose(m[0]);
}

// ---------- HTML extraction ----------
function findQuarterlyResultsCardRoot($) {
  // Prefer the table id
  const table = $("#quarterlyResultsTable");
  if (table.length) {
    let node = table.closest("div.card");
    if (node.length) return node;
    return table.closest("div");
  }
  // Fallback by heading text
  let chosen = null;
  $(".card-header").each((_, el) => {
    const h3txt = squeeze($(el).find("h3").first().text()).toLowerCase();
    if (h3txt.includes("quarterly results")) {
      chosen = $(el).parent();
      return false;
    }
  });
  return chosen || $();
}

function extractQuarterlyResultsFromHTML(url, html) {
  const $ = cheerio.load(html);
  const cardRoot = findQuarterlyResultsCardRoot($);
  if (!cardRoot || !cardRoot.length) return { rows: [], periods: [] };

  const table = cardRoot.find("#quarterlyResultsTable");
  if (!table.length) return { rows: [], periods: [] };

  // Header periods: skip "Fiscal Period" + "June"
  const periods = [];
  table.find("thead tr").first().find("th").each((i, th) => {
    if (i < 2) return;
    const txt = squeeze($(th).text());
    if (txt) periods.push(txt); // e.g., "2024 Q3", "2025 Q1", ...
  });

  // Fiscal month is shown in header (e.g., "June")
  const fiscalMonth = squeeze(
    table.find("thead tr th").eq(1).text() || ""
  ) || null;

  const out = [];

  table.find("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const first = $tr.find("th").first();
    const metricRaw = squeeze(first.text());
    if (!metricRaw) return;

    // Extract unit if present under metric name
    let unit = null;
    const unitEl = first.find("span i").first();
    if (unitEl.length) unit = squeeze(unitEl.text());

    const isAnnouncement = /^announcement date$/i.test(metricRaw);

    // Gather the *last N* cells matching the number of dynamic periods
    // Some rows use <td>, the first columns may be <th>, so select both.
    const cells = Array.from($tr.find("td,th"));
    if (!cells.length) return;
    const dataCells = cells.slice(-periods.length);

    dataCells.forEach((cell, idx) => {
      const period = periods[idx];
      const $cell = $(cell);

      if (isAnnouncement) {
        const releasedRaw = squeeze($cell.text());
        out.push({
          metric: "Announcement Date",
          unit: null,
          fiscalMonth,
          period,
          released: releasedRaw || null,
          releasedDate: releasedRaw || null, // keep as-is (e.g., "31/07/24" or "-")
          forecast: null,
          spreadRaw: null,
          spreadPct: null,
        });
        return;
      }

      // Typical metric cell layout:
      // <b>Released</b><br><i>Forecast</i><br><b><span>Spread%</span></b>
      const releasedRaw = squeeze($cell.find("b").first().text());
      const forecastRaw = squeeze($cell.find("i").first().text());

      // Spread: prefer an element with %, else fallback to a % pattern anywhere
      let spreadRaw = "";
      const spanWithPct = $cell
        .find("span")
        .filter((_, el) => /%/.test($(el).text()))
        .first();
      if (spanWithPct.length) {
        spreadRaw = squeeze(spanWithPct.text());
      } else {
        const cellTxt = squeeze($cell.text());
        const m = cellTxt.match(/-?\d[\d.,]*\s*%/);
        spreadRaw = m ? squeeze(m[0]) : (cellTxt.includes("-") ? "-" : "");
      }

      out.push({
        metric: metricRaw,          // e.g., "Net sales", "EBIT", "EPS", etc.
        unit: unit || null,         // e.g., "Million INR" or "INR"
        fiscalMonth,                // e.g., "June"
        period,                     // e.g., "2025 Q2"
        released: releasedRaw || null,
        releasedNum: parseNumberLoose(releasedRaw), // optional numeric
        forecast: forecastRaw || null,
        forecastNum: parseNumberLoose(forecastRaw), // optional numeric
        spreadRaw: spreadRaw || (spreadRaw === "-" ? "-" : null),
        spreadPct: parseSpreadPercent(spreadRaw),   // numeric percent if available
      });
    });
  });

  return { rows: out, periods };
}

// ---------- Static (Axios) ----------
async function scrapeStatic(url) {
  const client = axios.create({
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-IN,en;q=0.9",
      Referer: url,
    },
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const { data: html } = await client.get(url);
  return extractQuarterlyResultsFromHTML(url, html);
}

// ---------- Dynamic (Puppeteer) ----------
async function scrapeDynamic(url) {
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-IN,en;q=0.9" });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Nudge the page to render any deferred content
    await sleep(800);

    // Try to find the table by id; fallback by heading text
    let tableHandle = await page.$("#quarterlyResultsTable");
    if (!tableHandle) {
      const handle = await page.evaluateHandle(() => {
        const cards = Array.from(document.querySelectorAll("div.card"));
        for (const card of cards) {
          const h3 = card.querySelector(".card-header h3");
          if (h3 && /quarterly\s+results/i.test(h3.textContent || "")) {
            const t = card.querySelector("#quarterlyResultsTable");
            if (t) return t;
          }
        }
        return null;
      });
      const elem = await handle.asElement();
      if (elem) tableHandle = elem;
    }

    const html = await page.content();
    return extractQuarterlyResultsFromHTML(url, html);
  } finally {
    try {
      await browser.close();
    } catch (_) {}
  }
}

// ---------- helpers ----------
function groupByPeriodAndMetric(results) {
  const out = {};
  for (const row of results) {
    const p = row.period || "unknown";
    if (!out[p]) out[p] = {};
    const key = row.metric; // keep exact text
    out[p][key] = row;      // preserve full row (incl. unit, numbers, etc.)
  }
  return out;
}

// // ---------- main ----------
// (async function main() {
//   try {
//     const { rows, periods } = USE_PUPPETEER
//       ? await scrapeDynamic(CALENDAR_URL)
//       : await scrapeStatic(CALENDAR_URL);

//     const payload = { periods, count: rows.length, results: rows };

//     // 1) Print original structure to stdout (unchanged)
//     console.log(JSON.stringify(payload, null, 2));

//     // 2) Save grouped-by-period-and-metric to file
//     if (WRITE_JSON) {
//       const grouped = groupByPeriodAndMetric(rows);
//       fs.writeFileSync(JSON_PATH, JSON.stringify(grouped, null, 2), "utf8");
//       console.error(`✅ Quarterly Results (grouped) JSON written: ${JSON_PATH}`);
//     }
//   } catch (err) {
//     console.error("❌ Failed to scrape:", err?.message || err);
//     process.exit(2);
//   }
// })();




// ---------- public API ----------
const BASE_HOST = "https://in.marketscreener.com/quote/stock/";

function makeCalendarUrl(companyCode) {
  // companyCode example: "LIFE-INSURANCE-CORPORATIO-137965464"
  return `${BASE_HOST}${companyCode}/calendar/`;
}

/**
 * Public function: fetch quarterly results JSON for a given companyCode.
 * @param {string} companyCode - e.g. "LIFE-INSURANCE-CORPORATIO-137965464"
 * @returns {Promise<object>} payload { periods, count, results } or grouped object if WRITE_JSON=true
 */
async function getQuarterlyResults(companyCode) {
  const url = makeCalendarUrl(companyCode);

  try {
    const { rows, periods } = USE_PUPPETEER
      ? await scrapeDynamic(url)
      : await scrapeStatic(url);

    if (WRITE_JSON) {
      return groupByPeriodAndMetric(rows);
    }
    return { periods, count: rows.length, results: rows };
  } catch (err) {
    // Let caller handle null / errors as needed
    console.error("❌ Failed to scrape:", err?.message || err);
    return null;
  }
}

// Export for external usage
module.exports = {
  getQuarterlyResults
};