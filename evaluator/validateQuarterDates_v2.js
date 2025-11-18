#!/usr/bin/env node
// validateQuarterDates.js
// Scan folders → run validator on every .json file → print only files with errors.

const fs = require('fs');
const path = require('path');

// ==== CONFIG: put your folders here ====
const folderPaths = [
  // e.g.
  "D:/Node Project/webscrap/ms-events/data/analyser/performance"
];

// Recursively scan subfolders?
const RECURSIVE = true;

// ---- internals ----
const MON = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

function parseQuarter(quarterStr) {
  if (!quarterStr || typeof quarterStr !== 'string') return null;
  const [yStr, mStr] = quarterStr.split('-');
  const year = Number(yStr);
  const qMonth = MON[mStr];
  if (!Number.isFinite(year) || qMonth == null) return null;
  return { year, qMonth };
}
function buildWindow(year, qMonth) {
  const start = new Date(year, qMonth + 1, 1);
  const end   = new Date(year, qMonth + 4, 1);
  return { start, end };
}
function parseDateTimeRaw(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (/^today$/i.test(trimmed)) return null;
  const re = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?$/i;
  const m = trimmed.match(re);
  if (!m) return null;
  let [, dStr, moStr, yStr, hhStr, mmStr, ap] = m;
  const dd = Number(dStr), mo = Number(moStr) - 1, yy = Number(yStr);
  let hh = hhStr ? Number(hhStr) : 0;
  const min = mmStr ? Number(mmStr) : 0;
  if (ap) {
    const isPM = ap.toLowerCase() === 'pm';
    if (isPM && hh !== 12) hh += 12;
    if (!isPM && hh === 12) hh = 0;
  }
  const dt = new Date(yy, mo, dd, hh, min, 0, 0);
  if (dt.getFullYear() !== yy || dt.getMonth() !== mo || dt.getDate() !== dd) return null;
  return dt;
}
function validateRecord(rec) {
  const q = parseQuarter(rec.Quarter);
  if (!q) {
    return { status: 'ERR', reason: 'Unparsable Quarter', Quarter: rec.Quarter, dateTimeRaw: rec.dateTimeRaw };
  }
  const dt = parseDateTimeRaw(rec.dateTimeRaw);
  if (!dt) return { status: 'IGNORED' }; // ignore null/non-parsable
  const { start, end } = buildWindow(q.year, q.qMonth);
  const ok = dt >= start && dt < end;
  return ok
    ? { status: 'OK' }
    : {
        status: 'ERR',
        reason: 'dateTimeRaw outside valid release window',
        windowStartISO: start.toISOString(),
        windowEndISO: end.toISOString()
      };
}

// --- file/folder runners ---
function runOnFile(filePath) {
  let raw, data;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (e) { console.error(`ERR READ ${filePath} : ${e.message}`); return 1; }

  try { data = JSON.parse(raw); }
  catch (e) { console.error(`ERR JSON ${filePath} : ${e.message}`); return 1; }

  if (!Array.isArray(data)) { console.error(`ERR TYPE ${filePath} : top-level JSON is not an array`); return 1; }

  let hadErr = 0;
  for (let i = 0; i < data.length; i++) {
    const res = validateRecord(data[i]);
    if (res && res.status === 'ERR') { hadErr = 1; break; }
  }
  // only print files that have errors
  if (hadErr) console.log(`ERRFILE ${filePath}`);
  return hadErr;
}

function listJsonFiles(dir, recursive = true, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { console.error(`ERR LIST ${dir} : ${e.message}`); return out; }

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (recursive) listJsonFiles(full, true, out);
    } else if (ent.isFile() && path.extname(ent.name).toLowerCase() === '.json') {
      out.push(full);
    }
  }
  return out;
}

function runOnFolder(folderPath, recursive = true) {
  const files = listJsonFiles(folderPath, recursive);
  if (!files.length) {
    console.error(`WARN empty: no .json files in ${folderPath}`);
    return 0;
  }
  let exitCode = 0;
  for (const f of files) exitCode |= runOnFile(f);
  return exitCode;
}

function main() {
  if (!folderPaths.length) {
    console.error('Configure `folderPaths` at top of script.');
    process.exit(2);
  }
  let exitCode = 0;
  for (const dir of folderPaths) {
    // If a file path slips in, handle it gracefully.
    try {
      const st = fs.statSync(dir);
      if (st.isDirectory()) {
        exitCode |= runOnFolder(dir, RECURSIVE);
      } else if (st.isFile() && path.extname(dir).toLowerCase() === '.json') {
        exitCode |= runOnFile(dir);
      } else {
        console.error(`SKIP ${dir} : not a directory or .json file`);
      }
    } catch (e) {
      console.error(`ERR STAT ${dir} : ${e.message}`);
      exitCode = 1;
    }
  }
  process.exit(exitCode);
}

if (require.main === module) main();

module.exports = {
  validateRecord,
  parseQuarter,
  parseDateTimeRaw,
  buildWindow,
  runOnFile,
  runOnFolder
};
