// companyInfoParser.js
// Node.js port of CompanyInfo.java, loading data from a JSON file on disk.

"use strict";

const fs = require("fs");
const path = require("path");

// ======= Config =======
const DEFAULT_JSON_PATH = path.resolve(
  "D:\\Node Project\\webscrap\\ms-events\\data\\companies_info.json"
);

// ---------- Utilities ----------
const safeTrim = (s) => (typeof s === "string" ? s.trim() : null);
const putIfNotEmpty = (map, key, value) => {
  if (key && String(key).length > 0) map.set(key, value);
};

// ---------- Data model ----------
/**
 * @typedef {Object} Company
 * @property {string} nseSymbol
 * @property {string|null} zerodhaInstrument
 * @property {string|null} marketScreenerCode
 * @property {string|null} bseSockPath
 * @property {string|null} bseCompanyNameSlug
 * @property {string|null} bseSymbolSlug
 * @property {string|null} bseCompanyCode
 */

function makeCompany(nseSymbol, zerodhaInstrument, marketScreenerCode, bseSockPath) {
  let name = null, sym = null, code = null;
  if (bseSockPath) {
    const parts = String(bseSockPath).split("/");
    if (parts.length >= 3) {
      [name, sym, code] = parts;
    }
  }
  return {
    nseSymbol,
    zerodhaInstrument,
    marketScreenerCode,
    bseSockPath,
    bseCompanyNameSlug: name,
    bseSymbolSlug: sym,
    bseCompanyCode: code
  };
}

// ---------- Indexes ----------
/** @type {Map<string, Company>} */ const BY_NSE = new Map();
const BY_ZERODHA = new Map();
const BY_BSE_CODE = new Map();
const BY_MARKET_SCREENER = new Map();

let _dataPath = DEFAULT_JSON_PATH;

// ---------- Load / Build ----------
function _buildIndexes(raw) {
  [BY_NSE, BY_ZERODHA, BY_BSE_CODE, BY_MARKET_SCREENER].forEach(m => m.clear());

  for (const [nseKey, arr] of Object.entries(raw || {})) {
    if (!Array.isArray(arr) || arr.length < 3) continue;

    const nse = safeTrim(nseKey);
    const zerodha = safeTrim(arr[0]);
    const market = safeTrim(arr[1]);
    const sock = safeTrim(arr[2]);
    if (!nse) continue;

    const c = makeCompany(nse, zerodha, market, sock);
    putIfNotEmpty(BY_NSE, nse, c);
    putIfNotEmpty(BY_ZERODHA, c.zerodhaInstrument, c);
    putIfNotEmpty(BY_MARKET_SCREENER, c.marketScreenerCode, c);
    putIfNotEmpty(BY_BSE_CODE, c.bseCompanyCode, c);
  }
}

/**
 * Load JSON from disk and build indexes (sync).
 * JSON format: { [nseSymbol]: [zerodhaInstrument, marketScreenerCode, bseSockPath] }
 * @param {string} [filePath]
 */
function loadFromFile(filePath = _dataPath) {
  const file = path.resolve(filePath);
  const buf = fs.readFileSync(file);
  // remove BOM if present
  const text = buf.toString("utf8").replace(/^\uFEFF/, "");
  const json = JSON.parse(text);
  _dataPath = file; // remember where we loaded from
  _buildIndexes(json);
}

// Initialize once on first require
try {
  loadFromFile(DEFAULT_JSON_PATH);
} catch (e) {
  // If file missing/malformed, leave maps empty (parity with Java's silent catch).
  // You can console.warn here if you prefer visibility:
  // console.warn(`[CompanyInfo] Failed to load ${DEFAULT_JSON_PATH}:`, e.message);
}

// ---------- Public API (parity with Java) ----------

// Existing method from your stub (returns BSE "companyName" from sockPath, first segment)
function getCompanyNameBySymbol(nseSymbol) {
  const c = BY_NSE.get(nseSymbol);
  return c && c.bseCompanyNameSlug ? c.bseCompanyNameSlug : "Unknown Company";
}

// 1) Zerodha instrument -> NSE symbol
function getNseSymbolFromZerodhaInstrument(zerodhaInstrument) {
  const c = BY_ZERODHA.get(zerodhaInstrument);
  return c ? c.nseSymbol : null;
}

// 2) NSE symbol -> Zerodha instrument
function getZerodhaInstrumentFromNse(nseSymbol) {
  const c = BY_NSE.get(nseSymbol);
  return c ? c.zerodhaInstrument : null;
}

// 3) BSE company code -> NSE symbol
function getNseSymbolFromBseCompanyCode(bseCompanyCode) {
  const c = BY_BSE_CODE.get(bseCompanyCode);
  return c ? c.nseSymbol : null;
}

// 4) NSE symbol -> BSE company code
function getBseCompanyCodeFromNse(nseSymbol) {
  const c = BY_NSE.get(nseSymbol);
  return c ? c.bseCompanyCode : null;
}

// 5) NSE symbol -> BSE sockPath
function getBseSockPathFromNse(nseSymbol) {
  const c = BY_NSE.get(nseSymbol);
  return c ? c.bseSockPath : null;
}

// 6) NSE symbol -> MarketScreener code
function getMarketScreenerFromNse(nseSymbol) {
  const c = BY_NSE.get(nseSymbol);
  return c ? c.marketScreenerCode : null;
}

// 7) MarketScreener code -> NSE symbol
function getNseSymbolFromMarketScreener(marketScreenerCode) {
  const c = BY_MARKET_SCREENER.get(marketScreenerCode);
  return c ? c.nseSymbol : null;
}

// Optional convenience getters (full record or specific pieces)
function getByNse(nseSymbol) { return BY_NSE.get(nseSymbol) || null; }
function getByZerodha(zerodhaInstrument) { return BY_ZERODHA.get(zerodhaInstrument) || null; }
function getByBseCode(bseCode) { return BY_BSE_CODE.get(bseCode) || null; }
function getByMarketScreener(msCode) { return BY_MARKET_SCREENER.get(msCode) || null; }

function getBseCompanySymbolSlugFromNse(nseSymbol) {
  const c = BY_NSE.get(nseSymbol);
  return c ? c.bseSymbolSlug : null;
}

function getBseCompanyNameSlugFromNse(nseSymbol) {
  const c = BY_NSE.get(nseSymbol);
  return c ? c.bseCompanyNameSlug : null;
}

// Read-only views (frozen shallow copies)
function viewAllByNse() { return Object.freeze(Object.fromEntries(BY_NSE)); }
function viewAllByZerodha() { return Object.freeze(Object.fromEntries(BY_ZERODHA)); }
function viewAllByBseCode() { return Object.freeze(Object.fromEntries(BY_BSE_CODE)); }
function viewAllByMarketScreener() { return Object.freeze(Object.fromEntries(BY_MARKET_SCREENER)); }

// Maintenance / control
function setDataPath(newPath) {
  _dataPath = path.resolve(newPath);
}
function reload(filePath = _dataPath) {
  loadFromFile(filePath);
}

module.exports = {
  // core lookups
  getCompanyNameBySymbol,
  getNseSymbolFromZerodhaInstrument,
  getZerodhaInstrumentFromNse,
  getNseSymbolFromBseCompanyCode,
  getBseCompanyCodeFromNse,
  getBseSockPathFromNse,
  getMarketScreenerFromNse,
  getNseSymbolFromMarketScreener,

  // convenience
  getByNse,
  getByZerodha,
  getByBseCode,
  getByMarketScreener,
  getBseCompanySymbolSlugFromNse,
  getBseCompanyNameSlugFromNse,

  // views & maintenance
  viewAllByNse,
  viewAllByZerodha,
  viewAllByBseCode,
  viewAllByMarketScreener,
  setDataPath,
  reload,
  loadFromFile
};
