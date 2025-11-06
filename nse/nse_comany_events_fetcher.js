#!/usr/bin/env node
/**
 * nse_comany_events_fetcher.js
 * - Calls:  /api/corp-info?symbol=<SYMBOL>&corpType=eventcalender&market=equities&series=EQ
 * - Returns: ALL fields from the API (no trimming) + a few normalized extras.
 *
 * Extras added:
 *   - symbol_norm:  uppercased symbol (bm_symbol || symbol || input)
 *   - date_iso:     YYYY-MM-DD from bm_date (e.g., 17-Oct-2025 → 2025-10-17)
 *   - ts_iso:       ISO from bm_timestamp_full (YYYY-MM-DD HH:mm:ss → YYYY-MM-DDTHH:mm:ss)
 *
 * CLI:
 *   node nse_comany_events_fetcher.js BANKINDIA
 *   node nse_comany_events_fetcher.js BANKINDIA --since 2024-01-01 --until 2025-10-18
 *   node nse_comany_events_fetcher.js BANKINDIA --json out.json
 *   node nse_comany_events_fetcher.js BANKINDIA --csv out.csv
 *   node nse_comany_events_fetcher.js BANKINDIA --save-attachments ./attachments
 *   node nse_comany_events_fetcher.js BANKINDIA --show --debug
 */

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const https = require("https");

const NSE_HOME = "https://www.nseindia.com/";
const GET_QUOTES_TPL = "https://www.nseindia.com/get-quotes/equity?symbol={SYMBOL}";
const CORP_INFO_TPL =
  "https://www.nseindia.com/api/corp-info?symbol={SYMBOL}&corpType=eventcalender&market={MARKET}&series={SERIES}";

// Mobile UA (matches what NSE often serves on quotes page; plays nice with Akamai)
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function toISOFromNSE(ddMmmYyyy) {
  if (!ddMmmYyyy) return null;
  const map = { Jan:"01", Feb:"02", Mar:"03", Apr:"04", May:"05", Jun:"06",
                Jul:"07", Aug:"08", Sep:"09", Oct:"10", Nov:"11", Dec:"12" };
  const m = ddMmmYyyy.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const dd = String(m[1]).padStart(2, "0");
  const mm = map[m[2]];
  if (!mm) return null;
  return `${m[3]}-${mm}-${dd}`;
}

function toISODateTime(yyyy_mm_dd_hh_mm_ss) {
  // "2025-10-13 16:28:41" → "2025-10-13T16:28:41"
  if (!yyyy_mm_dd_hh_mm_ss) return null;
  const s = String(yyyy_mm_dd_hh_mm_ss).trim();
  if (!/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(s)) return null;
  return s.replace(" ", "T");
}

function withinRange(iso, sinceISO, untilISO) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  if (sinceISO && d < new Date(sinceISO)) return false;
  if (untilISO && d > new Date(untilISO)) return false;
  return true;
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function objectsToCSV(rows) {
  // Build dynamic header = union of keys across all rows
  const cols = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set())
  ).sort();

  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => csvEscape(r[c])).join(","));
  }
  return lines.join("\n");
}

/** Browser-context fetch so cookies, referer and CORS are correct. */
async function fetchFromBrowser(page, url, referer, tries = 6) {
  return page.evaluate(
    async ({ url, referer, tries }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let lastErr;
      for (let i = 1; i <= tries; i++) {
        try {
          const resp = await fetch(url, {
            method: "GET",
            headers: {
              "accept": "application/json, text/plain, */*",
              "accept-encoding": "gzip, deflate, br, zstd",
              "accept-language": "en-US,en;q=0.9",
              "cache-control": "no-cache",
              "pragma": "no-cache",
              "referer": referer,
            },
            credentials: "include",
          });
          if (!resp.ok) {
            const t = await resp.text().catch(() => "");
            throw new Error(`HTTP ${resp.status} ${resp.statusText} ${t.slice(0, 200)}`);
          }
          return await resp.json();
        } catch (e) {
          lastErr = e;
          await sleep(350 * i);
        }
      }
      throw lastErr || new Error("Fetch failed after retries");
    },
    { url, referer, tries }
  );
}

async function downloadFile(url, outPath) {
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          file.close(); fs.unlink(outPath, () => {});
          return reject(new Error(`Download failed: ${res.statusCode} ${res.statusMessage}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        file.close(); fs.unlink(outPath, () => {});
        reject(err);
      });
  });
}

async function run(symbol, { since, until, jsonOut, csvOut, headful, debug, market, series, saveAttachments }) {
  const sinceISO = since || "2005-01-01";
  const untilISO = until || new Date().toISOString().slice(0, 10);
  const MARKET = (market || "equities").trim();
  const SERIES = (series || "EQ").trim();

  const launchOpts = {
    headless: headful ? false : true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  };
  if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;

  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(MOBILE_UA);
    if (page.setViewport) await page.setViewport({ width: 414, height: 896, isMobile: true, deviceScaleFactor: 2 });

    if (page.setRequestInterception) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const type = req.resourceType && req.resourceType();
        if (type && ["image", "font", "media"].includes(type)) return req.abort();
        return req.continue();
      });
    }

    // Warm cookies
    await page.goto(NSE_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(600);

    const referer = GET_QUOTES_TPL.replace("{SYMBOL}", encodeURIComponent(symbol));
    await page.goto(referer, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await sleep(1200);

    const apiUrl = CORP_INFO_TPL
      .replace("{SYMBOL}", encodeURIComponent(symbol))
      .replace("{MARKET}", encodeURIComponent(MARKET))
      .replace("{SERIES}", encodeURIComponent(SERIES));

    if (debug) console.log(`[debug] GET ${apiUrl}`);

    const body = await fetchFromBrowser(page, apiUrl, referer, 8);
    const arr = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    if (debug) console.log(`[debug] rows from corp-info: ${arr.length}`);

    const wantSymbol = symbol.toUpperCase();

    // Keep ALL fields, add normalized ones, then date-range filter
    const enriched = arr
      .filter((it) => {
        // accept all rows for this endpoint; optional tighten by symbol
        const sym = (it?.bm_symbol || it?.symbol || "").toUpperCase();
        return !sym || sym === wantSymbol;
      })
      .map((it) => {
        const dateIso = toISOFromNSE(it.bm_date || "");
        const tsIso = toISODateTime(it.bm_timestamp_full || "");
        const symbol_norm = (it.bm_symbol || it.symbol || wantSymbol).toUpperCase();
        return {
          ...it,                // <- keep original API fields intact
          symbol_norm,          // normalized symbol
          date_iso: dateIso,    // normalized meeting date
          ts_iso: tsIso,        // normalized timestamp
        };
      })
      // Range on the normalized date (fallback to bm_dt if present)
      .filter((r) => {
        const iso = r.date_iso || (r.bm_dt ? String(r.bm_dt).slice(0, 10) : null);
        return withinRange(iso, sinceISO, untilISO);
      })
      .sort((a, b) => {
        const da = a.date_iso || (a.bm_dt ? String(a.bm_dt).slice(0, 10) : "");
        const db = b.date_iso || (b.bm_dt ? String(b.bm_dt).slice(0, 10) : "");
        return da < db ? -1 : da > db ? 1 : 0;
      });

    if (debug) console.log(`[debug] matched after filter: ${enriched.length}`);

    // Save attachments if requested
    if (saveAttachments) {
      const dir = path.resolve(String(saveAttachments));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let saved = 0;
      for (const it of enriched) {
        const url = it.bm_attachment || it.attachment || null;
        if (!url) continue;
        const name =
          path.basename(url.split("?")[0]) ||
          `${it.bm_symbol || it.symbol || wantSymbol}_${it.bm_an_seq_id || Date.now()}.pdf`;
        const out = path.join(dir, name);
        try {
          await downloadFile(url, out);
          saved++;
          if (debug) console.log(`[debug] saved: ${out}`);
        } catch (e) {
          if (debug) console.log(`[debug] failed: ${url} → ${e.message}`);
        }
      }
      if (saved) console.log(`Downloaded attachments: ${saved}`);
    }

    if (jsonOut) {
      fs.writeFileSync(jsonOut, JSON.stringify({ symbol: wantSymbol, count: enriched.length, items: enriched }, null, 2), "utf8");
      console.log(`Wrote JSON: ${jsonOut} (${enriched.length} rows)`);
    }
    if (csvOut) {
      fs.writeFileSync(csvOut, objectsToCSV(enriched), "utf8");
      console.log(`Wrote CSV:  ${csvOut} (${enriched.length} rows)`);
    }

    if (!jsonOut && !csvOut) {
      console.log(JSON.stringify({ symbol: wantSymbol, count: enriched.length, items: enriched }, null, 2));
    }
  } finally {
    await browser.close();
  }
}

(async function main() {
  try {
    const args = parseArgs(process.argv);
    const symbol = (args._[0] || "").trim();
    if (!symbol) {
      console.error(
        "Usage: node nse_comany_events_fetcher.js <SYMBOL> [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json out.json] [--csv out.csv] [--market equities] [--series EQ] [--save-attachments ./dir] [--show] [--debug]"
      );
      process.exit(1);
    }
    await run(symbol, {
      since: args.since ? String(args.since) : null,
      until: args.until ? String(args.until) : null,
      jsonOut: args.json ? path.resolve(String(args.json)) : null,
      csvOut: args.csv ? path.resolve(String(args.csv)) : null,
      headful: !!args.show,
      debug: !!args.debug,
      market: args.market ? String(args.market) : "equities",
      series: args.series ? String(args.series) : "EQ",
      saveAttachments: args["save-attachments"] ? String(args["save-attachments"]) : null,
    });
  } catch (err) {
    console.error("❌ Failed to fetch Event Calendar:", err && err.message ? err.message : err);
    process.exit(2);
  }
})();
