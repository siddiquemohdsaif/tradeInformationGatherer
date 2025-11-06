// nse-integrated-filing-observer.js
// Polls getLatestNseLatestFiling() every minute and proxies each returned item
// to the provided callback. No dedupe/state: the source already returns only new ones.

const { getLatestNseLatestFiling } = require("./getLatestNseLatestFiling.js");

// ===== Tunables =====
const POLL_INTERVAL_MS = 60_000; // 1 minute
// ====================

/**
 * Normalize return shape:
 * - If it's an array, use it.
 * - If it's an object with { newItems: [...] }, use that.
 * - Otherwise, empty array.
 * @param {any} result
 * @returns {Array<Object>}
 */
function normalizeToArray(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.newItems)) return result.newItems;
  return [];
}

/**
 * One cycle: fetch new filings and proxy them to onNew (one by one).
 * @param {(item:Object)=>void|Promise<void>} onNew
 * @param {Object} getLatestOpts options forwarded to getLatestNseLatestFiling()
 */
async function runCycle(onNew, getLatestOpts) {
  const result = await getLatestNseLatestFiling(getLatestOpts);
  const items = normalizeToArray(result);

  if (!items.length) return;

  for (const item of items) {
    try {
      await Promise.resolve(onNew(item));
    } catch (cbErr) {
      console.error("[observer] onNew callback error:", cbErr?.message || cbErr);
    }
  }
}

/**
 * Start the minute-wise observer.
 * @param {{
 *   onNew?:(item:Object)=>void|Promise<void>,
 *   intervalMs?:number,
 *   getLatestOpts?:Object // forwarded to getLatestNseLatestFiling (e.g., { headless: "new" })
 * }} options
 * @returns {Promise<() => Promise<void>>} stop function
 */
async function startObserver(options = {}) {
  const {
    onNew = defaultLogNew,
    intervalMs = POLL_INTERVAL_MS,
    getLatestOpts = { headless: "new" },
  } = options;

  let running = true;

  const cycle = async () => {
    if (!running) return;
    try {
      await runCycle(onNew, getLatestOpts);
    } catch (e) {
      console.error("[observer] Cycle error:", e?.message || e);
    }
  };

  // Run first immediately
  await cycle();

  const interval = setInterval(cycle, intervalMs);

  const stop = async () => {
    running = false;
    clearInterval(interval);
  };

  // Graceful shutdown for CLI usage
  const shutdown = async (signal) => {
    console.log(`[observer] Received ${signal}. Shutting down…`);
    await stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return stop;
}

function defaultLogNew(item) {
  console.log(
    `NEW: ${item.symbol || "-"} | ${item.company || "-"} | ${item.quarterEnd || "-"} | ${
      item.type || "-"
    } | Audited:${item.audited || "-"} | ${item.basis || "-"} | Broadcast:${
      item.broadcast || "-"
    }\nXBRL: ${item.xbrlHref || "-"}\nDetails: ${item.detailsHref || "-"}\n`
  );
}

// ===== CLI mode =====
if (require.main === module) {
  startObserver().catch((e) => {
    console.error("[observer] Fatal error:", e?.message || e);
    process.exit(1);
  });
}

module.exports = { startObserver, defaultLogNew };
