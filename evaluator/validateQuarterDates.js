#!/usr/bin/env node
// validateQuarterDates.js

const fs = require('fs');
const path = require('path');

// ==== CONFIG: put your files here ====
const filePaths = [
//   Example:
  "D:/Node Project/webscrap/ms-events/data/analyser/performance/ABB.json"
];

// Map quarter month abbrev → month index (0-based)
const MON = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

function parseQuarter(quarterStr) {
  if (!quarterStr || typeof quarterStr !== 'string') return null;
  const [yStr, mStr] = quarterStr.split('-');
  const year = Number(yStr);
  const qMonth = MON[mStr];
  if (!Number.isFinite(year) || qMonth == null) return null;
  return { year, qMonth };
}

function buildWindow(year, qMonth) {
  // start = first day of month after the quarter month (inclusive)
  // end   = first day of 3 months after start (exclusive)
  const start = new Date(year, qMonth + 1, 1);
  const end   = new Date(year, qMonth + 4, 1);
  return { start, end };
}

function parseDateTimeRaw(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (/^today$/i.test(trimmed)) return null;

  // dd/MM/yyyy [HH:MM] [am|pm]
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
    return {
      status: 'ERR',
      reason: 'Unparsable Quarter',
      Quarter: rec.Quarter,
      dateTimeRaw: rec.dateTimeRaw
    };
  }

  const dt = parseDateTimeRaw(rec.dateTimeRaw);
  if (!dt) return { status: 'IGNORED' }; // ignore null/non-parsable as requested

  const { start, end } = buildWindow(q.year, q.qMonth);
  const ok = dt >= start && dt < end;

  if (ok) {
    return {
      status: 'OK',
      Quarter: rec.Quarter,
      dateTimeRaw: rec.dateTimeRaw
    };
  } else {
    return {
      status: 'ERR',
      Quarter: rec.Quarter,
      dateTimeRaw: rec.dateTimeRaw,
      reason: 'dateTimeRaw outside valid release window',
      windowStartISO: start.toISOString(),
      windowEndISO: end.toISOString()
    };
  }
}

function runOnFile(f) {
  let raw;
  try {
    raw = fs.readFileSync(f, 'utf8');
  } catch (e) {
    console.error(`ERR  ${f}  reason=Cannot read file (${e.message})`);
    return 1;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`ERR  ${f}  reason=Invalid JSON (${e.message})`);
    return 1;
  }

  if (!Array.isArray(data)) {
    console.error(`ERR  ${f}  reason=Top-level JSON is not an array`);
    return 1;
  }

  let hadErr = 0;
  data.forEach((rec, idx) => {
    const res = validateRecord(rec);
    if (!res || res.status === 'IGNORED') return; // skip printing ignored

    const tag = `${path.basename(f)}#${idx}`;
    if (res.status === 'OK') {
      console.log(`OK   ${tag}  Quarter=${res.Quarter}  date="${res.dateTimeRaw}"`);
    } else {
      hadErr = 1;
      console.log(
        `ERR  ${tag}  Quarter=${res.Quarter}  date="${res.dateTimeRaw}"  reason=${res.reason}  window=[${res.windowStartISO}..${res.windowEndISO})`
      );
    }
  });
  return hadErr;
}

function main() {
  if (!filePaths.length) {
    console.error('Configure `filePaths` at top of script.');
    process.exit(2);
  }
  let exitCode = 0;
  for (const f of filePaths) {
    exitCode |= runOnFile(f);
  }
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateRecord,
  parseQuarter,
  parseDateTimeRaw,
  buildWindow
};
