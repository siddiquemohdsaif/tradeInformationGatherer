// result_eval.js

const PE_GROWTH_TABLE = [
  { pe_min: 0, pe_max: 10,  yoy_min: 5,  yoy_max: 8 },
  { pe_min: 10, pe_max: 20, yoy_min: 8,  yoy_max: 12 },
  { pe_min: 20, pe_max: 30, yoy_min: 12, yoy_max: 15 },
  { pe_min: 30, pe_max: 40, yoy_min: 15, yoy_max: 20 },
  { pe_min: 40, pe_max: 80, yoy_min: 20, yoy_max: 35 },
  { pe_min: 80, pe_max: 100, yoy_min: 35, yoy_max: 50 },
  { pe_min: 100, pe_max: 200, yoy_min: 50, yoy_max: 70 },
  { pe_min: 200, pe_max: Infinity, yoy_min: 70, yoy_max: 100 } // 70+
];

/**
 * Estimate YoY-growth % based on PE ratio using linear interpolation
 * @param {number} pe - Price to Earnings ratio
 * @returns {number} estimated YoY growth percentage
 */
function estimateGrowth(pe) {
  if (typeof pe !== 'number' || pe < 0) {
    throw new Error('PE must be a positive number');
  }
  const band = PE_GROWTH_TABLE.find(b => pe >= b.pe_min && pe < b.pe_max);
  if (!band) return null;

  // If infinite upper bound, just return min value as conservative estimate
  if (!isFinite(band.pe_max)) return band.yoy_min;

  // Linear interpolation
  const ratio = (pe - band.pe_min) / (band.pe_max - band.pe_min);
  const growth = band.yoy_min + ratio * (band.yoy_max - band.yoy_min);
  return parseFloat(growth.toFixed(2));
}

/** Linear interpolate from [x1,x2] -> [y1,y2] for x */
function lerpRange(x, x1, x2, y1, y2) {
  if (x <= x1) return y1;
  if (x >= x2) return y2;
  const t = (x - x1) / (x2 - x1);
  return y1 + t * (y2 - y1);
}

/**
 * Convert ratio (actual/expected) to score in [-10, 10]
 * Buckets:
 *  r < 0.30       -> -10
 *  0.30 .. 0.7    -> -10 .. 0
 *  0.7  .. 1      -> 0 .. 5
 *  1    .. 2      -> 5 .. 10
 *  r >= 2         -> 10
 */
function ratioToScore(ratio) {
  if (!isFinite(ratio)) return -10;
  if (ratio < 0.30) return -10;
  if (ratio < 0.7) return lerpRange(ratio, 0.30, 0.7, -10, 0);
  if (ratio < 1)   return lerpRange(ratio, 0.7, 1, 0, 5);
  if (ratio < 2)   return lerpRange(ratio, 1, 2, 5, 10);
  return 10;
}

/** Piecewise scorer for QoQ: actual/expected => score in [-10, 10] */
function ratioToQoqScore(r) {
  if (!isFinite(r)) return -10;
  if (r <= -2) return -10;
  if (r < 0)   return lerpRange(r, -1, 0, -10, 0);
  if (r < 1)   return lerpRange(r, 0, 1, 0, 3);
  if (r < 3)   return lerpRange(r, 1, 3, 3, 10);
  return 10;
}

/** ---------- Helpers for null-safe gating ---------- */
function isNullish(v) {
  return v === null || v === undefined;
}
function requiredPresent(obj, keys) {
  return keys.every(k => !isNullish(obj[k]));
}
function safePE(EPS, price) {
  const pe = price / (4 * EPS);
  return Number.isFinite(pe) && pe >= 0 ? pe : null;
}

/**
 * Evaluate YoY performance (null if any required param is null)
 * Required: EPS, currentDateClosePrice, sales_yoy_pct, eps_yoy_pct
 */
function evalYoyPerformance(inputJson) {
  if (!inputJson || typeof inputJson !== 'object') {
    throw new Error('Invalid inputJson');
  }

  const needed = ['EPS', 'currentDateClosePrice', 'sales_yoy_pct', 'eps_yoy_pct'];
  if (!requiredPresent(inputJson, needed)) return null;

  const EPS = Number(inputJson.EPS);
  const price = Number(inputJson.currentDateClosePrice);
  const PE = safePE(EPS, price);
  if (!Number.isFinite(EPS) || EPS === 0 || !Number.isFinite(price) || PE === null) return null;

  const expectedYoyGrowth = estimateGrowth(PE);
  if (!Number.isFinite(expectedYoyGrowth) || expectedYoyGrowth <= 0) return null;

  const salesActual = Number(inputJson.sales_yoy_pct);
  const epsActual   = Number(inputJson.eps_yoy_pct);
  if (!Number.isFinite(salesActual) || !Number.isFinite(epsActual)) return null;

  const salesRatio = salesActual / expectedYoyGrowth;
  const epsRatio   = epsActual   / expectedYoyGrowth;

  const salesScore = ratioToScore(salesRatio);
  const epsScore   = ratioToScore(epsRatio);

  return {
    expectedYoyGrowth: parseFloat(expectedYoyGrowth.toFixed(2)),
    sales: {
      actual: salesActual,
      ratio: salesRatio,
      score: Math.round((salesScore + Number.EPSILON) * 100) / 100
    },
    eps: {
      actual: epsActual,
      ratio: epsRatio,
      score: Math.round((epsScore + Number.EPSILON) * 100) / 100
    }
  };
}

/**
 * Evaluate QoQ performance (null if any required param is null)
 * Required: EPS, currentDateClosePrice, sales_qoq_pct, eps_qoq_pct
 */
function evalQoqPerformance(inputJson) {
  if (!inputJson || typeof inputJson !== 'object') {
    throw new Error('Invalid inputJson');
  }

  const needed = ['EPS', 'currentDateClosePrice', 'sales_qoq_pct', 'eps_qoq_pct'];
  if (!requiredPresent(inputJson, needed)) return null;

  const EPS = Number(inputJson.EPS);
  const price = Number(inputJson.currentDateClosePrice);
  const PE = safePE(EPS, price);
  if (!Number.isFinite(EPS) || EPS === 0 || !Number.isFinite(price) || PE === null) return null;

  const expectedYoy = estimateGrowth(PE);
  if (!Number.isFinite(expectedYoy) || expectedYoy <= 0) return null;

  const expectedQoqGrowth = expectedYoy / 4;
  if (!Number.isFinite(expectedQoqGrowth) || expectedQoqGrowth <= 0) return null;

  const salesActual = Number(inputJson.sales_qoq_pct);
  const epsActual   = Number(inputJson.eps_qoq_pct);
  if (!Number.isFinite(salesActual) || !Number.isFinite(epsActual)) return null;

  const salesRatio = salesActual / expectedQoqGrowth;
  const epsRatio   = epsActual   / expectedQoqGrowth;

  const salesScore = ratioToQoqScore(salesRatio);
  const epsScore   = ratioToQoqScore(epsRatio);

  return {
    expectedQoqGrowth: parseFloat(expectedQoqGrowth.toFixed(4)),
    sales: {
      actual: salesActual,
      ratio: salesRatio,
      score: Math.round((salesScore + Number.EPSILON) * 100) / 100
    },
    eps: {
      actual: epsActual,
      ratio: epsRatio,
      score: Math.round((epsScore + Number.EPSILON) * 100) / 100
    }
  };
}

/** Compute final_score per your rule:
 * final_score = (sign(a)*a^2) + (sign(b)*b^2) + (sign(c)*c^2) + (sign(d)*d^2) = x
 * Report:
 *   x (signed sum of squares)
 *   abs_sqrt_x = sqrt(|x|)  // “now find square root of x only (no sign)”
 * Returns null if any component score missing.
 */
function computeFinalScore(perf) {
  if (!perf || !perf.yoy || !perf.qoq) return null;

  const s1 = perf.yoy?.sales?.score;
  const s2 = perf.yoy?.eps?.score;
  const s3 = perf.qoq?.sales?.score;
  const s4 = perf.qoq?.eps?.score;

  const scores = [s1, s2, s3, s4];
  if (scores.some(v => typeof v !== 'number' || !isFinite(v))) return null;

  const signedSum =
    Math.sign(s1) * s1 * s1 +
    Math.sign(s2) * s2 * s2 +
    Math.sign(s3) * s3 * s3 +
    Math.sign(s4) * s4 * s4;

  const x = parseFloat(signedSum.toFixed(4));
  const abs_sqrt_x = parseFloat(Math.sqrt(Math.abs(x)).toFixed(4));

  return {
    x,             // +/- (x)
    abs_sqrt_x     // +/- [(x)^1/2]  (magnitude only; sign not included)
  };
}

/**
 * Enrich an array of quarter rows by adding:
 * performance: { yoy, qoq, final_score }
 * Strict null policy: if any required input for YoY/QoQ is null → that section = null
 * If any score is missing → final_score = null
 *
 * @param {Array<Object>} rows
 * @returns {Array<Object>}
 */
function addPerformanceToRows(rows) {
  if (!Array.isArray(rows)) throw new Error('Input must be an array');

  return rows.map(row => {
    const yoy = evalYoyPerformance(row);
    const qoq = evalQoqPerformance(row);
    const final_score = (yoy && qoq) ? computeFinalScore({yoy, qoq}) : null;

    return {
      ...row,
      performance: {
        yoy,
        qoq,
        final_score
      }
    };
  });
}

// ----------------- Exports -----------------
module.exports = {
  estimateGrowth,
  evalYoyPerformance,
  evalQoqPerformance,
  addPerformanceToRows,
  computeFinalScore
};

// ---- Example CLI Usage ----
// 1) Single PE check:
//    node result_eval.js 90
// 2) With sample array baked in below, it will log the final enriched JSON.
if (require.main === module) {
  const peInput = parseFloat(process.argv[2] || 90);
  const est = estimateGrowth(peInput);
  console.log(`PE: ${peInput} => Estimated YoY Growth: ${est}%`);

  // --- sample quarter for quick sanity ---
  const sample = {
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
    "eps_yoy_pct": 10.388692579505292,
    "dateTimeRaw": "14/10/2024 05:37 pm",
    "currentDateClosePrice": 1855.9,
    "pastYearDateClosePrice": 1255.9,
    "price_yoy_pct": 47.77450433951748
  };
  console.log('YoY Performance:', evalYoyPerformance(sample));
  console.log('QoQ Performance:', evalQoqPerformance(sample));

  // ---- Replace this array with your real input array ----
  const inputArray = [
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
    "eps_yoy_pct": 10.851544837980418,
    "dateTimeRaw": "20/04/2023 05:00 pm",
    "currentDateClosePrice": 1037.5,
    "pastYearDateClosePrice": 1089.4,
    "price_yoy_pct": -4.764090324949521
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
    "eps_yoy_pct": 7.584501236603461,
    "dateTimeRaw": "12/07/2023 06:08 pm",
    "currentDateClosePrice": 1110.55,
    "pastYearDateClosePrice": 927.8,
    "price_yoy_pct": 19.697133002802328
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
    "eps_yoy_pct": 9.77501939487975,
    "dateTimeRaw": "13/10/2023 12:11 am",
    "currentDateClosePrice": 1255.9,
    "pastYearDateClosePrice": 982.1,
    "price_yoy_pct": 27.87903472151513
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
    "eps_yoy_pct": 6.14672835426304,
    "dateTimeRaw": "12/01/2024 05:41 pm",
    "currentDateClosePrice": 1540.8,
    "pastYearDateClosePrice": 1071.65,
    "price_yoy_pct": 43.77828582093032
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
    "eps_yoy_pct": 0.06798096532970622,
    "dateTimeRaw": "26/04/2024 05:31 pm",
    "currentDateClosePrice": 1473.85,
    "pastYearDateClosePrice": 1065.55,
    "price_yoy_pct": 38.31823940687907
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
    "eps_yoy_pct": 20.306513409961674,
    "dateTimeRaw": "12/07/2024 05:45 pm",
    "currentDateClosePrice": 1560.2,
    "pastYearDateClosePrice": 1110.55,
    "price_yoy_pct": 40.4889469181937
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
    "eps_yoy_pct": 10.388692579505292,
    "dateTimeRaw": "14/10/2024 05:37 pm",
    "currentDateClosePrice": 1855.9,
    "pastYearDateClosePrice": 1255.9,
    "price_yoy_pct": 47.77450433951748
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
    "eps_yoy_pct": 5.479452054794537,
    "dateTimeRaw": "13/01/2025 05:43 pm",
    "currentDateClosePrice": 1989.4,
    "pastYearDateClosePrice": 1540.8,
    "price_yoy_pct": 29.114745586708214
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
    "eps_yoy_pct": 8.016304347826084,
    "dateTimeRaw": "22/04/2025 10:46 pm",
    "currentDateClosePrice": 1479.9,
    "pastYearDateClosePrice": 1465.9,
    "price_yoy_pct": 0.9550446824476431
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
    "eps_yoy_pct": -9.68152866242038,
    "dateTimeRaw": "14/07/2025 05:37 pm",
    "currentDateClosePrice": 1619.8,
    "pastYearDateClosePrice": 1560.2,
    "price_yoy_pct": 3.8200230739648706
  }
    // ... add the rest
  ];

  const out = addPerformanceToRows(inputArray);
  console.log(JSON.stringify(out, null, 2)); // <--- log final json
}
