// company_info_parser.js
const fs = require('fs');
const path = require('path');

/**
 * Map a fiscal quarter (Q1..Q4) and fiscal year (e.g., 2026) to the
 * "YYYY-MMM" quarter label used in outJson.
 *
 * FY in India: Apr..Mar
 * Q1 FY2026 -> 2025-Jun
 * Q2 FY2026 -> 2025-Sep
 * Q3 FY2026 -> 2025-Dec
 * Q4 FY2026 -> 2026-Mar
 */
function fiscalToQuarterLabel(qNum, fy) {
  const nFY = Number(fy);
  if (!Number.isFinite(nFY) || nFY < 1900) return null;

  switch (Number(qNum)) {
    case 1: return `${nFY - 1}-Jun`;
    case 2: return `${nFY - 1}-Sep`;
    case 3: return `${nFY - 1}-Dec`;
    case 4: return `${nFY}-Mar`;
    default: return null;
  }
}

/**
 * Resolve a "YYYY-MMM" quarter label from a title string for a given type.
 * type must be "Release" or "Call".
 * Supports:
 *   - "Q2 2026 Earnings Release/Call"
 *   - "FY 2021 Earnings Release/Call"       -> Q4 FY2021
 *   - "Interim 2021 Earnings Release/Call"  -> Q2 FY2021
 */
function resolveQuarterLabelFromTitle(title, type) {
  if (!title) return null;

  // Ignore projections
  if (/Projected/i.test(title)) return null;

  const typePart = type === 'Call' ? 'Call' : 'Release';

  // 1) Standard quarter form: "Qn YYYY Earnings <type>"
  const reQuarter = new RegExp(`\\bQ\\s*([1-4])\\s+(\\d{4})\\s+Earnings\\s+${typePart}\\b`, 'i');
  let m = title.match(reQuarter);
  if (m) {
    const [, qStr, fyStr] = m;
    return fiscalToQuarterLabel(qStr, fyStr);
  }

  // 2) Full-year form: "FY YYYY Earnings <type>" => Q4 of FY
  const reFY = new RegExp(`\\bFY\\s+(\\d{4})\\s+Earnings\\s+${typePart}\\b`, 'i');
  m = title.match(reFY);
  if (m) {
    const [, fyStr] = m;
    return fiscalToQuarterLabel(4, fyStr);
  }

  // 3) Interim (half-year) form: "Interim YYYY Earnings <type>" => Q2 of FY
  const reInterim = new RegExp(`\\bInterim\\s+(\\d{4})\\s+Earnings\\s+${typePart}\\b`, 'i');
  m = title.match(reInterim);
  if (m) {
    const [, fyStr] = m;
    return fiscalToQuarterLabel(2, fyStr);
  }

  return null;
}

/**
 * Build a lookup index for a specific event type ("Release" or "Call"):
 * { "YYYY-MMM": { dateTimeRaw, dateTimeISO?, title, icsUrl } }
 */
function buildEarningsIndex(companyInfoJson, type /* 'Release' | 'Call' */) {
  const idx = Object.create(null);
  const events = companyInfoJson?.pastEvents?.events || [];

  for (const ev of events) {
    const title = ev?.title || "";
    const quarterLabel = resolveQuarterLabelFromTitle(title, type);
    if (!quarterLabel) continue;

    // Keep first occurrence; customize tie-breaks if needed
    if (!idx[quarterLabel]) {
      idx[quarterLabel] = {
        dateTimeRaw: ev.dateTimeRaw ?? null,
        dateTimeISO: ev.dateTimeISO ?? null,
        title,
        icsUrl: ev.icsUrl ?? null,
      };
    }
  }

  return idx;
}

/**
 * Enriches each row in outJson by adding "dateTimeRaw" (and leaves everything else unchanged),
 * using the mapping derived from companyInfoJson.pastEvents:
 *   1) Prefer "Earnings Release"
 *   2) If not found, fall back to "Earnings Call"
 *
 * Handles Qn, FY, and Interim formats; ignores Projected.
 *
 * @param {object} companyInfoJson - The full company info JSON.
 * @param {Array<object>} outJson - The array of quarterly result rows to be enriched (mutated in place).
 * @returns {void}
 */
function parsePastResult(companyInfoJson, outJson) {
  if (!Array.isArray(outJson)) return;

  const releaseIndex = buildEarningsIndex(companyInfoJson, 'Release');
  const callIndex    = buildEarningsIndex(companyInfoJson, 'Call');

  for (const row of outJson) {
    const quarter = row?.Quarter; // e.g., "2025-Dec"
    if (!quarter) continue;

    const match = releaseIndex[quarter] || callIndex[quarter];
    if (match) {
      row.dateTimeRaw = match.dateTimeRaw ?? null;
      // Optionally include ISO:
      // row.dateTimeISO = match.dateTimeISO ?? null;
    } else {
      if (typeof row.dateTimeRaw === "undefined") row.dateTimeRaw = null;
    }
  }
}

module.exports = {
  parsePastResult,
};

// ---------- Example usage ----------
if (require.main === module) {
const companyInfoJson = {
      pastEvents: {
        events: [
      {
        "section": "Past",
        "dateTimeRaw": "Today",
        "dateTimeISO": null,
        "title": "Q2 2026 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q2-2026-Earnings-Release-47889084.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/09/2025",
        "dateTimeISO": "2025-09-15T18:30:00.000Z",
        "title": "Jefferies India Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Jefferies-India-Forum-50913430.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "01/09/2025",
        "dateTimeISO": "2025-08-31T18:30:00.000Z",
        "title": "Motilal Oswal Global Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Motilal-Oswal-Global-Investor-Conference-50913409.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "26/08/2025 11:00 am",
        "dateTimeISO": "2025-08-26T05:30:00.000Z",
        "title": "Annual General Meeting",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Annual-General-Meeting-50952835.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/08/2025",
        "dateTimeISO": "2025-08-19T18:30:00.000Z",
        "title": "Antique Flagship India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Antique-Flagship-India-Conference-50632532.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/08/2025",
        "dateTimeISO": "2025-08-18T18:30:00.000Z",
        "title": "Equirus India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Equirus-India-Conference-50632531.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "07/08/2025",
        "dateTimeISO": "2025-08-06T18:30:00.000Z",
        "title": "Non Deal Roadshow - Day 2",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Day-2-50632512.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "06/08/2025",
        "dateTimeISO": "2025-08-05T18:30:00.000Z",
        "title": "Non Deal Roadshow - Day 1",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Day-1-50632509.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "18/07/2025",
        "dateTimeISO": "2025-07-17T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-50618196.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/07/2025",
        "dateTimeISO": "2025-07-15T18:30:00.000Z",
        "title": "Non Deal Roadshow - Motilal Oswal",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Motilal-Oswal-50485971.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/07/2025 08:00 pm",
        "dateTimeISO": "2025-07-14T14:30:00.000Z",
        "title": "Q1 2026 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2026-Earnings-Call-50464837.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/07/2025 05:37 pm",
        "dateTimeISO": "2025-07-14T12:07:00.000Z",
        "title": "Q1 2026 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2026-Earnings-Release-47325152.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "03/06/2025",
        "dateTimeISO": "2025-06-02T18:30:00.000Z",
        "title": "Morgan Stanley India Investment Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Morgan-Stanley-India-Investment-Forum-49940542.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "02/06/2025",
        "dateTimeISO": "2025-06-01T18:30:00.000Z",
        "title": "Bank of America Securities India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Bank-of-America-Securities-India-Conference-49940539.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/05/2025",
        "dateTimeISO": "2025-05-18T18:30:00.000Z",
        "title": "BofA India IT Virtual Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/BofA-India-IT-Virtual-Conference-49940499.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "28/04/2025",
        "dateTimeISO": "2025-04-27T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-49816053.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "22/04/2025 10:46 pm",
        "dateTimeISO": "2025-04-22T17:16:00.000Z",
        "title": "Q4 2025 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q4-2025-Earnings-Release-46248931.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "22/04/2025 07:30 pm",
        "dateTimeISO": "2025-04-22T14:00:00.000Z",
        "title": "Q4 2025 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q4-2025-Earnings-Call-49641662.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "25/02/2025",
        "dateTimeISO": "2025-02-24T18:30:00.000Z",
        "title": "IIFL Enterprising India Global Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/IIFL-Enterprising-India-Global-Investor-Conference-48869110.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/02/2025",
        "dateTimeISO": "2025-02-16T18:30:00.000Z",
        "title": "Kotak Chasing Growth Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Kotak-Chasing-Growth-Conference-48869106.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/02/2025",
        "dateTimeISO": "2025-02-12T18:30:00.000Z",
        "title": "Citi India Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citi-India-Investor-Conference-48869103.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "10/02/2025",
        "dateTimeISO": "2025-02-09T18:30:00.000Z",
        "title": "Nuvama India Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nuvama-India-Investor-Conference-48869098.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/01/2025",
        "dateTimeISO": "2025-01-16T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-48872819.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/01/2025",
        "dateTimeISO": "2025-01-16T18:30:00.000Z",
        "title": "Anniversary bonus dividend",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Anniversary-bonus-dividend-48872818.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/01/2025 07:30 pm",
        "dateTimeISO": "2025-01-13T14:00:00.000Z",
        "title": "Q3 2025 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2025-Earnings-Call-48712163.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/01/2025 05:43 pm",
        "dateTimeISO": "2025-01-13T12:13:00.000Z",
        "title": "Q3 2025 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2025-Earnings-Release-45583948.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "10/12/2024",
        "dateTimeISO": "2024-12-09T18:30:00.000Z",
        "title": "Citi Global IT Services Tour",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citi-Global-IT-Services-Tour-48480535.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "09/12/2024",
        "dateTimeISO": "2024-12-08T18:30:00.000Z",
        "title": "Macquarie India Tech Spotlight Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Macquarie-India-Tech-Spotlight-Day-48401673.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/11/2024",
        "dateTimeISO": "2024-11-19T18:30:00.000Z",
        "title": "Morgan Stanley Asia Pacific Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Morgan-Stanley-Asia-Pacific-Summit-48200242.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "18/11/2024",
        "dateTimeISO": "2024-11-17T18:30:00.000Z",
        "title": "CITIC CLSA India Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/CITIC-CLSA-India-Forum-48200237.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/11/2024",
        "dateTimeISO": "2024-11-11T18:30:00.000Z",
        "title": "UBS India Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/UBS-India-Summit-48200228.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "22/10/2024",
        "dateTimeISO": "2024-10-21T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-48173118.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/10/2024 07:30 pm",
        "dateTimeISO": "2024-10-14T14:00:00.000Z",
        "title": "Q2 2025 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q2-2025-Earnings-Call-48028878.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/10/2024 05:37 pm",
        "dateTimeISO": "2024-10-14T12:07:00.000Z",
        "title": "Q2 2025 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q2-2025-Earnings-Release-45006847.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/09/2024",
        "dateTimeISO": "2024-09-16T18:30:00.000Z",
        "title": "Jefferies India Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Jefferies-India-Forum-47696819.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "09/09/2024",
        "dateTimeISO": "2024-09-08T18:30:00.000Z",
        "title": "CITIC CLSA Flagship Investor Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/CITIC-CLSA-Flagship-Investor-Forum-47696800.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "03/09/2024",
        "dateTimeISO": "2024-09-02T18:30:00.000Z",
        "title": "HDFC securities IT sector Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/HDFC-securities-IT-sector-Conference-47696789.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "28/08/2024",
        "dateTimeISO": "2024-08-27T18:30:00.000Z",
        "title": "Investor Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Investor-Day-47708855.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/08/2024",
        "dateTimeISO": "2024-08-20T18:30:00.000Z",
        "title": "Equirus India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Equirus-India-Conference-47575348.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/08/2024",
        "dateTimeISO": "2024-08-19T18:30:00.000Z",
        "title": "BofA India IT Virtual Call Series",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/BofA-India-IT-Virtual-Call-Series-47696725.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/08/2024",
        "dateTimeISO": "2024-08-18T18:30:00.000Z",
        "title": "Motilal Oswal Global Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Motilal-Oswal-Global-Investor-Conference-47575342.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/08/2024 11:00 am",
        "dateTimeISO": "2024-08-13T05:30:00.000Z",
        "title": "Annual General Meeting",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Annual-General-Meeting-47575295.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "08/08/2024",
        "dateTimeISO": "2024-08-07T18:30:00.000Z",
        "title": "Non Deal Roadshow - Day 4",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Day-4-47575265.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "07/08/2024",
        "dateTimeISO": "2024-08-06T18:30:00.000Z",
        "title": "Non Deal Roadshow - Day 3",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Day-3-47575253.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "06/08/2024",
        "dateTimeISO": "2024-08-05T18:30:00.000Z",
        "title": "Non Deal Roadshow - Day 2",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Day-2-47563743.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "05/08/2024",
        "dateTimeISO": "2024-08-04T18:30:00.000Z",
        "title": "Non Deal Roadshow - Day 1",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Day-1-47563719.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/07/2024",
        "dateTimeISO": "2024-07-22T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-47427438.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/07/2024 07:30 pm",
        "dateTimeISO": "2024-07-12T14:00:00.000Z",
        "title": "Q1 2025 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2025-Earnings-Call-47325073.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/07/2024 05:45 pm",
        "dateTimeISO": "2024-07-12T12:15:00.000Z",
        "title": "Q1 2025 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2025-Earnings-Release-44126945.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/06/2024",
        "dateTimeISO": "2024-06-18T18:30:00.000Z",
        "title": "Macquarie Capital Equities Asia Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Macquarie-Capital-Equities-Asia-Conference-46697386.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/06/2024",
        "dateTimeISO": "2024-06-11T18:30:00.000Z",
        "title": "Morgan Stanley India Investment Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Morgan-Stanley-India-Investment-Forum-46697381.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "10/06/2024",
        "dateTimeISO": "2024-06-09T18:30:00.000Z",
        "title": "Jefferies India Access Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Jefferies-India-Access-Day-46697378.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "03/06/2024",
        "dateTimeISO": "2024-06-02T18:30:00.000Z",
        "title": "Nomura Asia Investment Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nomura-Asia-Investment-Forum-46697376.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "03/06/2024",
        "dateTimeISO": "2024-06-02T18:30:00.000Z",
        "title": "BofA India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/BofA-India-Conference-46697375.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "22/05/2024",
        "dateTimeISO": "2024-05-21T18:30:00.000Z",
        "title": "India Corporate Day Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/India-Corporate-Day-Conference-46697365.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/05/2024",
        "dateTimeISO": "2024-05-12T18:30:00.000Z",
        "title": "Macquarie Asia Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Macquarie-Asia-Conference-46697341.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "07/05/2024",
        "dateTimeISO": "2024-05-06T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-46629952.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "26/04/2024 07:30 pm",
        "dateTimeISO": "2024-04-26T14:00:00.000Z",
        "title": "Q4 2024 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q4-2024-Earnings-Call-46463571.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "26/04/2024 05:31 pm",
        "dateTimeISO": "2024-04-26T12:01:00.000Z",
        "title": "Q4 2024 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q4-2024-Earnings-Release-43512633.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "11/03/2024",
        "dateTimeISO": "2024-03-10T18:30:00.000Z",
        "title": "Citi India Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citi-India-Investor-Conference-45994329.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "01/03/2024",
        "dateTimeISO": "2024-02-29T18:30:00.000Z",
        "title": "Non-Deal Roadshow - Kotak, Day 5",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Kotak-Day-5-45994303.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "29/02/2024",
        "dateTimeISO": "2024-02-28T18:30:00.000Z",
        "title": "Non-Deal Roadshow - Kotak, Day 4",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Kotak-Day-4-45994300.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "28/02/2024",
        "dateTimeISO": "2024-02-27T18:30:00.000Z",
        "title": "Non-Deal Roadshow - Kotak, Day 3",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Kotak-Day-3-45994299.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "27/02/2024",
        "dateTimeISO": "2024-02-26T18:30:00.000Z",
        "title": "Non-Deal Roadshow - Kotak, Day 2",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Kotak-Day-2-45994293.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "26/02/2024",
        "dateTimeISO": "2024-02-25T18:30:00.000Z",
        "title": "Non-Deal Roadshow - Kotak, Day 1",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Kotak-Day-1-45994288.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/02/2024",
        "dateTimeISO": "2024-02-18T18:30:00.000Z",
        "title": "Kotak Chasing Growth Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Kotak-Chasing-Growth-Conference-45871020.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/02/2024",
        "dateTimeISO": "2024-02-18T18:30:00.000Z",
        "title": "Antique Build India New India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Antique-Build-India-New-India-Conference-45871019.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/02/2024",
        "dateTimeISO": "2024-02-12T18:30:00.000Z",
        "title": "IIFL Enterprising India Global Investors Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/IIFL-Enterprising-India-Global-Investors-Conference-45871004.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/02/2024",
        "dateTimeISO": "2024-02-11T18:30:00.000Z",
        "title": "Nuvama India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nuvama-India-Conference-45871002.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/01/2024",
        "dateTimeISO": "2024-01-18T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-45780308.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/01/2024 07:30 pm",
        "dateTimeISO": "2024-01-12T14:00:00.000Z",
        "title": "Q3 2024 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2024-Earnings-Call-45697581.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/01/2024 05:41 pm",
        "dateTimeISO": "2024-01-12T12:11:00.000Z",
        "title": "Q3 2024 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2024-Earnings-Release-42571140.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/12/2023",
        "dateTimeISO": "2023-12-13T18:30:00.000Z",
        "title": "Citi India Global IT Services Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citi-India-Global-IT-Services-Investor-Conference-45566361.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "06/12/2023",
        "dateTimeISO": "2023-12-05T18:30:00.000Z",
        "title": "Non Deal Roadshow - Day 2",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Day-2-45469066.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "05/12/2023",
        "dateTimeISO": "2023-12-04T18:30:00.000Z",
        "title": "Non Deal Roadshow - Day 1",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Day-1-45469063.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/10/2023",
        "dateTimeISO": "2023-10-19T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-45119600.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/10/2023 12:11 am",
        "dateTimeISO": "2023-10-12T18:41:00.000Z",
        "title": "Q2 2024 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q2-2024-Earnings-Release-44872231.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/10/2023 07:30 pm",
        "dateTimeISO": "2023-10-12T14:00:00.000Z",
        "title": "Q2 2024 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q2-2024-Earnings-Call-44998045.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "29/08/2023",
        "dateTimeISO": "2023-08-28T18:30:00.000Z",
        "title": "Goldman Sachs India IT Services Tour",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Goldman-Sachs-India-IT-Services-Tour-44134913.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "28/08/2023",
        "dateTimeISO": "2023-08-27T18:30:00.000Z",
        "title": "APAC IT Services CEO/CFO Access Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/APAC-IT-Services-CEO-CFO-Access-Day-44654204.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/08/2023",
        "dateTimeISO": "2023-08-20T18:30:00.000Z",
        "title": "Motilal Oswal Global Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Motilal-Oswal-Global-Investor-Conference-44634564.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/08/2023",
        "dateTimeISO": "2023-08-15T18:30:00.000Z",
        "title": "Nuvama India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nuvama-India-Conference-44572548.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/07/2023",
        "dateTimeISO": "2023-07-19T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-44395576.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/07/2023 08:00 pm",
        "dateTimeISO": "2023-07-12T14:30:00.000Z",
        "title": "Q1 2024 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2024-Earnings-Call-44306318.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/07/2023 06:08 pm",
        "dateTimeISO": "2023-07-12T12:38:00.000Z",
        "title": "Q1 2024 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2024-Earnings-Release-40937958.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "27/06/2023",
        "dateTimeISO": "2023-06-26T18:30:00.000Z",
        "title": "Zenith Live Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Zenith-Live-Conference-44138646.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "27/06/2023",
        "dateTimeISO": "2023-06-26T18:30:00.000Z",
        "title": "FinOps X Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FinOps-X-Summit-44134897.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "26/06/2023",
        "dateTimeISO": "2023-06-25T18:30:00.000Z",
        "title": "Snowflake Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Snowflake-Summit-44138645.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "26/06/2023",
        "dateTimeISO": "2023-06-25T18:30:00.000Z",
        "title": "Collision Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Collision-Conference-44134894.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "22/06/2023",
        "dateTimeISO": "2023-06-21T18:30:00.000Z",
        "title": "Banking Transformation Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Banking-Transformation-Summit-44134892.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/06/2023",
        "dateTimeISO": "2023-06-20T18:30:00.000Z",
        "title": "Macquarie Capital Ltd. Road to Recovery Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Macquarie-Capital-Ltd-Road-to-Recovery-Conference-43896723.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/06/2023",
        "dateTimeISO": "2023-06-18T18:30:00.000Z",
        "title": "Paris Air Show",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Paris-Air-Show-44134890.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "15/06/2023",
        "dateTimeISO": "2023-06-14T18:30:00.000Z",
        "title": "Kotak Securities Ltd. India Corporate Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Kotak-Securities-Ltd-India-Corporate-Day-43896703.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/06/2023",
        "dateTimeISO": "2023-06-12T18:30:00.000Z",
        "title": "Citi Generative AI Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citi-Generative-AI-Conference-43995379.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "07/06/2023",
        "dateTimeISO": "2023-06-06T18:30:00.000Z",
        "title": "Roadshow - Day-2",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Roadshow-Day-2-43995376.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "06/06/2023",
        "dateTimeISO": "2023-06-05T18:30:00.000Z",
        "title": "Roadshow - Day-1",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Roadshow-Day-1-43995374.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "05/06/2023",
        "dateTimeISO": "2023-06-04T18:30:00.000Z",
        "title": "Nomura Investment Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nomura-Investment-Forum-43995372.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/05/2023",
        "dateTimeISO": "2023-05-22T18:30:00.000Z",
        "title": "Jefferies India Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Jefferies-India-Summit-43896554.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/05/2023",
        "dateTimeISO": "2023-05-15T18:30:00.000Z",
        "title": "Non-Deal Roadshow - Kotak Securities Ltd.",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Non-Deal-Roadshow-Kotak-Securities-Ltd-43896450.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "15/05/2023",
        "dateTimeISO": "2023-05-14T18:30:00.000Z",
        "title": "Bank of America Securities India IT Call Series",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Bank-of-America-Securities-India-IT-Call-Series-43896423.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "28/04/2023",
        "dateTimeISO": "2023-04-27T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-43686961.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/04/2023 07:00 pm",
        "dateTimeISO": "2023-04-20T13:30:00.000Z",
        "title": "Q4 2023 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q4-2023-Earnings-Call-43609356.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/04/2023 05:00 pm",
        "dateTimeISO": "2023-04-20T11:30:00.000Z",
        "title": "Q4 2023 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q4-2023-Earnings-Release-40010713.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/03/2023",
        "dateTimeISO": "2023-03-20T18:30:00.000Z",
        "title": "Adobe Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Adobe-Summit-43088232.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/03/2023",
        "dateTimeISO": "2023-03-16T18:30:00.000Z",
        "title": "Bank of America Tech Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Bank-of-America-Tech-Conference-43158339.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "15/03/2023",
        "dateTimeISO": "2023-03-14T18:30:00.000Z",
        "title": "Roadshow - Day 2",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Roadshow-Day-2-43158313.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/03/2023",
        "dateTimeISO": "2023-03-13T18:30:00.000Z",
        "title": "Roadshow - Day 1",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Roadshow-Day-1-43158290.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/03/2023",
        "dateTimeISO": "2023-03-13T18:30:00.000Z",
        "title": "Digital Transformation World Asia Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Digital-Transformation-World-Asia-Conference-43088218.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/03/2023",
        "dateTimeISO": "2023-03-13T18:30:00.000Z",
        "title": "Nomura Virtual India Corporate Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nomura-Virtual-India-Corporate-Day-43026431.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "02/03/2023",
        "dateTimeISO": "2023-03-01T18:30:00.000Z",
        "title": "Bank Automation Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Bank-Automation-Summit-43088105.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "02/03/2023",
        "dateTimeISO": "2023-03-01T18:30:00.000Z",
        "title": "ACMP Change Management summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/ACMP-Change-Management-summit-43088104.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "27/02/2023",
        "dateTimeISO": "2023-02-26T18:30:00.000Z",
        "title": "Mobile World Congress",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Mobile-World-Congress-43088067.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/02/2023",
        "dateTimeISO": "2023-02-19T18:30:00.000Z",
        "title": "Kotak Chasing Growth Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Kotak-Chasing-Growth-Conference-42783022.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/02/2023",
        "dateTimeISO": "2023-02-13T18:30:00.000Z",
        "title": "IIFL Securities Enterprising India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/IIFL-Securities-Enterprising-India-Conference-42782998.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/02/2023 10:30 am",
        "dateTimeISO": "2023-02-13T05:00:00.000Z",
        "title": "Investor Meeting - Hosted by Motilal Oswal",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Investor-Meeting-Hosted-by-Motilal-Oswal-43026201.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/02/2023",
        "dateTimeISO": "2023-02-12T18:30:00.000Z",
        "title": "Investor Meeting - Motilal Oswal",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Investor-Meeting-Motilal-Oswal-43026200.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "08/02/2023",
        "dateTimeISO": "2023-02-07T18:30:00.000Z",
        "title": "Nuvama India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nuvama-India-Conference-42782980.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "07/02/2023",
        "dateTimeISO": "2023-02-06T18:30:00.000Z",
        "title": "Axis Capital India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Axis-Capital-India-Conference-42782974.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "06/02/2023",
        "dateTimeISO": "2023-02-05T18:30:00.000Z",
        "title": "Citi India Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citi-India-Investor-Conference-42782966.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "06/02/2023",
        "dateTimeISO": "2023-02-05T18:30:00.000Z",
        "title": "Antique Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Antique-Investor-Conference-42782965.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/01/2023",
        "dateTimeISO": "2023-01-18T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-42781137.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/01/2023 07:30 pm",
        "dateTimeISO": "2023-01-12T14:00:00.000Z",
        "title": "Q3 2023 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2023-Earnings-Call-42733920.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/01/2023 05:28 pm",
        "dateTimeISO": "2023-01-12T11:58:00.000Z",
        "title": "Q3 2023 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2023-Earnings-Release-37418405.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "08/12/2022 11:30 pm",
        "dateTimeISO": "2022-12-08T18:00:00.000Z",
        "title": "Investor Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Investor-Day-42520137.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/11/2022",
        "dateTimeISO": "2022-11-13T18:30:00.000Z",
        "title": "CITIC CLSA India Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/CITIC-CLSA-India-Forum-42215971.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "09/11/2022",
        "dateTimeISO": "2022-11-08T18:30:00.000Z",
        "title": "UBS India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/UBS-India-Conference-42215910.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "02/11/2022",
        "dateTimeISO": "2022-11-01T18:30:00.000Z",
        "title": "Nomura Virtual India Corporate Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nomura-Virtual-India-Corporate-Day-42215792.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/10/2022",
        "dateTimeISO": "2022-10-18T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-42160207.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/10/2022 07:00 pm",
        "dateTimeISO": "2022-10-12T13:30:00.000Z",
        "title": "Interim 2023 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2023-Earnings-Call-42141072.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/10/2022 04:14 pm",
        "dateTimeISO": "2022-10-12T10:44:00.000Z",
        "title": "Interim 2023 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2023-Earnings-Release-36459288.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/09/2022",
        "dateTimeISO": "2022-09-20T18:30:00.000Z",
        "title": "Motilal Oswal Financial Services Global Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Motilal-Oswal-Financial-Services-Global-Investor-Conference-41687178.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/09/2022",
        "dateTimeISO": "2022-09-19T18:30:00.000Z",
        "title": "J.P. Morgan India Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/J-P-Morgan-India-Investor-Conference-41687168.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/09/2022",
        "dateTimeISO": "2022-09-15T18:30:00.000Z",
        "title": "Investor Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Investor-Day-41739636.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/08/2022 11:00 am",
        "dateTimeISO": "2022-08-16T05:30:00.000Z",
        "title": "Annual General Meeting",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Annual-General-Meeting-41143358.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/07/2022",
        "dateTimeISO": "2022-07-18T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-41006507.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/07/2022 07:30 pm",
        "dateTimeISO": "2022-07-12T14:00:00.000Z",
        "title": "Q1 2023 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2023-Earnings-Call-40937277.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/07/2022 05:56 pm",
        "dateTimeISO": "2022-07-12T12:26:00.000Z",
        "title": "Q1 2023 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2023-Earnings-Release-35960463.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "11/05/2022 09:00 am",
        "dateTimeISO": "2022-05-11T03:30:00.000Z",
        "title": "Investor Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Investor-Day-40497250.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "28/04/2022",
        "dateTimeISO": "2022-04-27T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-40136315.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/04/2022 07:30 pm",
        "dateTimeISO": "2022-04-21T14:00:00.000Z",
        "title": "FY 2022 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FY-2022-Earnings-Call-40130861.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/03/2022",
        "dateTimeISO": "2022-03-20T18:30:00.000Z",
        "title": "Credit Suisse Asian Investment Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Credit-Suisse-Asian-Investment-Conference-37789285.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/03/2022",
        "dateTimeISO": "2022-03-13T18:30:00.000Z",
        "title": "Citi Global IT Services Virtual Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citi-Global-IT-Services-Virtual-Conference-37789276.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/02/2022",
        "dateTimeISO": "2022-02-20T18:30:00.000Z",
        "title": "Kotak Chasing Growth Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Kotak-Chasing-Growth-Conference-37789210.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "09/02/2022",
        "dateTimeISO": "2022-02-08T18:30:00.000Z",
        "title": "Antiques Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Antiques-Investor-Conference-37789126.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "07/02/2022",
        "dateTimeISO": "2022-02-06T18:30:00.000Z",
        "title": "Edelweiss India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Edelweiss-India-Conference-37789098.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/01/2022",
        "dateTimeISO": "2022-01-19T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-37560948.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/01/2022 07:30 pm",
        "dateTimeISO": "2022-01-14T14:00:00.000Z",
        "title": "Q3 2022 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2022-Earnings-Call-37555313.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/01/2022 06:25 pm",
        "dateTimeISO": "2022-01-14T12:55:00.000Z",
        "title": "Q3 2022 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2022-Earnings-Release-32086959.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/11/2021",
        "dateTimeISO": "2021-11-16T18:30:00.000Z",
        "title": "Morgan Stanley Asia Pacific Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Morgan-Stanley-Asia-Pacific-Summit-36838740.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "15/11/2021",
        "dateTimeISO": "2021-11-14T18:30:00.000Z",
        "title": "Centrum Orion Big Ideas Growth Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Centrum-Orion-Big-Ideas-Growth-Conference-36838707.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "15/11/2021",
        "dateTimeISO": "2021-11-14T18:30:00.000Z",
        "title": "UBS Securities Flagship India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/UBS-Securities-Flagship-India-Conference-36838706.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "15/11/2021",
        "dateTimeISO": "2021-11-14T18:30:00.000Z",
        "title": "CITIC CLSA India Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/CITIC-CLSA-India-Forum-36838705.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "10/11/2021",
        "dateTimeISO": "2021-11-09T18:30:00.000Z",
        "title": "Bank of America India Virtual Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Bank-of-America-India-Virtual-Conference-36838648.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "10/11/2021",
        "dateTimeISO": "2021-11-09T18:30:00.000Z",
        "title": "Goldman Sachs India Technology Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Goldman-Sachs-India-Technology-Conference-36838647.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "10/11/2021",
        "dateTimeISO": "2021-11-09T18:30:00.000Z",
        "title": "J P Morgan Global TMT Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/J-P-Morgan-Global-TMT-Conference-36838646.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "09/11/2021",
        "dateTimeISO": "2021-11-08T18:30:00.000Z",
        "title": "Nomura Virtual India Company Corporate Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nomura-Virtual-India-Company-Corporate-Day-36838634.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "05/11/2021",
        "dateTimeISO": "2021-11-04T18:30:00.000Z",
        "title": "B&K Securities Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/B-K-Securities-Conference-36838598.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/10/2021",
        "dateTimeISO": "2021-10-20T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-36702165.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/10/2021 08:30 pm",
        "dateTimeISO": "2021-10-14T15:00:00.000Z",
        "title": "Interim 2022 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2022-Earnings-Call-36642024.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/10/2021 06:21 pm",
        "dateTimeISO": "2021-10-14T12:51:00.000Z",
        "title": "Interim 2022 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2022-Earnings-Release-31468825.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/09/2021",
        "dateTimeISO": "2021-09-19T18:30:00.000Z",
        "title": "JP Morgan India Investor Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/JP-Morgan-India-Investor-Summit-36101337.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/09/2021",
        "dateTimeISO": "2021-09-12T18:30:00.000Z",
        "title": "Motilal Oswal Global Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Motilal-Oswal-Global-Investor-Conference-36324128.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/09/2021",
        "dateTimeISO": "2021-09-12T18:30:00.000Z",
        "title": "CITIC CLSA Flagship Investors Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/CITIC-CLSA-Flagship-Investors-Forum-36101329.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "06/09/2021",
        "dateTimeISO": "2021-09-05T18:30:00.000Z",
        "title": "Credit Suisse Asian Technology Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Credit-Suisse-Asian-Technology-Conference-36101324.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "27/08/2021 11:00 am",
        "dateTimeISO": "2021-08-27T05:30:00.000Z",
        "title": "Annual General Meeting",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Annual-General-Meeting-36101304.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "24/08/2021",
        "dateTimeISO": "2021-08-23T18:30:00.000Z",
        "title": "Jefferies India IT Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Jefferies-India-IT-Summit-36323980.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/08/2021",
        "dateTimeISO": "2021-08-15T18:30:00.000Z",
        "title": "Edelweiss India CXO e-Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Edelweiss-India-CXO-e-Conference-36101233.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "09/08/2021",
        "dateTimeISO": "2021-08-08T18:30:00.000Z",
        "title": "Emkay Confluence Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Emkay-Confluence-Investor-Conference-36101165.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "27/07/2021",
        "dateTimeISO": "2021-07-26T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-35938390.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/07/2021 07:30 pm",
        "dateTimeISO": "2021-07-19T14:00:00.000Z",
        "title": "Q1 2022 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2022-Earnings-Call-35959335.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/07/2021",
        "dateTimeISO": "2021-07-18T18:30:00.000Z",
        "title": "Q1 2022 Earnings Release After hours",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2022-Earnings-Release-30870422.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/06/2021 11:30 am",
        "dateTimeISO": "2021-06-21T06:00:00.000Z",
        "title": "ChipEx Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/ChipEx-Conference-35590336.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/06/2021",
        "dateTimeISO": "2021-06-20T18:30:00.000Z",
        "title": "BofA Securities India Virtual Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/BofA-Securities-India-Virtual-Conference-35052182.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/06/2021",
        "dateTimeISO": "2021-06-13T18:30:00.000Z",
        "title": "Edelweiss India CXO e-Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Edelweiss-India-CXO-e-Conference-35052150.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "31/05/2021",
        "dateTimeISO": "2021-05-30T18:30:00.000Z",
        "title": "Nomura Asia Investment Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nomura-Asia-Investment-Forum-35051905.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "31/05/2021",
        "dateTimeISO": "2021-05-30T18:30:00.000Z",
        "title": "Citigroup Pan-Asia Regional Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citigroup-Pan-Asia-Regional-Investor-Conference-33327014.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "24/05/2021",
        "dateTimeISO": "2021-05-23T18:30:00.000Z",
        "title": "J.P. Morgan Global Virtual Technology, Media and Communications Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/J-P-Morgan-Global-Virtual-Technology-Media-and-Communications-Conference-33326946.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "24/05/2021",
        "dateTimeISO": "2021-05-23T18:30:00.000Z",
        "title": "CITIC CLSA Japan Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/CITIC-CLSA-Japan-Forum-33326945.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "29/04/2021",
        "dateTimeISO": "2021-04-28T18:30:00.000Z",
        "title": "Ex-dividend day for extraordinary dividend",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-extraordinary-dividend-33062328.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "29/04/2021",
        "dateTimeISO": "2021-04-28T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-33062327.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/04/2021 07:30 pm",
        "dateTimeISO": "2021-04-23T14:00:00.000Z",
        "title": "FY 2021 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FY-2021-Earnings-Call-32993203.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/04/2021",
        "dateTimeISO": "2021-04-22T18:30:00.000Z",
        "title": "FY 2021 Earnings Release After hours",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FY-2021-Earnings-Release-30517397.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "22/03/2021",
        "dateTimeISO": "2021-03-21T18:30:00.000Z",
        "title": "Credit Suisse Asian Investment Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Credit-Suisse-Asian-Investment-Conference-32490103.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/02/2021",
        "dateTimeISO": "2021-02-22T18:30:00.000Z",
        "title": "ISG TechXchange Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/ISG-TechXchange-Conference-32374660.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "22/02/2021",
        "dateTimeISO": "2021-02-21T18:30:00.000Z",
        "title": "IIFL Enterprising India Investors Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/IIFL-Enterprising-India-Investors-Conference-32489961.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/02/2021",
        "dateTimeISO": "2021-02-15T18:30:00.000Z",
        "title": "Kotak Chasing Growth",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Kotak-Chasing-Growth-32489936.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "08/02/2021",
        "dateTimeISO": "2021-02-07T18:30:00.000Z",
        "title": "Edelweiss India e-Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Edelweiss-India-e-Conference-32489917.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/01/2021",
        "dateTimeISO": "2021-01-20T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-32210594.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "15/01/2021 05:00 pm",
        "dateTimeISO": "2021-01-15T11:30:00.000Z",
        "title": "Q3 2021 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2021-Earnings-Call-32211221.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "15/01/2021",
        "dateTimeISO": "2021-01-14T18:30:00.000Z",
        "title": "Q3 2021 Earnings Release Pre-market",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2021-Earnings-Release-29777444.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "30/11/2020",
        "dateTimeISO": "2020-11-29T18:30:00.000Z",
        "title": "Nomura Investment Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nomura-Investment-Forum-31713753.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/11/2020",
        "dateTimeISO": "2020-11-22T18:30:00.000Z",
        "title": "Edelweiss India e-Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Edelweiss-India-e-Conference-31713743.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/11/2020",
        "dateTimeISO": "2020-11-16T18:30:00.000Z",
        "title": "CITIC CLSA India Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/CITIC-CLSA-India-Forum-31713703.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "09/11/2020",
        "dateTimeISO": "2020-11-08T18:30:00.000Z",
        "title": "Bank of America Merrill Lynch India Corporate Day",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Bank-of-America-Merrill-Lynch-India-Corporate-Day-31713607.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "02/11/2020",
        "dateTimeISO": "2020-11-01T18:30:00.000Z",
        "title": "Centrum Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Centrum-Investor-Conference-31713528.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "02/11/2020",
        "dateTimeISO": "2020-11-01T18:30:00.000Z",
        "title": "UBS Global TMT Virtual Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/UBS-Global-TMT-Virtual-Conference-31713525.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "22/10/2020",
        "dateTimeISO": "2020-10-21T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-31572695.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/10/2020 05:00 pm",
        "dateTimeISO": "2020-10-16T11:30:00.000Z",
        "title": "Interim 2021 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2021-Earnings-Call-31558424.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/10/2020",
        "dateTimeISO": "2020-10-15T18:30:00.000Z",
        "title": "Interim 2021 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2021-Earnings-Release-29404438.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "30/09/2020",
        "dateTimeISO": "2020-09-29T18:30:00.000Z",
        "title": "SPLM Europe Connection Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/SPLM-Europe-Connection-Conference-30870223.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "29/09/2020 11:00 am",
        "dateTimeISO": "2020-09-29T05:30:00.000Z",
        "title": "Annual General Meeting",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Annual-General-Meeting-31363709.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/09/2020",
        "dateTimeISO": "2020-09-20T18:30:00.000Z",
        "title": "JP Morgan India Investor Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/JP-Morgan-India-Investor-Summit-31159414.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/09/2020",
        "dateTimeISO": "2020-09-13T18:30:00.000Z",
        "title": "Ex-dividend day for final dividend",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-final-dividend-31286148.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "08/09/2020",
        "dateTimeISO": "2020-09-07T18:30:00.000Z",
        "title": "Citi Global Technology Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citi-Global-Technology-Conference-31159398.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "31/08/2020",
        "dateTimeISO": "2020-08-30T18:30:00.000Z",
        "title": "Motilal Oswal Global Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Motilal-Oswal-Global-Investor-Conference-31159368.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/08/2020",
        "dateTimeISO": "2020-08-19T18:30:00.000Z",
        "title": "Edelweiss India e-Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Edelweiss-India-e-Conference-31159313.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/07/2020",
        "dateTimeISO": "2020-07-22T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-30951611.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/07/2020 05:00 pm",
        "dateTimeISO": "2020-07-17T11:30:00.000Z",
        "title": "Q1 2021 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2021-Earnings-Call-30946479.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/07/2020",
        "dateTimeISO": "2020-07-16T18:30:00.000Z",
        "title": "Q1 2021 Earnings Release Pre-market",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2021-Earnings-Release-28970495.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "15/06/2020",
        "dateTimeISO": "2020-06-14T18:30:00.000Z",
        "title": "SemIsrael Tech Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/SemIsrael-Tech-Conference-30869980.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/05/2020",
        "dateTimeISO": "2020-05-19T18:30:00.000Z",
        "title": "Citi Pan-Asia Regional Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citi-Pan-Asia-Regional-Investor-Conference-30516522.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "07/05/2020 05:00 pm",
        "dateTimeISO": "2020-05-07T11:30:00.000Z",
        "title": "FY 2020 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FY-2020-Earnings-Call-30516328.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "07/05/2020",
        "dateTimeISO": "2020-05-06T18:30:00.000Z",
        "title": "FY 2020 Earnings Release After hours",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FY-2020-Earnings-Release-28314659.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "24/03/2020",
        "dateTimeISO": "2020-03-23T18:30:00.000Z",
        "title": "CSFB Asian Investment Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/CSFB-Asian-Investment-Conference-29858209.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/02/2020",
        "dateTimeISO": "2020-02-16T18:30:00.000Z",
        "title": "Kotak Institutional Equities Global Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Kotak-Institutional-Equities-Global-Investor-Conference-29857849.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/02/2020",
        "dateTimeISO": "2020-02-12T18:30:00.000Z",
        "title": "Edelweiss India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Edelweiss-India-Conference-29822553.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/02/2020",
        "dateTimeISO": "2020-02-11T18:30:00.000Z",
        "title": "IIFL Enterprising India Investor’ Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/IIFL-Enterprising-India-Investor-Conference-29857625.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "24/01/2020",
        "dateTimeISO": "2020-01-23T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-29861224.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/01/2020 07:00 pm",
        "dateTimeISO": "2020-01-17T13:30:00.000Z",
        "title": "Q3 2020 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2020-Earnings-Call-29821786.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/01/2020",
        "dateTimeISO": "2020-01-16T18:30:00.000Z",
        "title": "Q3 2020 Earnings Release After hours",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2020-Earnings-Release-27890610.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "05/12/2019",
        "dateTimeISO": "2019-12-04T18:30:00.000Z",
        "title": "Bonus Issue: 1 new share for 1 existing share",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Bonus-Issue-1-new-share-for-1-existing-share-29665270.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "31/10/2019",
        "dateTimeISO": "2019-10-30T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-29464500.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/10/2019 06:30 pm",
        "dateTimeISO": "2019-10-23T13:00:00.000Z",
        "title": "Interim 2020 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2020-Earnings-Call-29424605.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/10/2019",
        "dateTimeISO": "2019-10-22T18:30:00.000Z",
        "title": "Interim 2020 Earnings Release After hours",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2020-Earnings-Release-27890388.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "22/10/2019",
        "dateTimeISO": "2019-10-21T18:30:00.000Z",
        "title": "GSMA Mobile World Congress",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/GSMA-Mobile-World-Congress-28763572.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "20/10/2019",
        "dateTimeISO": "2019-10-19T18:30:00.000Z",
        "title": "SOCAP International Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/SOCAP-International-Conference-29424412.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/10/2019",
        "dateTimeISO": "2019-10-13T18:30:00.000Z",
        "title": "SDN NFV WORLD Congress",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/SDN-NFV-WORLD-Congress-29423971.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "14/08/2019",
        "dateTimeISO": "2019-08-13T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-29050809.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "07/08/2019 06:30 pm",
        "dateTimeISO": "2019-08-07T13:00:00.000Z",
        "title": "Q1 2020 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2020-Earnings-Call-29044313.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "07/08/2019",
        "dateTimeISO": "2019-08-06T18:30:00.000Z",
        "title": "Q1 2020 Earnings Release After hours",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2020-Earnings-Release-26401088.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "06/08/2019 11:00 am",
        "dateTimeISO": "2019-08-06T05:30:00.000Z",
        "title": "Annual General Meeting",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Annual-General-Meeting-28893812.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "10/06/2019",
        "dateTimeISO": "2019-06-09T18:30:00.000Z",
        "title": "Kotak Investment Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Kotak-Investment-Forum-28620884.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "03/06/2019",
        "dateTimeISO": "2019-06-02T18:30:00.000Z",
        "title": "Citi India Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citi-India-Investor-Conference-28620684.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/05/2019",
        "dateTimeISO": "2019-05-15T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-28583140.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "09/05/2019 07:30 pm",
        "dateTimeISO": "2019-05-09T14:00:00.000Z",
        "title": "FY 2019 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FY-2019-Earnings-Call-28579706.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "09/05/2019",
        "dateTimeISO": "2019-05-08T18:30:00.000Z",
        "title": "FY 2019 Earnings Release Pre-market",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FY-2019-Earnings-Release-26509973.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "05/02/2019",
        "dateTimeISO": "2019-02-04T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-27956706.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "29/01/2019 06:30 pm",
        "dateTimeISO": "2019-01-29T13:00:00.000Z",
        "title": "Q3 2019 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2019-Earnings-Call-27917853.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "29/01/2019",
        "dateTimeISO": "2019-01-28T18:30:00.000Z",
        "title": "Q3 2019 Earnings Release After hours",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2019-Earnings-Release-25825075.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/01/2019",
        "dateTimeISO": "2019-01-22T18:30:00.000Z",
        "title": "HCM Excellence Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/HCM-Excellence-Conference-27917464.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/11/2018",
        "dateTimeISO": "2018-11-12T18:30:00.000Z",
        "title": "CLSA India Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/CLSA-India-Forum-27622653.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "12/11/2018",
        "dateTimeISO": "2018-11-11T18:30:00.000Z",
        "title": "UBS India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/UBS-India-Conference-27456696.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "30/10/2018",
        "dateTimeISO": "2018-10-29T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-27500679.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/10/2018 06:59 pm",
        "dateTimeISO": "2018-10-23T13:29:00.000Z",
        "title": "Interim 2019 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2019-Earnings-Release-25390716.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "23/10/2018 06:30 pm",
        "dateTimeISO": "2018-10-23T13:00:00.000Z",
        "title": "Interim 2019 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2019-Earnings-Call-27455481.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "18/09/2018 11:00 am",
        "dateTimeISO": "2018-09-18T05:30:00.000Z",
        "title": "Annual General Meeting",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Annual-General-Meeting-27163690.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "02/08/2018",
        "dateTimeISO": "2018-08-01T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-27016099.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "27/07/2018 07:30 pm",
        "dateTimeISO": "2018-07-27T14:00:00.000Z",
        "title": "Q1 2019 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2019-Earnings-Call-26968215.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "27/07/2018",
        "dateTimeISO": "2018-07-26T18:30:00.000Z",
        "title": "Q1 2019 Earnings Release After hours",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2019-Earnings-Release-25389327.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "09/05/2018",
        "dateTimeISO": "2018-05-08T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-26525967.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "02/05/2018 06:44 pm",
        "dateTimeISO": "2018-05-02T13:14:00.000Z",
        "title": "FY 2018 Earnings Release",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FY-2018-Earnings-Release-25387776.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "02/05/2018 05:00 pm",
        "dateTimeISO": "2018-05-02T11:30:00.000Z",
        "title": "FY 2018 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FY-2018-Earnings-Call-26475377.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/03/2018",
        "dateTimeISO": "2018-03-18T18:30:00.000Z",
        "title": "Credit Suisse Asian Investment Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Credit-Suisse-Asian-Investment-Conference-26181895.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "29/01/2018",
        "dateTimeISO": "2018-01-28T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-25847436.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/01/2018 05:00 pm",
        "dateTimeISO": "2018-01-19T11:30:00.000Z",
        "title": "Q3 2018 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2018-Earnings-Call-25840873.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "19/01/2018",
        "dateTimeISO": "2018-01-18T18:30:00.000Z",
        "title": "Q3 2018 Earnings Release Pre-market",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2018-Earnings-Release-24420434.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/11/2017",
        "dateTimeISO": "2017-11-15T18:30:00.000Z",
        "title": "UBS India Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/UBS-India-Conference-25487559.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/11/2017",
        "dateTimeISO": "2017-11-12T18:30:00.000Z",
        "title": "CLSA India Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/CLSA-India-Forum-25567449.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "01/11/2017",
        "dateTimeISO": "2017-10-31T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-25394593.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "25/10/2017 05:00 pm",
        "dateTimeISO": "2017-10-25T11:30:00.000Z",
        "title": "Interim 2018 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2018-Earnings-Call-25327207.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "22/09/2017",
        "dateTimeISO": "2017-09-21T18:30:00.000Z",
        "title": "J.P. Morgan India Investor Summit",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/J-P-Morgan-India-Investor-Summit-24975146.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/09/2017 11:00 am",
        "dateTimeISO": "2017-09-21T05:30:00.000Z",
        "title": "Annual General Meeting",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Annual-General-Meeting-25011333.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "13/09/2017",
        "dateTimeISO": "2017-09-12T18:30:00.000Z",
        "title": "CLSA Investors Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/CLSA-Investors-Forum-24800963.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "03/08/2017",
        "dateTimeISO": "2017-08-02T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-24849477.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "27/07/2017 04:30 pm",
        "dateTimeISO": "2017-07-27T11:00:00.000Z",
        "title": "Q1 2018 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2018-Earnings-Call-24846325.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "27/07/2017",
        "dateTimeISO": "2017-07-26T18:30:00.000Z",
        "title": "Q1 2018 Earnings Release Pre-market",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q1-2018-Earnings-Release-24414861.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "07/06/2017",
        "dateTimeISO": "2017-06-06T18:30:00.000Z",
        "title": "Nomura Holdings, Inc. Investment Asia Forum",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Nomura-Holdings-Inc-Investment-Asia-Forum-24499488.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "02/06/2017",
        "dateTimeISO": "2017-06-01T18:30:00.000Z",
        "title": "Citi India Investor Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Citi-India-Investor-Conference-24499403.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "24/05/2017",
        "dateTimeISO": "2017-05-23T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-24388411.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "22/05/2017",
        "dateTimeISO": "2017-05-21T18:30:00.000Z",
        "title": "BNP Paribas Asia Pacific TMT Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/BNP-Paribas-Asia-Pacific-TMT-Conference-24499062.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "16/05/2017",
        "dateTimeISO": "2017-05-15T18:30:00.000Z",
        "title": "Deutsche Bank Asia Pacific TMT Conference",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Deutsche-Bank-Asia-Pacific-TMT-Conference-24407356.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "11/05/2017 04:30 pm",
        "dateTimeISO": "2017-05-11T11:00:00.000Z",
        "title": "FY 2017 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FY-2017-Earnings-Call-24405138.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "11/05/2017",
        "dateTimeISO": "2017-05-10T18:30:00.000Z",
        "title": "FY 2017 Earnings Release Pre-market",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/FY-2017-Earnings-Release-24405013.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "01/02/2017",
        "dateTimeISO": "2017-01-31T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-23776176.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "24/01/2017 04:30 pm",
        "dateTimeISO": "2017-01-24T11:00:00.000Z",
        "title": "Q3 2017 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2017-Earnings-Call-23730606.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "24/01/2017",
        "dateTimeISO": "2017-01-23T18:30:00.000Z",
        "title": "Q3 2017 Earnings Release Pre-market",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Q3-2017-Earnings-Release-22852338.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "17/01/2017",
        "dateTimeISO": "2017-01-16T18:30:00.000Z",
        "title": "Interim 2018 Earnings Release (Projected)",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2018-Earnings-Release-Projected-23770519.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "27/10/2016",
        "dateTimeISO": "2016-10-26T18:30:00.000Z",
        "title": "Ex-dividend day for dividende intermédiaire",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Ex-dividend-day-for-dividende-intermediaire-23259494.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/10/2016 04:30 pm",
        "dateTimeISO": "2016-10-21T11:00:00.000Z",
        "title": "Interim 2017 Earnings Call",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2017-Earnings-Call-23219095.ics"
      },
      {
        "section": "Past",
        "dateTimeRaw": "21/10/2016",
        "dateTimeISO": "2016-10-20T18:30:00.000Z",
        "title": "Interim 2017 Earnings Release Pre-market",
        "icsUrl": "https://in.marketscreener.com/api/stateful/agenda/event-async/Interim-2017-Earnings-Release-23219071.ics"
      }
    ]
      }
    };

    const out = [
  {
    "Quarter": "2020-Mar",
    "Sales": 18587,
    "EPS": 11.67,
    "sales_qoq_change": null,
    "sales_qoq_pct": null,
    "sales_yoy_change": null,
    "sales_yoy_pct": null,
    "eps_qoq_change": null,
    "eps_qoq_pct": null,
    "eps_yoy_change": null,
    "eps_yoy_pct": null
  },
  {
    "Quarter": "2020-Jun",
    "Sales": 17842,
    "EPS": 10.8,
    "sales_qoq_change": -745,
    "sales_qoq_pct": -4.008177758648518,
    "sales_yoy_change": null,
    "sales_yoy_pct": null,
    "eps_qoq_change": -0.8699999999999992,
    "eps_qoq_pct": -7.45501285347043,
    "eps_yoy_change": null,
    "eps_yoy_pct": null
  },
  {
    "Quarter": "2020-Sep",
    "Sales": 18594,
    "EPS": 11.58,
    "sales_qoq_change": 752,
    "sales_qoq_pct": 4.214774128460935,
    "sales_yoy_change": null,
    "sales_yoy_pct": null,
    "eps_qoq_change": 0.7799999999999994,
    "eps_qoq_pct": 7.222222222222216,
    "eps_yoy_change": null,
    "eps_yoy_pct": null
  },
  {
    "Quarter": "2020-Dec",
    "Sales": 19302,
    "EPS": 14.63,
    "sales_qoq_change": 708,
    "sales_qoq_pct": 3.8076798967408845,
    "sales_yoy_change": null,
    "sales_yoy_pct": null,
    "eps_qoq_change": 3.0500000000000007,
    "eps_qoq_pct": 26.3385146804836,
    "eps_yoy_change": null,
    "eps_yoy_pct": null
  },
  {
    "Quarter": "2021-Mar",
    "Sales": 19641,
    "EPS": 4.06,
    "sales_qoq_change": 339,
    "sales_qoq_pct": 1.7562946844886538,
    "sales_yoy_change": 1054,
    "sales_yoy_pct": 5.670630010222198,
    "eps_qoq_change": -10.57,
    "eps_qoq_pct": -72.24880382775119,
    "eps_yoy_change": -7.61,
    "eps_yoy_pct": -65.20994001713797
  },
  {
    "Quarter": "2021-Jun",
    "Sales": 20068,
    "EPS": 11.81,
    "sales_qoq_change": 427,
    "sales_qoq_pct": 2.174023725879538,
    "sales_yoy_change": 2226,
    "sales_yoy_pct": 12.476179800470799,
    "eps_qoq_change": 7.750000000000001,
    "eps_qoq_pct": 190.8866995073892,
    "eps_yoy_change": 1.0099999999999998,
    "eps_yoy_pct": 9.35185185185185
  },
  {
    "Quarter": "2021-Sep",
    "Sales": 20655,
    "EPS": 12.01,
    "sales_qoq_change": 587,
    "sales_qoq_pct": 2.9250548136336456,
    "sales_yoy_change": 2061,
    "sales_yoy_pct": 11.084220716360116,
    "eps_qoq_change": 0.1999999999999993,
    "eps_qoq_pct": 1.6934801016088001,
    "eps_yoy_change": 0.4299999999999997,
    "eps_yoy_pct": 3.7132987910189956
  },
  {
    "Quarter": "2021-Dec",
    "Sales": 22331,
    "EPS": 12.69,
    "sales_qoq_change": 1676,
    "sales_qoq_pct": 8.114258048898572,
    "sales_yoy_change": 3029,
    "sales_yoy_pct": 15.69267433426588,
    "eps_qoq_change": 0.6799999999999997,
    "eps_qoq_pct": 5.6619483763530365,
    "eps_yoy_change": -1.9400000000000013,
    "eps_yoy_pct": -13.260423786739583
  },
  {
    "Quarter": "2022-Mar",
    "Sales": 22597,
    "EPS": 13.27,
    "sales_qoq_change": 266,
    "sales_qoq_pct": 1.1911692266356186,
    "sales_yoy_change": 2956,
    "sales_yoy_pct": 15.050150196018533,
    "eps_qoq_change": 0.5800000000000001,
    "eps_qoq_pct": 4.570527974783295,
    "eps_yoy_change": 9.21,
    "eps_yoy_pct": 226.84729064039414
  },
  {
    "Quarter": "2022-Jun",
    "Sales": 23464,
    "EPS": 12.13,
    "sales_qoq_change": 867,
    "sales_qoq_pct": 3.8367924945789262,
    "sales_yoy_change": 3396,
    "sales_yoy_pct": 16.92246362367949,
    "eps_qoq_change": -1.1399999999999988,
    "eps_qoq_pct": -8.590806330067814,
    "eps_yoy_change": 0.3200000000000003,
    "eps_yoy_pct": 2.709568162574092
  },
  {
    "Quarter": "2022-Sep",
    "Sales": 24686,
    "EPS": 12.89,
    "sales_qoq_change": 1222,
    "sales_qoq_pct": 5.2079781793385616,
    "sales_yoy_change": 4031,
    "sales_yoy_pct": 19.515855725006052,
    "eps_qoq_change": 0.7599999999999998,
    "eps_qoq_pct": 6.265457543281119,
    "eps_yoy_change": 0.8800000000000008,
    "eps_yoy_pct": 7.327227310574528
  },
  {
    "Quarter": "2022-Dec",
    "Sales": 26700,
    "EPS": 15.13,
    "sales_qoq_change": 2014,
    "sales_qoq_pct": 8.158470388074212,
    "sales_yoy_change": 4369,
    "sales_yoy_pct": 19.564730643500067,
    "eps_qoq_change": 2.24,
    "eps_qoq_pct": 17.377812257564003,
    "eps_yoy_change": 2.4400000000000013,
    "eps_yoy_pct": 19.22773837667456
  },
  {
    "Quarter": "2023-Mar",
    "Sales": 26606,
    "EPS": 14.71,
    "sales_qoq_change": -94,
    "sales_qoq_pct": -0.35205992509363293,
    "sales_yoy_change": 4009,
    "sales_yoy_pct": 17.741293092003364,
    "eps_qoq_change": -0.41999999999999993,
    "eps_qoq_pct": -2.7759418374091203,
    "eps_yoy_change": 1.4400000000000013,
    "eps_yoy_pct": 10.851544837980418
  },
  {
    "Quarter": "2023-Jun",
    "Sales": 26296,
    "EPS": 13.05,
    "sales_qoq_change": -310,
    "sales_qoq_pct": -1.1651507178831841,
    "sales_yoy_change": 2832,
    "sales_yoy_pct": 12.069553358336174,
    "eps_qoq_change": -1.6600000000000001,
    "eps_qoq_pct": -11.284840244731475,
    "eps_yoy_change": 0.9199999999999999,
    "eps_yoy_pct": 7.584501236603461
  },
  {
    "Quarter": "2023-Sep",
    "Sales": 26672,
    "EPS": 14.15,
    "sales_qoq_change": 376,
    "sales_qoq_pct": 1.4298752662001823,
    "sales_yoy_change": 1986,
    "sales_yoy_pct": 8.04504577493316,
    "eps_qoq_change": 1.0999999999999996,
    "eps_qoq_pct": 8.429118773946357,
    "eps_yoy_change": 1.2599999999999998,
    "eps_yoy_pct": 9.77501939487975
  },
  {
    "Quarter": "2023-Dec",
    "Sales": 28446,
    "EPS": 16.06,
    "sales_qoq_change": 1774,
    "sales_qoq_pct": 6.651169766046791,
    "sales_yoy_change": 1746,
    "sales_yoy_pct": 6.539325842696629,
    "eps_qoq_change": 1.9099999999999984,
    "eps_qoq_pct": 13.498233215547693,
    "eps_yoy_change": 0.9299999999999979,
    "eps_yoy_pct": 6.14672835426304
  },
  {
    "Quarter": "2024-Mar",
    "Sales": 28499,
    "EPS": 14.72,
    "sales_qoq_change": 53,
    "sales_qoq_pct": 0.18631793573788935,
    "sales_yoy_change": 1893,
    "sales_yoy_pct": 7.114936480493121,
    "eps_qoq_change": -1.339999999999998,
    "eps_qoq_pct": -8.3437110834371,
    "eps_yoy_change": 0.009999999999999787,
    "eps_yoy_pct": 0.06798096532970622
  },
  {
    "Quarter": "2024-Jun",
    "Sales": 28057,
    "EPS": 15.7,
    "sales_qoq_change": -442,
    "sales_qoq_pct": -1.5509316116354959,
    "sales_yoy_change": 1761,
    "sales_yoy_pct": 6.696836020687558,
    "eps_qoq_change": 0.9799999999999986,
    "eps_qoq_pct": 6.657608695652165,
    "eps_yoy_change": 2.6499999999999986,
    "eps_yoy_pct": 20.306513409961674
  },
  {
    "Quarter": "2024-Sep",
    "Sales": 28862,
    "EPS": 15.62,
    "sales_qoq_change": 805,
    "sales_qoq_pct": 2.869159211604947,
    "sales_yoy_change": 2190,
    "sales_yoy_pct": 8.210857828434314,
    "eps_qoq_change": -0.08000000000000007,
    "eps_qoq_pct": -0.509554140127389,
    "eps_yoy_change": 1.4699999999999989,
    "eps_yoy_pct": 10.388692579505292
  },
  {
    "Quarter": "2024-Dec",
    "Sales": 29890,
    "EPS": 16.94,
    "sales_qoq_change": 1028,
    "sales_qoq_pct": 3.5617767306492967,
    "sales_yoy_change": 1444,
    "sales_yoy_pct": 5.076284890670042,
    "eps_qoq_change": 1.320000000000002,
    "eps_qoq_pct": 8.450704225352126,
    "eps_yoy_change": 0.8800000000000026,
    "eps_yoy_pct": 5.479452054794537
  },
  {
    "Quarter": "2025-Mar",
    "Sales": 30246,
    "EPS": 15.9,
    "sales_qoq_change": 356,
    "sales_qoq_pct": 1.1910337905654065,
    "sales_yoy_change": 1747,
    "sales_yoy_pct": 6.130039650514053,
    "eps_qoq_change": -1.040000000000001,
    "eps_qoq_pct": -6.139315230224327,
    "eps_yoy_change": 1.1799999999999997,
    "eps_yoy_pct": 8.016304347826084
  },
  {
    "Quarter": "2025-Jun",
    "Sales": 30349,
    "EPS": 14.18,
    "sales_qoq_change": 103,
    "sales_qoq_pct": 0.3405408979699795,
    "sales_yoy_change": 2292,
    "sales_yoy_pct": 8.16908436397334,
    "eps_qoq_change": -1.7200000000000006,
    "eps_qoq_pct": -10.817610062893085,
    "eps_yoy_change": -1.5199999999999996,
    "eps_yoy_pct": -9.68152866242038
  },
  {
    "Quarter": "2025-Sep",
    "Sales": 31942,
    "EPS": 15.63,
    "sales_qoq_change": 1593,
    "sales_qoq_pct": 5.248937362021812,
    "sales_yoy_change": 3080,
    "sales_yoy_pct": 10.67147113852124,
    "eps_qoq_change": 1.450000000000001,
    "eps_qoq_pct": 10.225669957686891,
    "eps_yoy_change": 0.010000000000001563,
    "eps_yoy_pct": 0.06402048655570784
  }
];
    parsePastResult(companyInfoJson, out);
    console.log(out);
}
