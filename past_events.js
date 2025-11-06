// past_events.js (CommonJS)
// Scrapes ONLY the "Past events" for Eternal Limited from MarketScreener.
// Handles "See more" and infinite scroll to load all rows.
// Prints JSON to stdout and writes past_events.csv
//
// Usage: node past_events.js

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const CALENDAR_URL =
  "https://in.marketscreener.com/quote/stock/LIFE-INSURANCE-CORPORATIO-137965464/calendar/";

// --- toggles ---
const WRITE_CSV = true;
const USE_PUPPETEER = true; // set false to fall back to Axios+Cheerio (no JS)
const CSV_PATH = path.resolve(__dirname, "past_events.csv");

// ---------- utils ----------
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const squeeze = (s) => (s || "").replace(/\s+/g, " ").trim();

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

  return null;
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

function extractPastFromHTML(url, html) {
  const $ = cheerio.load(html);
  const results = [];
  const origin = new URL(url).origin;

  $("#past-events-card table tr").each((_, tr) => {
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
        section: "Past",
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
  return extractPastFromHTML(url, html);
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

    // Wait for the Past card to appear
    try {
      await page.waitForSelector("#past-events-card", { timeout: 30000 });
    } catch (_) {}

    // Click "See more" (sometimes shows hidden rows)
    const seeMoreSel =
      '#past-events-card .card-content button.btn.btn--action--outter';
    if (await page.$(seeMoreSel)) {
      await page.click(seeMoreSel).catch(() => {});
      await sleep(500);
    }

    // Infinite load: scroll the past-events container until no more rows appear
    const scrollSelCandidates = [
      "#past-events-card .card-content--h400",
      "#past-events-card .card-content",
    ];
    let scrollSel = null;
    for (const sel of scrollSelCandidates) {
      if (await page.$(sel)) {
        scrollSel = sel;
        break;
      }
    }

    if (scrollSel) {
      let stablePasses = 0;
      let lastCount = -1;

      for (let i = 0; i < 50 && stablePasses < 3; i++) {
        const beforeCount = await page.$$eval(
          "#past-events-card table tr",
          (rows) => rows.length
        );

        await page.evaluate((sel) => {
          const box = document.querySelector(sel);
          if (box) box.scrollTop = box.scrollHeight;
        }, scrollSel);

        await sleep(900);

        const afterCount = await page.$$eval(
          "#past-events-card table tr",
          (rows) => rows.length
        );

        if (afterCount === beforeCount) {
          if (lastCount === afterCount) {
            stablePasses += 1;
          } else {
            stablePasses = 1;
            lastCount = afterCount;
          }
        } else {
          stablePasses = 0;
          lastCount = afterCount;
        }
      }
    } else {
      // Fallback: small delay for any lazy renders
      await sleep(600);
    }

    const html = await page.content();
    return extractPastFromHTML(url, html);
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
//       console.error(`✅ Past CSV written: ${CSV_PATH} (${events.length} rows)`);
//     }
//   } catch (err) {
//     console.error("❌ Failed to scrape:", err?.message || err);
//     process.exit(2);
//   }
// })();



async function getPastEvents(companyCode) {
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

// Export for use in other scripts
module.exports = {
  getPastEvents,
};