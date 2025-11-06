// nse-result-maker.js
// Listens to nse-integrated-filing-observer and saves new filings to Redis.

const fs = require("fs");                 // ✅ add
const path = require("path");             // ✅ add
const { createClient } = require("redis");
// ✅ fix filename (single 'l' in 'filing')
const { startObserver } = require("./nse-integrated-filing-observer");

// ===== Tunables / ENV =====
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const NAMESPACE = process.env.NSE_NS || "nse"; // allows multi-env isolation like "nse:dev"

// ---------- Helpers ----------
function buildStrongKey(item) {
  const symbol = (item.symbol || "").trim();
  const quarterEnd = (item.quarterEnd || "").trim();
  const broadcast = (item.broadcast || "").trim();
  const detailsHref = (item.detailsHref || "").trim();
  const xbrlHref = (item.xbrlHref || "").trim();
  return xbrlHref || detailsHref || `${symbol}|${quarterEnd}|${broadcast}`;
}

function normalizeRecord(item) {
  return {
    symbol: item.symbol ?? null,
    companyName: item.company ?? null,
    quarterEndDate: item.quarterEnd ?? null,
    typeOfSubmission: item.type ?? null,
    auditedOrUnaudited: item.audited ?? null,
    basis: item.basis ?? null,
    detailsHref: item.detailsHref ?? null,
    xbrlHref: item.xbrlHref ?? null,
    broadcastDateTime: item.broadcast ?? null,
    revisedDateTime: item.revised ?? null,
    revisionRemarks: item.remarks ?? null,
    _raw: item,
  };
}

/**
 * Save a single filing record to Redis AND locally to ./timestamp.json
 */
async function saveToRedis(r, strongKey, record) {
  const now = Date.now();
  const keyLatest = `${NAMESPACE}:latest:${strongKey}`;
  const keyTimeline = `${NAMESPACE}:timeline`;
  const keyLast = `${NAMESPACE}:last_key`;
  const sym = (record.symbol || "").trim().toUpperCase();
  const keySymSet = `${NAMESPACE}:symbol:${sym || "UNKNOWN"}`;

  const payload = {
    strongKey,
    savedAt: new Date(now).toISOString(),
    record,
  };

  // ===== Redis writes =====
  const pipe = r.multi();
  pipe.set(keyLatest, JSON.stringify(payload));
  pipe.zAdd(keyTimeline, [{ score: now, value: strongKey }]);
  pipe.set(keyLast, strongKey);
  pipe.sAdd(keySymSet, strongKey);

  const ttlSeconds = Number.parseInt(process.env.NSE_ITEM_TTL_SECONDS || "0", 10);
  if (ttlSeconds > 0) {
    pipe.expire(keyLatest, ttlSeconds);
  }

  await pipe.exec();

  // ===== Local file log =====
  try {
    const localFile = path.resolve(__dirname, "timestamp.json");
    let existing = [];

    if (fs.existsSync(localFile)) {
      const raw = fs.readFileSync(localFile, "utf8");
      if (raw.trim()) {
        try { existing = JSON.parse(raw); } catch { existing = []; } // ✅ guard corrupt JSON
      }
    }

    existing.push(payload);
    if (existing.length > 500) existing = existing.slice(-500);     // keep last 500
    fs.writeFileSync(localFile, JSON.stringify(existing, null, 2));
  } catch (e) {
    console.warn("[maker] Failed to write local log:", e.message);
  }

  return { keyLatest, keyTimeline, keySymSet };
}

// ---------- Maker lifecycle ----------
let redisClient = null;
let stopObserverFn = null;

async function startMaker() {
  redisClient = createClient({ url: REDIS_URL });
  redisClient.on("error", (err) => console.error("[maker] Redis error:", err));
  await redisClient.connect();
  console.log("[maker] Connected to Redis:", REDIS_URL);

  stopObserverFn = await startObserver({
    onNew: async (item) => {
      try {
        const strongKey = buildStrongKey(item);
        const record = normalizeRecord(item);
        console.log(
          `[maker] New filing → ${record.symbol || "-"} | ${record.companyName || "-"} | ${record.quarterEndDate || "-"} | ${record.typeOfSubmission || "-"} | ${record.auditedOrUnaudited || "-"} | ${record.basis || "-"}`
        );
        const { keyLatest } = await saveToRedis(redisClient, strongKey, record);
        console.log(`[maker] Saved → ${keyLatest}`);
      } catch (e) {
        console.error("[maker] Failed to save new filing:", e?.message || e);
      }
    },
  });

  const shutdown = async (signal) => {
    console.log(`[maker] Received ${signal}. Shutting down…`);
    await stopMaker();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return stopMaker;
}

async function stopMaker() {
  if (stopObserverFn) {
    try { await stopObserverFn(); } catch {}
    stopObserverFn = null;
  }
  if (redisClient) {
    try { await redisClient.quit(); } catch {}
    redisClient = null;
  }
}

if (require.main === module) {
  startMaker().catch((e) => {
    console.error("[maker] Fatal:", e?.message || e);
    process.exit(1);
  });
}

module.exports = { startMaker, stopMaker };
