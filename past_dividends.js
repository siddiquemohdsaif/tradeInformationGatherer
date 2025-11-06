// past_dividends.js (CommonJS, fixed selectors)
// Scrapes ONLY the "Past dividends" card from MarketScreener calendar pages.
// Handles "See more" + infinite scroll. Prints JSON and writes past_dividends.csv.
//
// Usage: node past_dividends.js

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// Example (Bank of Baroda):
const CALENDAR_URL =
  "https://in.marketscreener.com/quote/stock/ITC-LIMITED-9743470/calendar/";

const WRITE_CSV = true;
const USE_PUPPETEER = true;
const CSV_PATH = path.resolve(__dirname, "past_dividends.csv");

// ---------- utils ----------
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const squeeze = (s) => (s || "").replace(/\s+/g, " ").trim();

// yyyy-mm-dd or dd/mm/yyyy -> ISO
function parseDateToISO(raw) {
  if (!raw) return null;
  const t = squeeze(raw);

  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+.*)?$/);
  if (m) {
    const [, yyyy, mm, dd] = m;
    const d = new Date(+yyyy, +mm - 1, +dd);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(+yyyy, +mm - 1, +dd);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

// "Annual 8.35 INR" | "Final Payment 10.5 INR" | "Interim Payment 11 INR"
function parseDividendText(txt) {
  const full = squeeze(txt);
  const m = full.match(/^([A-Za-z ]+)\s+([\d.,]+)\s*([A-Z]{3})?$/);
  if (!m) {
    return { type: full || null, amount: null, currency: null, title: full };
  }
  const [, typeRaw, amtRaw, ccyRaw] = m;
  const type = squeeze(typeRaw);
  const amount = parseFloat(String(amtRaw).replace(/,/g, ""));
  const currency = ccyRaw || null;
  return { type, amount: isNaN(amount) ? null : amount, currency, title: full };
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
    "dateRaw",
    "dateISO",
    "type",
    "amount",
    "currency",
    "title",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        esc(r.section),
        esc(r.dateRaw),
        esc(r.dateISO),
        esc(r.type),
        esc(r.amount),
        esc(r.currency),
        esc(r.title),
      ].join(",")
    );
  }
  return lines.join("\n");
}

function findDividendsCardRoot($) {
  let root = $("#past-dividends-card");
  if (root.length) return root;

  // Fallback: card whose h3 contains "Past dividends"
  let chosen = null;
  $(".card-header").each((_, el) => {
    const h3txt = squeeze($(el).find("h3").first().text()).toLowerCase();
    if (h3txt.includes("past dividends")) {
      chosen = $(el).parent(); // card wrapper
      return false;
    }
  });
  return chosen || $();
}

function extractPastDividendsFromHTML(url, html) {
  const $ = cheerio.load(html);
  const results = [];
  const cardRoot = findDividendsCardRoot($);
  if (!cardRoot || !cardRoot.length) return results;

  cardRoot.find("table tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length >= 2) {
      const dateRaw = squeeze($(tds[0]).text());
      const infoTxt = squeeze($(tds[1]).text());
      if (!dateRaw && !infoTxt) return;

      const { type, amount, currency, title } = parseDividendText(infoTxt);
      results.push({
        section: "Past Dividends",
        dateRaw,
        dateISO: parseDateToISO(dateRaw),
        type,
        amount,
        currency,
        title,
      });
    }
  });

  return results;
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
  return extractPastDividendsFromHTML(url, html);
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

    // Try ID first; else locate by heading text (no non-standard selectors)
    let cardHandle = await page.$("#past-dividends-card");
    if (!cardHandle) {
      // Find a card whose .card-header h3 includes "Past dividends"
      const handle = await page.evaluateHandle(() => {
        const cards = Array.from(document.querySelectorAll("div.card"));
        for (const card of cards) {
          const h3 = card.querySelector(".card-header h3");
          if (h3 && /past\s+dividends/i.test(h3.textContent || "")) {
            return card;
          }
        }
        return null;
      });
      const elem = await handle.asElement();
      if (elem) cardHandle = elem;
    }
    if (!cardHandle) {
      // small grace wait in case of lazy render
      await sleep(1000);
      cardHandle = await page.$("#past-dividends-card");
    }

    // Click "See more" if present inside located card
    if (cardHandle) {
      const seeMore = await cardHandle.$("button.btn");
      if (seeMore) {
        await seeMore.click().catch(() => {});
        await sleep(600);
      }
    }

    // Determine the scrollable container INSIDE this card
    let scrollTarget = null;
    if (cardHandle) {
      scrollTarget =
        (await cardHandle.$(".card-content--h400")) ||
        (await cardHandle.$(".card-content")) ||
        (await cardHandle.$("#dividendScrollCard"));
    }

    // Infinite scroll within card
    if (scrollTarget) {
      let stablePasses = 0;
      let lastCount = -1;

      for (let i = 0; i < 50 && stablePasses < 3; i++) {
        const beforeCount = await cardHandle.$$eval("table tr", (rows) => rows.length);

        await scrollTarget.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });

        await sleep(900);

        const afterCount = await cardHandle.$$eval("table tr", (rows) => rows.length);

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
    return extractPastDividendsFromHTML(url, html);
  } finally {
    try {
      await browser.close();
    } catch (_) {}
  }
}

// (async function main() {
//   try {
//     const rows = USE_PUPPETEER
//       ? await scrapeDynamic(CALENDAR_URL)
//       : await scrapeStatic(CALENDAR_URL);

//     console.log(JSON.stringify({ count: rows.length, dividends: rows }, null, 2));

//     if (WRITE_CSV) {
//       const csv = toCSV(rows);
//       fs.writeFileSync(CSV_PATH, csv, "utf8");
//       console.error(
//         `✅ Past Dividends CSV written: ${CSV_PATH} (${rows.length} rows)`
//       );
//     }
//   } catch (err) {
//     console.error("❌ Failed to scrape:", err?.message || err);
//     process.exit(2);
//   }
// })();




async function getPastDividends(companyCode) {
  const url = `https://in.marketscreener.com/quote/stock/${companyCode}/calendar/`;

  try {
    const rows = USE_PUPPETEER
      ? await scrapeDynamic(url)
      : await scrapeStatic(url);

    return {
      count: rows.length,
      dividends: rows,
    };
  } catch (err) {
    console.error(`❌ Failed to scrape:`, err?.message || err);
    return null;
  }
}

// Export for programmatic use
module.exports = {
  getPastDividends,
};