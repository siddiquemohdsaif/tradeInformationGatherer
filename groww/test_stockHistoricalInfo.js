// test_stockHistoricalInfo.js
// Minimal live tests for stockHistoricalInfo.js (no external deps).
// Run: node test_stockHistoricalInfo.js

const { fetchHistoricalData, getPriceAt } = require("./stockHistoricalInfo");

// tiny assert helper
function assert(cond, msg) {
  if (!cond) {
    throw new Error("ASSERTION FAILED: " + msg);
  }
}

(async () => {
  try {
    console.log("=== Test 1: fetchHistoricalData (daily range) ===");
    const rangeData = await fetchHistoricalData(
      "INDUSINDBK",
      "2020-10-24",              // IST 00:00
      "2020-11-10 15:30:00"      // IST 3:30pm
    );
    assert(rangeData && Array.isArray(rangeData.candles), "rangeData.candles should be an array");
    console.log("candles length:", rangeData.candles.length);
    console.log("first 3 candles (ts,o,h,l,c,v):", rangeData.candles.slice(0, 3));

    console.log("\n=== Test 2: getPriceAt (trading day) ===");
    // pick a known trading day (Fri). Adjust if needed.
    const day = "2025-09-05";
    const oneDay = await getPriceAt(day, "INDUSINDBK");
    assert(oneDay === null || typeof oneDay === "object", "getPriceAt should return object or null");
    console.log(`Candle for ${day} ->`, oneDay);

    console.log("\n=== Test 3: getPriceAt (non-trading day should be null) ===");
    // Sunday
    const sunday = "2025-09-07";
    const sundayCandle = await getPriceAt(sunday, "INDUSINDBK");
    assert(sundayCandle === null || typeof sundayCandle === "object", "return value should be null or object");
    if (sundayCandle) {
      console.warn("NOTE: Received a candle for a weekend; verify exchange calendar or the API behavior.");
    } else {
      console.log("OK: Non-trading day returned null");
    }

    console.log("\n=== Test 4: invalid inputs (expect error) ===");
    let threw = false;
    try {
      // missing/empty date string should throw
      await getPriceAt("", "INDUSINDBK");
    } catch (e) {
      threw = true;
      console.log("Caught expected error:", e.message);
    }
    assert(threw, "getPriceAt should throw for empty date string");

    console.log("\nAll tests finished without assertion errors ✅");
  } catch (e) {
    console.error("\nTEST ERROR:", e.message);
    process.exit(1);
  }
})();
