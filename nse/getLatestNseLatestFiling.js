
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const NSE_URL =
  "https://www.nseindia.com/companies-listing/corporate-integrated-filing?integratedType=integratedfilingfinancials";

// ====== TUNABLES ======
const STARTUP_NAV_TIMEOUT_MS = 60_000;
const SELECTORS = {
  tableRows: "#CFintegratedfilingTable tbody tr",
  refreshButton: ".refreshIcon.refreshFiling a",
};
const SEEN_FILE = path.resolve(__dirname, "seen_nse_integrated.json");
// ======================

function loadSeen() {
  try {
    if (fs.existsSync(SEEN_FILE)) {
      const raw = fs.readFileSync(SEEN_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.seen)) {
        return new Set(parsed.seen);
      }
    }
  } catch (e) {
    console.warn("[nse_api] Could not read seen file:", e.message);
  }
  return new Set();
}

function saveSeen(seenSet) {
  try {
    const arr = Array.from(seenSet);
    fs.writeFileSync(SEEN_FILE, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.warn("[nse_api] Could not write seen file:", e.message);
  }
}

/**
 * Scrape the first page of the Integrated Filing table.
 * Returns [{ key, symbol, company, quarterEnd, type, audited, basis, detailsHref, xbrlHref, broadcast, revised, remarks }]
 */
async function scrapeRows(page) {
  await page.waitForSelector(SELECTORS.tableRows, { timeout: 45_000 });

  const rows = await page.evaluate(() => {
    const q = (root, sel) => {
      const el = root.querySelector(sel);
      return el ? el.textContent.trim() : "";
    };
    const attr = (root, sel, name) => {
      const el = root.querySelector(sel);
      return el ? el.getAttribute(name) || "" : "";
    };

    const out = [];
    const rows = document.querySelectorAll("#CFintegratedfilingTable tbody tr");
    rows.forEach((tr) => {
      const tds = tr.querySelectorAll("td");
      if (!tds || tds.length < 8) return;

      const symbol = q(tds[0], "a") || tds[0].textContent.trim();
      const company = tds[1]?.textContent.trim() || "";
      const quarterEnd = tds[2]?.textContent.trim() || "";

      const type = tds[3]?.textContent.trim() || "";        // Type of Submission
      const audited = tds[4]?.textContent.trim() || "";     // Audited/Un-Audited
      const basis = tds[5]?.textContent.trim() || "";       // Consolidated/Standalone

      // "Details" link (ixbrl or details)
      let detailsHref =
        attr(tds[6], 'a[href^="https://nsearchives.nseindia.com/corporate/ixbrl/"]', "href") ||
        attr(tds[6], "a[href]", "href") ||
        "";

      // XBRL XML link
      let xbrlHref = attr(tds[7], 'a[href$=".xml"]', "href") || "";

      const broadcast = tds[8]?.innerText?.trim() || "";
      const revised = tds[9]?.innerText?.trim() || "";
      const remarks = tds[10]?.innerText?.trim() || "";

      // Strong key
      const key = xbrlHref || detailsHref || `${symbol}|${quarterEnd}|${broadcast}`;

      out.push({
        key,
        symbol,
        company,
        quarterEnd,
        type,
        audited,
        basis,
        detailsHref,
        xbrlHref,
        broadcast,
        revised,
        remarks,
      });
    });
    return out;
  });

  return rows;
}

/**
 * One-shot runner: opens page like first time, scrapes rows, returns newly discovered + all rows.
 * @param {Object} options
 * @param {boolean|string} [options.headless="new"]
 * @returns {Promise<{ newItems: Array, allRows: Array }>}
 */
async function getLatestNseLatestFiling(options = {}) {
  const { headless = "new" } = options;

  const seen = loadSeen();
  console.log(`[nse_api] Loaded ${seen.size} previously seen entries`);

  const browser = await puppeteer.launch({
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--lang=en-US,en;q=0.9",
    ],
    defaultViewport: { width: 1400, height: 1000, deviceScaleFactor: 1 },
  });

  let page;
  try {
    page = await browser.newPage();

    // Mimic a real browser as NSE is picky
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36"
    );

    console.log("[nse_api] Navigating to:", NSE_URL);
    await page.goto(NSE_URL, { waitUntil: "networkidle2", timeout: STARTUP_NAV_TIMEOUT_MS });

    const allRows = await scrapeRows(page);
    if (!allRows || allRows.length === 0) {
      console.warn("[nse_api] No rows found");
      return { newItems: [], allRows: [] };
    }

    const newItems = allRows.filter((r) => r.key && !seen.has(r.key));

    if (newItems.length > 0) {
      console.log(`[nse_api] Found ${newItems.length} new filing(s)`);
      // Mark as seen
      for (const item of newItems) seen.add(item.key);
      saveSeen(seen);
    } else {
      console.log("[nse_api] No new filings");
    }

    return { newItems, allRows };
  } finally {
    try { await browser.close(); } catch (_) {}
  }
}

// ===== CLI: run once and print results, then exit =====
if (require.main === module) {
  getLatestNseLatestFiling({ headless: "new" })
    .then(({ newItems }) => {
      // Print concise lines for new items only
      if (newItems.length === 0) {
        console.log("[]");
        return;
      }
      newItems.forEach((item) => {
        console.log(
          `NEW: ${item.symbol} | ${item.company} | ${item.quarterEnd} | ${item.type} | ` +
            `Audited:${item.audited} | ${item.basis} | Broadcast:${item.broadcast}\n` +
            `XBRL: ${item.xbrlHref || "-"}\nDetails: ${item.detailsHref || "-"}\n`
        );
      });
    })
    .catch((e) => {
      console.error("[nse_api] Fatal error:", e?.message || e);
      process.exit(1);
    });
}

module.exports = { getLatestNseLatestFiling };
