// comanpanyDataViewPannel.js
// Usage: node comanpanyDataViewPannel.js path/to/data.json
// Starts a web server on port 3000 and renders your dataset in the browser.

const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = 3000;

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('❌ Please provide a JSON file path.\n   Example: node comanpanyDataViewPannel.js ./data.json');
  process.exit(1);
}

let loaded = null;
let lastLoadError = null;
const absJsonPath = path.resolve(jsonPath);

function loadData() {
  try {
    const raw = fs.readFileSync(absJsonPath, 'utf8');
    loaded = JSON.parse(raw);
    lastLoadError = null;
    console.log(`✅ Loaded data: ${absJsonPath} (${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})`);
  } catch (e) {
    lastLoadError = e.message;
    console.error('❌ Failed to load JSON:', e.message);
  }
}
loadData();

// Optional: hot-reload the JSON when it changes
try {
  fs.watch(absJsonPath, { persistent: true }, (evt) => {
    if (evt === 'change') {
      // slight delay to avoid partial writes
      setTimeout(loadData, 150);
    }
  });
  console.log('👀 Watching for changes:', absJsonPath);
} catch (_) {
  // ignore if platform doesn't support watch
}

const app = express();

// Data endpoint
app.get('/data', (req, res) => {
  if (lastLoadError) {
    return res.status(500).json({ error: 'Failed to load JSON', detail: lastLoadError });
  }
  res.json(loaded || {});
});

// Root UI
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Company Data View Panel</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #0b0f14;
      --card: #121a22;
      --soft: #1a2530;
      --text: #e9eef4;
      --muted: #a7b3bf;
      --accent: #46c2ff;
      --accent2: #91ffbe;
      --bad: #ff8ea1;
      --good: #7dffb3;
      --gap: 18px;
      --radius: 14px;
      --shadow: 0 8px 24px rgba(0,0,0,0.25);
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font: 16px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, sans-serif;
      color: var(--text);
      background: radial-gradient(1200px 600px at 10% 0%, #0d1420, #0b0f14 60%);
    }
    .wrap {
      padding: 24px;
      max-width: 1400px;
      margin: 0 auto;
    }
    .header {
      background: var(--card);
      border: 1px solid var(--soft);
      border-radius: 20px;
      padding: 20px 24px;
      box-shadow: var(--shadow);
    }
    .title {
      display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    }
    .title h1 { margin: 0; font-size: 28px; letter-spacing: .5px; }
    .title .tag {
      padding: 6px 10px; border-radius: 999px; background: var(--soft); color: var(--muted);
      font-size: 13px; border: 1px solid #15202a;
    }
    .row { display: grid; gap: var(--gap); }
    .row.kpis { grid-template-columns: repeat(4, 1fr); margin-top: var(--gap); }
    .card {
      background: var(--card);
      border: 1px solid var(--soft);
      border-radius: var(--radius);
      padding: 16px;
      box-shadow: var(--shadow);
      min-width: 0;
    }
    .kpi .label { color: var(--muted); font-weight: 700; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
    .kpi .value { font-size: 28px; font-weight: 800; margin-top: 8px; }
    .kpi .sub { color: var(--muted); margin-top: 6px; font-size: 13px; }
    .kpi .badge { margin-left: 8px; font-size: 13px; padding: 2px 8px; border-radius: 999px; }
    .badge-up { background: rgba(125,255,179,.15); color: var(--good); border: 1px solid rgba(125,255,179,.35); }
    .badge-down { background: rgba(255,142,161,.12); color: var(--bad); border: 1px solid rgba(255,142,161,.35); }

    .grid {
      display: grid; gap: var(--gap);
      grid-template-columns: 1.2fr 1fr;
      margin-top: var(--gap);
    }

    .table { width: 100%; border-collapse: separate; border-spacing: 0; }
    .table th, .table td { padding: 10px 12px; text-align: right; }
    .table th:first-child, .table td:first-child { text-align: left; }
    .table thead th {
      position: sticky; top: 0;
      background: #0f1620; color: var(--text); border-bottom: 1px solid var(--soft);
    }
    .table tbody tr:nth-child(odd) td { background: #0e151c; }
    .table tbody tr td { border-bottom: 1px dashed #15202a; color: var(--muted); }
    .table-wrap { max-height: 420px; overflow: auto; border: 1px solid var(--soft); border-radius: 10px; }

    .list { display: grid; gap: 10px; }
    .li {
      display: grid; gap: 6px;
      background: #0e151c; border: 1px solid #15202a; border-radius: 10px; padding: 10px 12px;
    }
    .li .t { font-weight: 700; }
    .li .d { color: var(--muted); font-size: 13px; }

    .section-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .section-title h3 { margin: 0; font-size: 18px; }
    .btn {
      background: var(--soft); border: 1px solid #15202a; color: var(--text);
      padding: 6px 10px; border-radius: 8px; cursor: pointer; font-weight: 600;
    }
    .btn:hover { filter: brightness(1.1); }

    .foot { margin-top: 14px; color: var(--muted); font-size: 12px; }
    .charts { display: grid; gap: var(--gap); grid-template-columns: 1fr 1fr; }
    canvas { background: #0f1620; border: 1px solid #15202a; border-radius: 10px; padding: 10px; }
    @media (max-width: 1100px) {
      .row.kpis { grid-template-columns: repeat(2, 1fr); }
      .grid { grid-template-columns: 1fr; }
      .charts { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="title">
        <h1 id="companyTitle">Company</h1>
        <span class="tag" id="companyCodeTag">Code</span>
        <span class="tag" id="tsTag">Generated: —</span>
        <button class="btn" id="reloadBtn" title="Re-load data.json">Reload data</button>
      </div>
      <div class="foot" id="msLink"></div>
    </div>

    <div class="row kpis" id="kpis"></div>

    <div class="grid">
      <div class="card">
        <div class="section-title">
          <h3 id="annualTitle">Annual Snapshot</h3>
        </div>
        <div class="table-wrap">
          <table class="table" id="annualTable"></table>
        </div>
        <div class="charts" style="margin-top: 12px;">
          <div>
            <div class="section-title"><h3>Sales (Mn) – Last 5 Years</h3></div>
            <canvas id="salesChart" height="240"></canvas>
          </div>
          <div>
            <div class="section-title"><h3>EPS – Last 5 Years</h3></div>
            <canvas id="epsChart" height="240"></canvas>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-title"><h3>Quarterly (Last 4 Periods)</h3></div>
        <div class="table-wrap">
          <table class="table" id="quarterlyTable"></table>
        </div>

        <div class="section-title" style="margin-top: 14px;"><h3>Upcoming Events</h3></div>
        <div class="list" id="upcomingList"></div>

        <div class="section-title" style="margin-top: 14px;"><h3>Recent Dividends</h3></div>
        <div class="list" id="divList"></div>
      </div>
    </div>
  </div>

  <script>
    // ------- Utilities -------
    const INR_FMT = new Intl.NumberFormat('en-IN');
    function parseNumberLike(n) {
      if (n === null || n === undefined) return null;
      if (typeof n === 'number') return n;
      const s = String(n).replace(/\\s+/g, '').replace(',', '.');
      const f = parseFloat(s);
      return Number.isFinite(f) ? f : null;
    }
    function pctDiff(curr, prev) {
      if (curr == null || prev == null || prev === 0) return null;
      return ((curr - prev) / prev) * 100;
    }
    function byYear(a,b){ return a - b; }
    function yearKeys(obj){ return Object.keys(obj||{}).map(x=>parseInt(x,10)).filter(Number.isFinite).sort(byYear); }
    function getAnn(annual, y, metric, isEPS=false){
      const yr = (annual||{})[y];
      if (!yr) return null;
      const m = yr[metric];
      if (!m) return null;
      const v = parseNumberLike(m.released ?? m.forecast);
      return v==null? null : v;
    }

    async function fetchData(){
      const r = await fetch('/data', { cache: 'no-store' });
      if (!r.ok) throw new Error('Failed to fetch /data');
      return await r.json();
    }

    function msCompanyUrl(companyCode){
      // e.g. ITC-LIMITED-9743470 => https://in.marketscreener.com/quote/stock/ITC-LIMITED-9743470/
      if (!companyCode) return null;
      return 'https://in.marketscreener.com/quote/stock/' + companyCode + '/';
    }

    function setHeader(data){
      const titleEl = document.getElementById('companyTitle');
      const codeEl  = document.getElementById('companyCodeTag');
      const tsEl    = document.getElementById('tsTag');
      const msLink  = document.getElementById('msLink');

      const code = data.companyCode || 'Company';
      const name = code.split('-').slice(0, -1).join(' ').replace(/-/g, ' ');
      titleEl.textContent = (name || 'Company').toUpperCase();
      codeEl.textContent = 'Code: ' + code;

      const ts = data.timestamp ? new Date(data.timestamp) : new Date();
      tsEl.textContent = 'Generated: ' + ts.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';

      const url = msCompanyUrl(code);
      msLink.innerHTML = url ? ('Source: <a href="'+url+'" target="_blank" rel="noopener">'+url+'</a>') : '';
    }

    function makeKpi(label, value, sub, badgeClass, badgeText){
      const div = document.createElement('div');
      div.className = 'card kpi';
      div.innerHTML = \`
        <div class="label">\${label}</div>
        <div class="value">\${value}\${
          badgeClass ? ' <span class="badge '+badgeClass+'">'+badgeText+'</span>' : ''
        }</div>
        <div class="sub">\${sub || ''}</div>
      \`;
      return div;
    }

    function renderKPIs(data){
      const container = document.getElementById('kpis');
      container.innerHTML = '';

      const annual = data.annualResults || {};
      const years = yearKeys(annual);
      const yNow = years[years.length-1];
      const yPrev = years[years.length-2];

      const salesNow = getAnn(annual, yNow, 'Net salesMillion INR');
      const salesPrev = getAnn(annual, yPrev, 'Net salesMillion INR');

      const niNow = getAnn(annual, yNow, 'Net incomeMillion INR');
      const niPrev = getAnn(annual, yPrev, 'Net incomeMillion INR');

      const epsNow = getAnn(annual, yNow, 'EPS INR', true);
      const epsPrev = getAnn(annual, yPrev, 'EPS INR', true);

      // Sales
      let sBadge = null, sBadgeText = '';
      if (salesNow != null && salesPrev != null) {
        sBadge = (salesNow >= salesPrev) ? 'badge-up' : 'badge-down';
        sBadgeText = (salesNow >= salesPrev) ? '▲ Up' : '▼ Down';
      }
      const sYoY = pctDiff(salesNow, salesPrev);
      container.appendChild(
        makeKpi(
          \`Net Sales (\${yNow || '—'})\`,
          salesNow==null? '—' : INR_FMT.format(salesNow)+' Mn',
          'YoY: ' + (sYoY==null? '—' : sYoY.toFixed(2)+'%'),
          sBadge, sBadgeText
        )
      );

      // Net Income
      let nBadge = null, nBadgeText = '';
      if (niNow != null && niPrev != null) {
        nBadge = (niNow >= niPrev) ? 'badge-up' : 'badge-down';
        nBadgeText = (niNow >= niPrev) ? '▲ Up' : '▼ Down';
      }
      const nYoY = pctDiff(niNow, niPrev);
      container.appendChild(
        makeKpi(
          \`Net Income (\${yNow || '—'})\`,
          niNow==null? '—' : INR_FMT.format(niNow)+' Mn',
          'YoY: ' + (nYoY==null? '—' : nYoY.toFixed(2)+'%'),
          nBadge, nBadgeText
        )
      );

      // EPS
      let eBadge = null, eBadgeText = '';
      if (epsNow != null && epsPrev != null) {
        eBadge = (epsNow >= epsPrev) ? 'badge-up' : 'badge-down';
        eBadgeText = (epsNow >= epsPrev) ? '▲ Up' : '▼ Down';
      }
      const eYoY = pctDiff(epsNow, epsPrev);
      container.appendChild(
        makeKpi(
          \`EPS (\${yNow || '—'})\`,
          epsNow==null? '—' : (''+epsNow),
          'YoY: ' + (eYoY==null? '—' : eYoY.toFixed(2)+'%'),
          eBadge, eBadgeText
        )
      );

      // Events
      const upCount = (data.upcomingEvents && data.upcomingEvents.count) || 0;
      const pastCount = (data.pastEvents && data.pastEvents.count) || 0;
      container.appendChild(
        makeKpi('Upcoming Events', String(upCount), pastCount ? (pastCount + ' past') : '', null, '')
      );
    }

    function renderAnnualTable(data){
      const tbl = document.getElementById('annualTable');
      const annual = data.annualResults || {};
      const years = yearKeys(annual);
      const yNow = years[years.length-1];
      const yPrev = years[years.length-2];
      document.getElementById('annualTitle').textContent = 'Annual Snapshot (' + (yPrev||'—') + ' vs ' + (yNow||'—') + ')';

      const rows = [];
      rows.push(['Metric', yPrev||'', yNow||'']);

      const METRICS = [
        ['Net salesMillion INR', 'Sales (Mn)'],
        ['EBITDAMillion INR', 'EBITDA (Mn)'],
        ['EBITMillion INR', 'EBIT (Mn)'],
        ['Earnings before Tax (EBT)Million INR', 'EBT (Mn)'],
        ['Net incomeMillion INR', 'Net Income (Mn)'],
        ['EPS INR', 'EPS', true]
      ];

      METRICS.forEach(([key, label, isEPS]) => {
        const vPrev = getAnn(annual, yPrev, key, !!isEPS);
        const vNow  = getAnn(annual, yNow, key, !!isEPS);
        rows.push([
          label,
          vPrev==null? '—' : (isEPS ? vPrev : INR_FMT.format(vPrev)),
          vNow==null? '—'  : (isEPS ? vNow  : INR_FMT.format(vNow))
        ]);
      });

      // Build HTML
      tbl.innerHTML = '';
      const thead = document.createElement('thead');
      const trh = document.createElement('tr');
      rows[0].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      tbl.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (let i=1;i<rows.length;i++){
        const tr = document.createElement('tr');
        rows[i].forEach((cell,idx)=>{
          const td = document.createElement('td');
          td.textContent = cell;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
    }

    function renderQuarterlyTable(data){
      const qr = data.quarterlyResults || {};
      const periods = Object.keys(qr)
        .filter(k => /\\d{4}\\s(Q\\d|S1)/.test(k))
        .sort((a,b)=>{
          const [ay, ap] = a.split(' ');
          const [by, bp] = b.split(' ');
          const yi = parseInt(ay,10) - parseInt(by,10);
          if (yi !== 0) return yi;
          const order = p => (p === 'S1' ? 1.5 : parseInt(p.replace('Q',''),10));
          return order(ap) - order(bp);
        })
        .slice(-4); // last 4
      const tbl = document.getElementById('quarterlyTable');

      const rows = [];
      rows.push(['Metric', ...periods]);

      function cell(period, metric, isEPS=false){
        const m = (qr[period]||{})[metric];
        if (!m) return '—';
        const val = parseNumberLike(m.released ?? m.forecast);
        if (val == null) return '—';
        return isEPS ? ''+val : INR_FMT.format(val);
      }

      const METRICS = [
        ['Net salesMillion INR', 'Sales (Mn)'],
        ['EBITDAMillion INR', 'EBITDA (Mn)'],
        ['EBITMillion INR', 'EBIT (Mn)'],
        ['Net incomeMillion INR', 'Net Income (Mn)'],
        ['EPS INR', 'EPS', true]
      ];

      METRICS.forEach(([key, label, isEPS])=>{
        rows.push([label, ...periods.map(p => cell(p, key, !!isEPS))]);
      });

      // Build HTML
      tbl.innerHTML = '';
      const thead = document.createElement('thead');
      const trh = document.createElement('tr');
      rows[0].forEach(h => { const th=document.createElement('th'); th.textContent=h; trh.appendChild(th); });
      thead.appendChild(trh); tbl.appendChild(thead);
      const tbody=document.createElement('tbody');
      for (let i=1;i<rows.length;i++){
        const tr=document.createElement('tr');
        rows[i].forEach((c,idx)=>{ const td=document.createElement('td'); td.textContent=c; tr.appendChild(td); });
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
    }

    function renderLists(data){
      const up = (data.upcomingEvents && data.upcomingEvents.events) || [];
      const upBox = document.getElementById('upcomingList');
      upBox.innerHTML = '';
      (up.slice(0,8)).forEach(e=>{
        const el = document.createElement('div');
        el.className = 'li';
        el.innerHTML = '<div class="t">'+(e.title||'')+'</div><div class="d">'+(e.dateTimeRaw||e.dateTimeISO||'')+'</div>';
        upBox.appendChild(el);
      });

      const divs = (data.pastDividends && data.pastDividends.dividends) || [];
      const dvBox = document.getElementById('divList');
      dvBox.innerHTML = '';
      (divs.slice(0,10)).forEach(d=>{
        const el = document.createElement('div');
        el.className = 'li';
        const amt = (d.amount!=null? d.amount+' ' : '') + (d.currency||'');
        el.innerHTML = '<div class="t">['+(d.type||'')+'] '+(d.title||'')+'</div><div class="d">'+(d.dateRaw||'')+'  •  '+amt+'</div>';
        dvBox.appendChild(el);
      });
    }

    function renderCharts(data){
      const annual = data.annualResults || {};
      const years = yearKeys(annual).slice(-5); // last 5
      const labels = years.map(String);
      const sales = years.map(y => getAnn(annual, y, 'Net salesMillion INR'));
      const eps = years.map(y => getAnn(annual, y, 'EPS INR', true));

      const salesCtx = document.getElementById('salesChart');
      const epsCtx = document.getElementById('epsChart');

      // Chart.js defaults (no explicit colors; Chart.js will pick)
      new Chart(salesCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{ label: 'Sales (Mn)', data: sales }]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#cfe3ff' } } },
          scales: {
            x: { ticks: { color: '#a7b3bf' }, grid: { color: '#162231' } },
            y: { ticks: { color: '#a7b3bf' }, grid: { color: '#162231' } }
          }
        }
      });

      new Chart(epsCtx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'EPS', data: eps }] },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#cfe3ff' } } },
          scales: {
            x: { ticks: { color: '#a7b3bf' }, grid: { color: '#162231' } },
            y: { ticks: { color: '#a7b3bf' }, grid: { color: '#162231' } }
          }
        }
      });
    }

    async function init(){
      try {
        const data = await fetchData();
        setHeader(data);
        renderKPIs(data);
        renderAnnualTable(data);
        renderQuarterlyTable(data);
        renderLists(data);
        renderCharts(data);
      } catch (e){
        document.body.innerHTML = '<pre style="padding:24px;color:#ffb3c0;">'+e.message+'</pre>';
      }
    }

    document.getElementById('reloadBtn').addEventListener('click', init);
    init();
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`🚀 Company Data View Panel running at http://localhost:${PORT}`);
});
