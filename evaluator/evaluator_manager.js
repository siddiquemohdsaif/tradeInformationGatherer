// evaluator/evaluator_manager.js
// Full pipeline:
//   BSE fetch & parse -> macro_eval (QoQ/YoY) -> attach dates (past_result_date_eval)
//   -> attach prices (past_result_price_eval) -> console.log final JSON
//
// CLI:
//   node evaluator_manager.js <BSE_COMPANY_CODE> "<from>" "<to>" <type>
//   <type>: c (consolidated) | s (standalone)
// Example:
//   node evaluator_manager.js 532281 "2025 Mar" "2025 Sep" c

const fs = require('fs');
const path = require('path');

const { fetchBseQuarterRange } = require('../bse/bse_quarterly_past_results_fetcher');
const quarter_parser = require('../bse/bse_quarterly_results_parser');
const { computeQuarterlyGrowth } = require('./macro_eval');
const { parsePastResult } = require('./past_result_date_eval');      // expects: parsePastResult(companyInfoJson, outJson)
const { parsePastStockPrice } = require('./past_result_price_eval'); // expects: parsePastStockPrice(outJson, nseSymbol)
const { addPerformanceToRows } = require('./result_eval'); // expects: addPerformanceToRows(rows)

/* ----------------------- helpers ----------------------- */

function normalizeRType(type) {
    const t = String(type || '').trim().toLowerCase();
    if (t === 's' || t === 'standalone') return 'D'; // your fetcher uses 'D' for standalone
    return 'c';
}

function pickParser(type, smooth) { // smooth true use  => parseStockConsolidatedWithSmooth

    const t = String(type || '').trim().toLowerCase();
    if ((t === 's' || t === 'standalone') && typeof quarter_parser.parseStockStandalone === 'function') {
        return quarter_parser.parseStockStandalone;
    }
    if (typeof quarter_parser.parseStockConsolidated === 'function') { 
        if(smooth && typeof quarter_parser.parseStockConsolidatedWithSmooth === 'function'){
            return quarter_parser.parseStockConsolidatedWithSmooth;
        }
        return quarter_parser.parseStockConsolidated;
    }
    throw new Error('No suitable parser available in bse_quarterly_results_parser.');
}

// Be generous about what the parser might return (array / stringified / wrapper + toJSON)
function coerceToArray(val) {
    if (Array.isArray(val)) return val;

    if (val && typeof val.toJSON === 'function') {
        const j = val.toJSON();
        if (Array.isArray(j)) return j;
        if (typeof j === 'string') {
            try {
                const parsedStr = JSON.parse(j);
                if (Array.isArray(parsedStr)) return parsedStr;
            } catch (_) { }
        }
    }

    if (val && typeof val === 'object') {
        if (Array.isArray(val.rows)) return val.rows;
        if (Array.isArray(val.data)) return val.data;
        if (Array.isArray(val.value)) return val.value;
    }

    if (typeof val === 'string') {
        try {
            const parsedStr = JSON.parse(val);
            if (Array.isArray(parsedStr)) return parsedStr;
        } catch (_) { }
    }

    return null;
}

/**
 * companies_info.json looks like:
 *  {
 *    "HCLTECH": ["<nse_symbol>", "<marketscreener_id>", "hcl-technologies-ltd/hcltech/532281"],
 *    ...
 *  }
 * We need to find the NSE symbol using the given BSE company code.
 */
function getNSESmbFromBSECode(bseCode, companiesInfo) {
    const code = String(bseCode).trim();
    for (const [nseSymbol, arr] of Object.entries(companiesInfo || {})) {
        // arr[2] is the BSE path "…/<SYMBOL>/<CODE>"
        const bsePath = Array.isArray(arr) ? arr[2] : null;
        if (typeof bsePath !== 'string') continue;
        const parts = bsePath.split('/');
        const last = parts[parts.length - 1];       // e.g., "532281"
        const secondLast = parts[parts.length - 2]; // e.g., "HCLTECH"
        if (last === code) {
            // Prefer the explicit NSE key, fallback to secondLast (symbol in path)
            return nseSymbol || secondLast;
        }
    }
    return null;
}

/**
 * Try to load a "company info JSON" from disk using common filenames.
 * We’ll try several basenames derived from NSE symbol and also the MarketScreener ID.
 */
function tryLoadCompanyInfoJson(nseSymbol, msId) {
    const candidates = [
        path.join(__dirname, '..', 'data', 'company_info', `${nseSymbol}.json`),
        path.join(__dirname, '..', 'data', 'company_info', `${nseSymbol}.min.json`),
        path.join(__dirname, '..', 'data', 'company_info', `${msId}.json`),
        path.join(__dirname, '..', 'data', 'company_info', `${msId}.min.json`),
        // fallback older folder names if you use them
        path.join(__dirname, '..', 'data', `${nseSymbol}.json`),
        path.join(__dirname, '..', 'data', `${msId}.json`),
    ];

    for (const file of candidates) {
        try {
            if (fs.existsSync(file)) {
                const raw = fs.readFileSync(file, 'utf8');
                return JSON.parse(raw);
            }
        } catch (_) {
            // keep trying others
        }
    }
    return null;
}

/* --------------- core builders / orchestrators --------------- */

async function buildQuarterRows({ companyCode, from, to, type, smooth }) {
    const rType = normalizeRType(type);
    const rawBundle = await fetchBseQuarterRange({ companyCode, from, to, rType });

    const parserFn = pickParser(type, smooth);
    const parsed = await parserFn(rawBundle);
    const rows = coerceToArray(parsed);

    if (!Array.isArray(rows)) {
        console.log('Parsed quarterly data:', parsed);
        const shapeHint =
            typeof parsed === 'string'
                ? `string(len=${parsed.length})`
                : parsed && typeof parsed === 'object'
                    ? `object(keys=${Object.keys(parsed)})`
                    : String(typeof parsed);

        let toJsonHint = 'none';
        if (parsed && typeof parsed.toJSON === 'function') {
            try {
                const tj = parsed.toJSON();
                toJsonHint = Array.isArray(tj)
                    ? 'toJSON() -> array'
                    : typeof tj === 'string'
                        ? `toJSON() -> string(len=${tj.length})`
                        : `toJSON() -> ${typeof tj}`;
            } catch (e) {
                toJsonHint = `toJSON() threw: ${e?.message || e}`;
            }
        }
        throw new Error(`Parsed quarterly data is not an array. shape=${shapeHint}, ${toJsonHint}`);
    }
    return rows;
}

async function evaluateQuarterRange({ companyCode, from, to, type = 'c' , smooth = true}) {
    // 1) raw rows (Mar/Jun/Sep/Dec blocks)
    const rows = await buildQuarterRows({ companyCode, from, to, type , smooth}); //[{...},{...}]

    // 2) QoQ/YoY metrics
    let evaluated = computeQuarterlyGrowth(rows, smooth);
    // add rows metadata for downstream evals as per index rows[i]
    evaluated = evaluated.map((r, i) => ({ ...r, etrra_info: rows[i] }));

    return evaluated;
}

function loadInfoByMarketScreenerId(msCode) {
    if (!msCode) return null;
    const file = path.join(__dirname, '..', 'data', 'info', `${msCode}.json`);
    try {
        if (fs.existsSync(file)) {
            const raw = fs.readFileSync(file, 'utf8');
            return JSON.parse(raw);
        }
    } catch (_) { }
    return null;
}

/**
 * End-to-end pipeline:
 * 1) Evaluate quarterly numbers (QoQ/YoY)
 * 2) Attach dateTimeRaw using past_result_date_eval (if company info JSON is found)
 * 3) Attach prices using past_result_price_eval (if NSE symbol is found)
 */
async function runPipeline({ companyCode, from, to, type }) {
    let out = await evaluateQuarterRange({ companyCode, from, to, type });

    // Load companies_info.json
    const companiesInfoPath = path.join(__dirname, '..', 'data', 'companies_info.json');
    let companiesInfo = null;
    try {
        companiesInfo = JSON.parse(fs.readFileSync(companiesInfoPath, 'utf8'));
    } catch (e) {
        // If this fails, we’ll still return QoQ/YoY output without date/price
    }

    // Derive NSE symbol (and MarketScreener ID if you want to try resolving file)
    let nseSymbol = null;
    let msCode = null;

    if (companiesInfo) {
        nseSymbol = getNSESmbFromBSECode(companyCode, companiesInfo);
        if (nseSymbol && Array.isArray(companiesInfo[nseSymbol])) {
            // [0]=NSE symbol, [1]=MARKET_SCREENER code, [2]=BSE path (.../<SYMBOL>/<CODE>)
            msCode = companiesInfo[nseSymbol][1] || null;
        }
    }

    // Try to load company info JSON by MarketScreener code -> enrich dateTimeRaw
    if (msCode) {
        const companyInfoJson = loadInfoByMarketScreenerId(msCode);
        if (companyInfoJson) {
            try {
                parsePastResult(companyInfoJson, out); // mutates 'out'
            } catch (e) {
                // silently continue without dates if shape unexpected
            }
        }
    }

    // Now attach price info if we have an NSE symbol (used by your groww/stockHistoricalInfo)
    if (nseSymbol) {
        try {
            await parsePastStockPrice(out, nseSymbol);
        } catch (e) {
            // Continue without price data on failure
        }
    }


    // now result eval : using v2
    out = addPerformanceToRows(out);



    //Save to data/analyser/performance/[NSE].json if we resolved NSE symbol
    if (nseSymbol && typeof nseSymbol === 'string' && nseSymbol.trim()) {
      const outDir = path.join(__dirname, '..', 'data', 'analyser', 'performance');
      const outFile = path.join(outDir, `${nseSymbol}.json`);
    
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
    
      // Let the user know on STDERR so it doesn't pollute JSON STDOUT
      console.error(`Saved → ${outFile}`);
    } else {
      console.error('Warning: NSE symbol not resolved. Skipped saving to file.');
    }
    


    return out;
}

/* --------------------------- CLI --------------------------- */

if (require.main === module) {
    (async () => {
        const [companyCode, from, to, type = 'c'] = process.argv.slice(2);

        if (!companyCode || !from || !to) {
            const script = path.basename(process.argv[1]);
            console.error(
                `Usage: node ${script} <BSE_COMPANY_CODE> "<from>" "<to>" <type>\n` +
                `  <type>: c (consolidated) | s (standalone)\n` +
                `Example:\n` +
                `  node ${script} 532281 "2025 Mar" "2025 Sep" c`
            );
            process.exit(1);
        }

        try {
            const finalOut = await runPipeline({ companyCode, from, to, type });
            console.log(JSON.stringify(finalOut, null, 2));
        } catch (err) {
            console.error('Error:', err?.message || err);
            process.exit(2);
        }
    })();
}

module.exports = {
    evaluateQuarterRange,
    runPipeline,
};
