// upcoming_events.js (CommonJS)
// Scrapes ONLY the "Upcoming" events for Eternal Limited from MarketScreener.
// Prints JSON to stdout and writes upcoming_events.csv
//
// Usage: node upcoming_events.js

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const CALENDAR_URL =
  "https://in.marketscreener.com/quote/stock/ETERNAL-LIMITED-125138034/calendar/";

// --- toggles ---
const WRITE_CSV = true;
const USE_PUPPETEER = true; // set false to fall back to Axios+Cheerio (no JS)
const CSV_PATH = path.resolve(__dirname, "upcoming_events.csv");

// ---------- utils ----------
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Normalize whitespace
const squeeze = (s) => (s || "").replace(/\s+/g, " ").trim();

/**
 * Parse date strings in any of these forms into ISO:
 *  - "21/07/2025 05:00 pm"
 *  - "21/07/2025"
 *  - "2025-01-20 04:37 am"
 *  - "2024-12-04"
 */
function parseDdMmYyyyTimeToISO(raw) {
  if (!raw) return null;
  const t = squeeze(raw);

  // yyyy-mm-dd[ hh:mm am/pm]?
  let m = t.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?$/i
  );
  if (m) {
    const [, yyyy, mm, dd, hh, min, ap] = m;
    let H = hh ? parseInt(hh, 10) : 0;
    const M = min ? parseInt(min, 10) : 0;
    if (ap) {
      const apLow = ap.toLowerCase();
      if (apLow === "pm" && H < 12) H += 12;
      if (apLow === "am" && H === 12) H = 0;
    }
    const d = new Date(+yyyy, +mm - 1, +dd, H, M, 0, 0);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // dd/mm/yyyy[ hh:mm am/pm]?
  m = t.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?$/i
  );
  if (m) {
    const [, dd, mm, yyyy, hh, min, ap] = m;
    let H = hh ? parseInt(hh, 10) : 0;
    const M = min ? parseInt(min, 10) : 0;
    if (ap) {
      const apLow = ap.toLowerCase();
      if (apLow === "pm" && H < 12) H += 12;
      if (apLow === "am" && H === 12) H = 0;
    }
    const d = new Date(+yyyy, +mm - 1, +dd, H, M, 0, 0);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null; // unknown format
}

function toCSV(rows) {
  const esc = (v) =>
    v == null
      ? ""
      : /[",\n]/.test(String(v))
      ? `"${String(v).replace(/"/g, '""')}"`
      : String(v);
  const header = [
    "section",
    "dateTimeRaw",
    "dateTimeISO",
    "title",
    "icsUrl",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        esc(r.section),
        esc(r.dateTimeRaw),
        esc(r.dateTimeISO),
        esc(r.title),
        esc(r.icsUrl),
      ].join(",")
    );
  }
  return lines.join("\n");
}

function extractUpcomingFromHTML(url, html) {
  const $ = cheerio.load(html);
  const results = [];
  const origin = new URL(url).origin;

  $("#next-events-card table tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length >= 2) {
      const dateTimeRaw = squeeze($(tds[0]).text());
      const title = squeeze($(tds[1]).text());
      const icsRel = $(tds[1]).find('a[href$=".ics"]').attr("href") || null;
      const icsUrl = icsRel
        ? icsRel.startsWith("/")
          ? origin + icsRel
          : icsRel
        : null;

      if (!dateTimeRaw && !title) return;

      results.push({
        section: "Upcoming",
        dateTimeRaw,
        dateTimeISO: parseDdMmYyyyTimeToISO(dateTimeRaw),
        title,
        icsUrl,
      });
    }
  });

  return results;
}

// ---------- Static (Axios) path (no JS) ----------
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
  return extractUpcomingFromHTML(url, html);
}

// ---------- Dynamic (Puppeteer) path (executes JS) ----------
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

    try {
      await page.waitForSelector("#next-events-card", { timeout: 20000 });
    } catch (_) {}

    // Some pages require a tiny delay for the table rows to render
    await sleep(600);

    const html = await page.content();
    return extractUpcomingFromHTML(url, html);
  } finally {
    try {
      await browser.close();
    } catch (_) {}
  }
}

// (async function main() {
//   try {
//     const events = USE_PUPPETEER
//       ? await scrapeDynamic(CALENDAR_URL)
//       : await scrapeStatic(CALENDAR_URL);

//     // Print JSON to stdout
//     console.log(JSON.stringify({ count: events.length, events }, null, 2));

//     if (WRITE_CSV) {
//       const csv = toCSV(events);
//       fs.writeFileSync(CSV_PATH, csv, "utf8");
//       console.error(`✅ Upcoming CSV written: ${CSV_PATH} (${events.length} rows)`);
//     }
//   } catch (err) {
//     console.error("❌ Failed to scrape:", err?.message || err);
//     process.exit(2);
//   }
// })();




async function getUpcomingEvents(companyCode) {
  const url = `https://in.marketscreener.com/quote/stock/${companyCode}/calendar/`;

  try {
    const events = USE_PUPPETEER
      ? await scrapeDynamic(url)
      : await scrapeStatic(url);

    return {
      count: events.length,
      events,
    };
  } catch (err) {
    console.error(`❌ Failed to scrape:`, err?.message || err);
    return null;
  }
}

// Export for programmatic use
module.exports = {
  getUpcomingEvents,
};
