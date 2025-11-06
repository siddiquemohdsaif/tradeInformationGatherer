// getLatestOutstandingShare.js

const axios = require("axios");
const cheerio = require("cheerio");

const USE_PUPPETEER = false;

// utils
const squeeze = (s) => (s || "").replace(/\s+/g, " ").trim();
function parseNumberLoose(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t || t === "-" || /^n\/a$/i.test(t)) return null;
  let x = t.replace(/\s+/g, "").replace(/,/g, "");
  if (!/^[-]?\d*\.?\d+$/.test(x)) return null;
  const val = Number(x);
  return Number.isFinite(val) ? val : null;
}
function pickRightmostNonNull(values) {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) return { idx: i, value: values[i] };
  }
  return null;
}

// extraction
function extractNbrOfStocksFromHTML(html) {
  const $ = cheerio.load(html);
  let targetTr = null;

  $("tr").each((_, tr) => {
    const firstCell = $(tr).find("th,td").first();
    const label = squeeze(firstCell.text()).toLowerCase();
    if (/nbr\s*of\s*stocks/i.test(label)) {
      targetTr = $(tr);
      return false;
    }
  });

  if (!targetTr?.length) return { latestThousands: null };

  const cells = targetTr.find("td,th").toArray().slice(1);
  const numsThousands = cells.map((el) => parseNumberLoose(squeeze($(el).text())));
  const pick = pickRightmostNonNull(numsThousands);

  return { latestThousands: pick ? pick.value : null };
}

// fetchers
async function fetchStatic(url) {
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
  return extractNbrOfStocksFromHTML(html);
}

async function fetchDynamic(url) {
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
    const html = await page.content();
    return extractNbrOfStocksFromHTML(html);
  } finally {
    try { await browser.close(); } catch {}
  }
}

/**
 * Always returns absolute outstanding shares (number), or null if not found.
 * @param {string} companyCodeOrPath e.g. "ITC-LIMITED-9743470" or "ITC-LIMITED-9743470/valuation/"
 * @returns {Promise<number|null>}
 */
async function getLatestOutstandingShare(companyCodeOrPath) {
  const suffix = companyCodeOrPath.includes("/valuation")
    ? companyCodeOrPath
    : `${companyCodeOrPath}/valuation/`;
  const url = `https://in.marketscreener.com/quote/stock/${suffix}`;

  try {
    const { latestThousands } = USE_PUPPETEER ? await fetchDynamic(url) : await fetchStatic(url);
    return latestThousands != null ? latestThousands * 1000 : null;
  } catch (err) {
    console.error("❌ Failed to fetch outstanding shares:", err?.message || err);
    return null;
  }
}

// ---------- CLI ----------
if (require.main === module) {
  (async () => {
    const code = process.argv[2] || "ITC-LIMITED-9743470";
    const valueShares = await getLatestOutstandingShare(code);
    // Print only the number (or empty string if unavailable)
    console.log(valueShares ?? "");
  })();
}

module.exports = { getLatestOutstandingShare };
