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

/** ---------- PRICE scoring (your rules) ---------- */
/**
 * yoy_price rule (ratio = price_yoy_pct / expectedYoy):
 *  r <= -1        -> -10
 *  -1 .. 0        -> -10 .. -5
 *   0 .. 1        ->  -5 .. +5
 *   1 .. 3        ->  +5 .. +10
 *  r >= 3         -> +10
 */
function ratioToPriceYoyScore(r) {
  if (!isFinite(r)) return -10;
  if (r <= -1) return -10;
  if (r < 0)   return lerpRange(r, -1, 0, -10, -5);
  if (r < 1)   return lerpRange(r, 0, 1, -5, 5);
  if (r < 3)   return lerpRange(r, 1, 3, 5, 10);
  return 10;
}

/**
 * qoq_price rule (ratio = price_qoq_pct / expectedQoq):
 *  r <= -3        -> -10
 *  -3 .. 0        -> -10 .. -5
 *   0 .. 1        ->  -5 .. +5
 *   1 .. 6        ->  +5 .. +10
 *  r >= 6         -> +10
 *
 * (Note: negative region beyond -1 compresses fast to -10 per spec:
 *        anything <= -3 is hard -10. Between -1..0 we lerp -10..-5.)
 */
function ratioToPriceQoqScore(r) {
  if (!isFinite(r)) return -10;
  if (r <= -3) return -10;
  if (r < 0)   return lerpRange(r, -3, 0, -10, -5);
  if (r < 1)   return lerpRange(r, 0, 1, -5, 5);
  if (r < 6)   return lerpRange(r, 1, 6, 5, 10);
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
 * Optional (price): price_yoy_pct -> adds performance.price if present
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

  // ---- price (YoY) optional ----
  let priceBlock = null;
  if (!isNullish(inputJson.price_yoy_pct)) {
    const priceActual = Number(inputJson.price_yoy_pct);
    if (Number.isFinite(priceActual)) {
      const priceRatio = priceActual / expectedYoyGrowth;
      const priceScore = ratioToPriceYoyScore(priceRatio);
      priceBlock = {
        actual: priceActual,
        ratio: priceRatio,
        score: Math.round((priceScore + Number.EPSILON) * 100) / 100
      };
    }
  }

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
    },
    price: priceBlock
  };
}

/**
 * Evaluate QoQ performance (null if any required param is null)
 * Required: EPS, currentDateClosePrice, sales_qoq_pct, eps_qoq_pct
 * Optional (price): price_qoq_pct -> adds performance.price if present
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

  // ---- price (QoQ) optional ----
  let priceBlock = null;
  if (!isNullish(inputJson.price_qoq_pct)) {
    const priceActual = Number(inputJson.price_qoq_pct);
    if (Number.isFinite(priceActual)) {
      const priceRatio = priceActual / expectedQoqGrowth;
      const priceScore = ratioToPriceQoqScore(priceRatio);
      priceBlock = {
        actual: priceActual,
        ratio: priceRatio,
        score: Math.round((priceScore + Number.EPSILON) * 100) / 100
      };
    }
  }

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
    },
    price: priceBlock
  };
}

/** Compute final_score per your rule:
 * final_score = (sign(a)*a^2) + (sign(b)*b^2) + (sign(c)*c^2) + (sign(d)*d^2) = x
 * Report:
 *   x (signed sum of squares)
 *   abs_sqrt_x = sqrt(|x|)  // “now find square root of x only (no sign)”
 * Returns null if any component score missing.
 */
/** 4-part aggregate (no price): same as your previous final_score */
function computeFinalPerformanceScore(perf) {
  if (!perf || !perf.yoy || !perf.qoq) return null;

  const a = perf.yoy?.sales?.score;
  const b = perf.yoy?.eps?.score;
  const c = perf.qoq?.sales?.score;
  const d = perf.qoq?.eps?.score;

  const parts = [a, b, c, d];
  if (parts.some(v => typeof v !== 'number' || !isFinite(v))) return null;

  const x =
    Math.sign(a) * a * a +
    Math.sign(b) * b * b +
    Math.sign(c) * c * c +
    Math.sign(d) * d * d;

  const xFixed = parseFloat(x.toFixed(4));
  const abs_sqrt_x = parseFloat(Math.sqrt(Math.abs(xFixed)).toFixed(4));
  return { x: xFixed, abs_sqrt_x };
}


/** 2-part aggregate (price-only): yoy.price + qoq.price */
function computeFinalPriceScore(perf) {
  if (!perf || !perf.yoy || !perf.qoq) return null;

  const e = perf.yoy?.price?.score;
  const f = perf.qoq?.price?.score;

  const parts = [e, f];
  if (parts.some(v => typeof v !== 'number' || !isFinite(v))) return null;

  const x =
    Math.sign(e) * e * e +
    Math.sign(f) * f * f;

  const xFixed = parseFloat(x.toFixed(4));
  const abs_sqrt_x = parseFloat(Math.sqrt(Math.abs(xFixed)).toFixed(4));
  return { x: xFixed, abs_sqrt_x };
}


/** -------- Derived helpers for arrays (QoQ price %) -------- */
/**
 * If a row lacks price_qoq_pct, derive it from the previous row’s current price:
 * price_qoq_pct = ((curr - prev) / prev) * 100
 */
function derivePriceQoqPctOnArray(rows) {
  const out = rows.map(r => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    const row = out[i];
    const hasQoq = Number.isFinite(Number(row.price_qoq_pct));
    if (hasQoq) continue;

    const curr = Number(row.currentDateClosePrice);
    let prev = undefined;

    // find previous row with a finite current price
    for (let j = i - 1; j >= 0; j--) {
      const cand = Number(out[j].currentDateClosePrice);
      if (Number.isFinite(cand)) { prev = cand; break; }
    }

    if (Number.isFinite(curr) && Number.isFinite(prev) && prev !== 0) {
      row.price_qoq_pct = ((curr - prev) / prev) * 100;
    } else {
      row.price_qoq_pct = null;
    }
  }
  return out;
}

/**
 * Enrich an array of quarter rows by adding:
 * performance: { yoy, qoq, final_score }
 * Strict null policy: if any required input for YoY/QoQ is null → that section = null
 * If any score is missing → final_score = null
 *
 * Also: auto-derives price_qoq_pct if missing using previous row’s closing price.
 *
 * @param {Array<Object>} rows
 * @returns {Array<Object>}
 */
function addPerformanceToRows(rows) {
  if (!Array.isArray(rows)) throw new Error('Input must be an array');

  const rowsWithDerivedPrice = derivePriceQoqPctOnArray(rows);

  return rowsWithDerivedPrice.map(row => {
    const yoy = evalYoyPerformance(row);
    const qoq = evalQoqPerformance(row);

    const final_performance_score =
      (yoy && qoq) ? computeFinalPerformanceScore({ yoy, qoq }) : null;

    const final_price_score =
      (yoy && qoq) ? computeFinalPriceScore({ yoy, qoq }) : null;

    return {
      ...row,
      performance: {
        yoy,
        qoq,
        final_performance_score, // 4-part (no price)
        final_price_score        // 2-part (price-only)
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
  ratioToPriceYoyScore,
  ratioToPriceQoqScore,
  derivePriceQoqPctOnArray
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
    "eps_yoy_pct": null,
    "dateTimeRaw": "07/05/2020",
    "currentDateClosePrice": 511.75,
    "pastYearDateClosePrice": 565.875,
    "price_yoy_pct": -9.564833222884912
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
    "eps_yoy_pct": null,
    "dateTimeRaw": "17/07/2020",
    "currentDateClosePrice": 623.15,
    "pastYearDateClosePrice": 520.375,
    "price_yoy_pct": 19.75018015853951
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
    "eps_yoy_pct": null,
    "dateTimeRaw": "16/10/2020",
    "currentDateClosePrice": 827.15,
    "pastYearDateClosePrice": 550.45,
    "price_yoy_pct": 50.26796257607411
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
    "eps_yoy_pct": null,
    "dateTimeRaw": "15/01/2021",
    "currentDateClosePrice": 989.8,
    "pastYearDateClosePrice": 595.75,
    "price_yoy_pct": 66.14351657574485
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
    "eps_yoy_pct": -65.20994001713797,
    "dateTimeRaw": "23/04/2021",
    "currentDateClosePrice": 955.65,
    "pastYearDateClosePrice": 477.7,
    "price_yoy_pct": 100.05233410090015
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
    "eps_yoy_pct": 9.35185185185185,
    "dateTimeRaw": "19/07/2021",
    "currentDateClosePrice": 1000.2,
    "pastYearDateClosePrice": 623.15,
    "price_yoy_pct": 60.5071010190163
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
    "eps_yoy_pct": 3.7132987910189956,
    "dateTimeRaw": "14/10/2021 06:21 pm",
    "currentDateClosePrice": 1251.15,
    "pastYearDateClosePrice": 890.45,
    "price_yoy_pct": 40.50760851254984
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
    "eps_yoy_pct": -13.260423786739583,
    "dateTimeRaw": "14/01/2022 06:25 pm",
    "currentDateClosePrice": 1337.2,
    "pastYearDateClosePrice": 1027.7,
    "price_yoy_pct": 30.11579254646297
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
    "eps_yoy_pct": 226.84729064039414,
    "dateTimeRaw": "21/04/2022 07:30 pm",
    "currentDateClosePrice": 1099.2,
    "pastYearDateClosePrice": 961.3,
    "price_yoy_pct": 14.345157599084581
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
    "eps_yoy_pct": 2.709568162574092,
    "dateTimeRaw": "12/07/2022 05:56 pm",
    "currentDateClosePrice": 927.8,
    "pastYearDateClosePrice": 979.45,
    "price_yoy_pct": -5.273367706365827
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
    "eps_yoy_pct": 7.327227310574528,
    "dateTimeRaw": "12/10/2022 04:14 pm",
    "currentDateClosePrice": 952,
    "pastYearDateClosePrice": 1250.35,
    "price_yoy_pct": -23.86131883072739
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
    "eps_yoy_pct": 19.22773837667456,
    "dateTimeRaw": "12/01/2023 05:28 pm",
    "currentDateClosePrice": 1071.65,
    "pastYearDateClosePrice": 1352.15,
    "price_yoy_pct": -20.74473985874348
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
    "eps_yoy_pct": 0.06402048655570784,
    "dateTimeRaw": "Today",
    "currentDateClosePrice": null,
    "pastYearDateClosePrice": null,
    "price_yoy_pct": null
  }
];

  const out = addPerformanceToRows(inputArray);
  console.log(JSON.stringify(out, null)); // <--- final json
}
