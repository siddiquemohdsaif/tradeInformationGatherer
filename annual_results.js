// anual_result.js (CommonJS)
// Scrapes ONLY the "Annual results" card: dynamic header years + per-metric Released/Forecast/Spread.
// Prints JSON to stdout and writes anual_results.json
//
// Usage: node anual_result.js

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// Example calendar page (Bank of Baroda)
const CALENDAR_URL =
  "https://in.marketscreener.com/quote/stock/ITC-LIMITED-9743470/calendar/";

const WRITE_JSON = true;
const USE_PUPPETEER = true;
const JSON_PATH = path.resolve(__dirname, "anual_results.json");

// ---------- utils ----------
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const squeeze = (s) => (s || "").replace(/\s+/g, " ").trim();

function parseNumberLoose(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t || t === "-" || /^n\/a$/i.test(t)) return null;
  let x = t.replace(/\s+/g, "");
  if (x.includes(",") && !x.includes(".")) {
    x = x.replace(/,/g, ".");
  } else {
    x = x.replace(/,/g, "");
  }
  const val = Number(x);
  return Number.isFinite(val) ? val : null;
}

// ---------- HTML extraction ----------
function findAnnualResultsCardRoot($) {
  const table = $("#anualResultsTable");
  if (table.length) {
    let node = table.closest("div.card");
    if (node.length) return node;
    return table.closest("div");
  }
  let chosen = null;
  $(".card-header").each((_, el) => {
    const h3txt = squeeze($(el).find("h3").first().text()).toLowerCase();
    if (h3txt.includes("annual results")) {
      chosen = $(el).parent();
      return false;
    }
  });
  return chosen || $();
}

function extractAnnualResultsFromHTML(url, html) {
  const $ = cheerio.load(html);
  const cardRoot = findAnnualResultsCardRoot($);
  if (!cardRoot || !cardRoot.length) return { rows: [], years: [] };

  const table = cardRoot.find("#anualResultsTable");
  if (!table.length) return { rows: [], years: [] };

  const years = [];
  table.find("thead tr").first().find("th").each((i, th) => {
    if (i < 2) return; // skip "Fiscal Period" + "March"
    const txt = squeeze($(th).text());
    if (/^\d{4}$/.test(txt)) years.push(txt);
  });

  const fiscalMonth = "March";
  const out = [];

  table.find("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const first = $tr.find("th").first();
    const metricRaw = squeeze(first.text());
    if (!metricRaw) return;

    let unit = null;
    const unitEl = first.find("span i").first();
    if (unitEl.length) unit = squeeze(unitEl.text());

    const isAnnouncement = /^announcement date$/i.test(metricRaw);

    const tds = $tr.find("td,th");
    if (!tds.length) return;

    const dataCells = Array.from(tds).slice(-years.length);

    dataCells.forEach((cell, idx) => {
      const year = years[idx];
      const $cell = $(cell);

      if (isAnnouncement) {
        const releasedRaw = squeeze($cell.text());
        out.push({
          metric: "Announcement Date",
          unit: null,
          fiscalMonth,
          year,
          released: releasedRaw || null,
          forecast: null,
          spreadRaw: null,
        });
        return;
      }

      const releasedRaw = squeeze($cell.find("b").first().text());
      const forecastRaw = squeeze($cell.find("i").first().text());

      let spreadRaw = "";
      const spanWithPct = $cell.find("span").filter((_, el) => /%/.test($(el).text())).first();
      if (spanWithPct.length) {
        spreadRaw = squeeze(spanWithPct.text());
      } else {
        const cellTxt = squeeze($cell.text());
        const m = cellTxt.match(/-?\d[\d.,]*\s*%/);
        spreadRaw = m ? squeeze(m[0]) : (cellTxt.includes("-") ? "-" : "");
      }

      out.push({
        metric: metricRaw,
        unit: unit || null,
        fiscalMonth,
        year,
        released: releasedRaw || null,
        forecast: forecastRaw || null,
        spreadRaw: spreadRaw || (spreadRaw === "-" ? "-" : null),
      });
    });
  });

  return { rows: out, years };
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
  return extractAnnualResultsFromHTML(url, html);
}

// ---------- Dynamic (Puppeteer) ----------
async function scrapeDynamic(url) {
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-IN,en;q=0.9" });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    let tableHandle = await page.$("#anualResultsTable");
    if (!tableHandle) {
      const handle = await page.evaluateHandle(() => {
        const cards = Array.from(document.querySelectorAll("div.card"));
        for (const card of cards) {
          const h3 = card.querySelector(".card-header h3");
          if (h3 && /annual\s+results/i.test(h3.textContent || "")) {
            const t = card.querySelector("#anualResultsTable");
            if (t) return t;
          }
        }
        return null;
      });
      const elem = await handle.asElement();
      if (elem) tableHandle = elem;
    }

    await sleep(800);
    const html = await page.content();
    return extractAnnualResultsFromHTML(url, html);
  } finally {
    try { await browser.close(); } catch (_) {}
  }
}


function groupByYearAndMetric(results) {
  const out = {};
  for (const row of results) {
    const y = row.year || "unknown";
    if (!out[y]) out[y] = {};
    const key = row.metric; // keep exact text (e.g., "Net salesMillion INR")
    out[y][key] = row;      // keep the entire object as you showed (incl. year)
  }
  return out;
}

// // ---------- main ----------
// (async function main() {
//   try {
//     const { rows, years } = USE_PUPPETEER
//       ? await scrapeDynamic(CALENDAR_URL)
//       : await scrapeStatic(CALENDAR_URL);

//     const payload = { years, count: rows.length, results: rows };

//     // 1) Print original structure to stdout (unchanged)
//     console.log(JSON.stringify(payload, null, 2));

//     // 2) Save grouped-by-year-and-metric to file
//     if (WRITE_JSON) {
//       const grouped = groupByYearAndMetric(rows);
//       fs.writeFileSync(JSON_PATH, JSON.stringify(grouped, null, 2), "utf8");
//       console.error(`✅ Annual Results (grouped) JSON written: ${JSON_PATH}`);
//     }
//   } catch (err) {
//     console.error("❌ Failed to scrape:", err?.message || err);
//     process.exit(2);
//   }
// })();



async function getAnnualResults(companyCode) {
  const url = `https://in.marketscreener.com/quote/stock/${companyCode}/calendar/`;

  try {
    const { rows, years } = USE_PUPPETEER
      ? await scrapeDynamic(url)
      : await scrapeStatic(url);

    if (WRITE_JSON) {
      return groupByYearAndMetric(rows);
    }
    return {
      years,
      count: rows.length,
      results: rows,
    };
  } catch (err) {
    console.error(`❌ Failed to scrape:`, err?.message || err);
    return null;
  }
}

// Export function for use in other scripts
module.exports = {
  getAnnualResults,
};