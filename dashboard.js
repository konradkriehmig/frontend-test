/* ── constants ── */
const BOOT_TIME = Date.now();
const MAX_STREAM = 60;
const RETRY_BASE = 3000;
const RETRY_MAX = 30000;

const PAIRS = [
  'btcusdt','ethusdt','solusdt','bnbusdt','xrpusdt','adausdt',
  'dogeusdt','avaxusdt','maticusdt','linkusdt','dotusdt','ltcusdt',
  'uniusdt','atomusdt','nearusdt','shibusdt',
];

/* ── state ── */
const crypto = {};
PAIRS.forEach((p) => {
  crypto[p] = { price: null, change: null, vol: null, history: [], canvas: null };
});

const rates = {
  txWindow: [],
  wikiWindow: [],
};

const mempool = {
  size: '—', bytes: '—', minFee: '—',
  fastestFee: '—', hourFee: '—', ecoFee: '—',
};

let issHistory = [];
let binanceRetry = 0;
let blockchainRetry = 0;
let mempoolRetry = 0;
let wikiRetry = 0;

/* ── helpers ── */
function el(id) { return document.getElementById(id); }

function setText(id, val) {
  const e = el(id);
  if (e) e.textContent = val;
}

function fmtBTC(sats) { return (sats / 1e8).toFixed(4); }

function fmtHash(h) { return h ? `${h.slice(0, 8)}…${h.slice(-6)}` : '—'; }

function fmtK(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(Math.round(n));
}

function fmtPrice(p) {
  if (p === null || p === undefined) return '—';
  if (p < 0.001) return p.toFixed(8);
  if (p < 1) return p.toFixed(5);
  if (p < 100) return p.toFixed(3);
  return Math.round(p).toLocaleString('en-US');
}

function retryDelay(count) {
  return Math.min(RETRY_BASE * 2 ** count, RETRY_MAX);
}

/* flash an element's background briefly */
function flashEl(e) {
  if (!e) return;
  e.style.transition = 'none';
  e.style.background = 'rgba(255,255,255,0.055)';
  clearTimeout(e._ft);
  e._ft = setTimeout(() => {
    e.style.transition = 'background 0.25s ease-out';
    e.style.background = '';
  }, 60);
}

/* prepend a <li> to a stream, trimming overflow */
function prependLi(listEl, html) {
  if (!listEl) return;
  const li = document.createElement('li');
  li.className = 'flash-in';
  li.innerHTML = html;
  listEl.prepend(li);
  while (listEl.children.length > MAX_STREAM) listEl.lastChild.remove();
}

/* append a <li> to a stream */
function appendLi(listEl, html) {
  if (!listEl) return;
  const li = document.createElement('li');
  li.innerHTML = html;
  listEl.appendChild(li);
}

/* ── sparkline ── */
function drawSparkline(canvas, history) {
  if (!canvas || history.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const trend = history[history.length - 1] >= history[0];
  ctx.beginPath();
  ctx.strokeStyle = trend ? 'rgba(255,255,255,0.55)' : 'rgba(130,130,130,0.35)';
  ctx.lineWidth = 1;
  history.forEach((v, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 1) - 0.5;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/* ── build crypto cells ── */
function buildCryptoGrid() {
  const grid = el('cryptoGrid');
  if (!grid) return;
  PAIRS.forEach((pair) => {
    const sym = pair.replace('usdt', '').toUpperCase();
    const cell = document.createElement('div');
    cell.className = 'cc';
    cell.id = `cc-${pair}`;
    cell.innerHTML = `
      <div class="cc-sym">${sym}</div>
      <div class="cc-px" id="cp-${pair}">—</div>
      <div class="cc-meta">
        <span id="cg-${pair}" class="cc-up">—</span>
        <span id="cv-${pair}" class="dx"></span>
      </div>
      <canvas id="ck-${pair}" width="120" height="20"></canvas>
    `;
    grid.appendChild(cell);
    crypto[pair].canvas = el(`ck-${pair}`);
  });
}

/* ── update one crypto cell ── */
function updateCryptoCell(pair, data) {
  const s = crypto[pair];
  if (!s) return;

  const price = parseFloat(data.c);
  const change = parseFloat(data.P);
  const vol = parseFloat(data.q);

  s.price = price;
  s.change = change;
  s.vol = vol;
  s.history.push(price);
  if (s.history.length > 80) s.history.shift();

  const priceEl = el(`cp-${pair}`);
  const chgEl = el(`cg-${pair}`);
  const volEl = el(`cv-${pair}`);
  const cell = el(`cc-${pair}`);

  if (priceEl) priceEl.textContent = fmtPrice(price);
  if (chgEl) {
    chgEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    chgEl.className = change >= 0 ? 'cc-up' : 'cc-dn';
  }
  if (volEl) volEl.textContent = fmtK(vol);

  flashEl(cell);
  drawSparkline(s.canvas, s.history);
  updateTickerItem(pair, price, change);
}

/* ── ticker strip ── */
function updateTickerItem(pair, price, change) {
  const sym = pair.replace('usdt', '').toUpperCase();
  let item = el(`ti-${pair}`);
  if (!item) {
    item = document.createElement('span');
    item.id = `ti-${pair}`;
    item.className = 'tick-item';
    item.innerHTML = `<span class="tick-sym">${sym}</span><span class="tick-px" id="tp-${pair}"></span><span class="tick-chg" id="tc-${pair}"></span>`;
    const ticker = el('ticker');
    if (ticker) ticker.appendChild(item);
  }
  const pxEl = el(`tp-${pair}`);
  const chEl = el(`tc-${pair}`);
  if (pxEl) pxEl.textContent = fmtPrice(price);
  if (chEl) {
    chEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    chEl.style.color = change >= 0 ? '#888' : '#444';
  }
  item.className = `tick-item ${change >= 0 ? 'up' : 'down'}`;
}

/* ── Binance combined WebSocket ── */
function initBinanceWS() {
  const streams = PAIRS.map((p) => `${p}@ticker`).join('/');
  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

  ws.onopen = () => { binanceRetry = 0; };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      const d = msg.data;
      if (!d || !d.s) return;
      const pair = d.s.toLowerCase();
      if (crypto[pair]) {
        updateCryptoCell(pair, d);
        setText('cryptoTs', new Date().toLocaleTimeString('en-GB', { hour12: false }));
      }
    } catch {}
  };

  ws.onerror = () => {};
  ws.onclose = () => setTimeout(initBinanceWS, retryDelay(binanceRetry++));
}

/* ── Blockchain.com unconfirmed tx WebSocket ── */
function initBlockchainWS() {
  const ws = new WebSocket('wss://ws.blockchain.info/inv');

  ws.onopen = () => {
    ws.send(JSON.stringify({ op: 'unconfirmed_sub' }));
    blockchainRetry = 0;
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.op !== 'utx') return;
      const tx = msg.x;
      const totalSats = (tx.out || []).reduce((s, o) => s + (o.value || 0), 0);
      const btc = fmtBTC(totalSats);
      const btcPrice = crypto.btcusdt?.price;
      const usd = btcPrice ? `$${Math.round(totalSats / 1e8 * btcPrice).toLocaleString('en-US')}` : '';
      const ins = tx.inputs?.length || 0;
      const outs = (tx.out || []).length;
      const hash = fmtHash(tx.hash);

      rates.txWindow.push(Date.now());

      prependLi(
        el('txFeed'),
        `<span class="hl">${hash}</span> <span class="dx">${btc} BTC</span> <span class="dx">${usd}</span> <span class="dx">${ins}→${outs}</span>`
      );
    } catch {}
  };

  ws.onerror = () => {};
  ws.onclose = () => setTimeout(initBlockchainWS, retryDelay(blockchainRetry++));
}

/* ── Mempool.space WebSocket ── */
function renderMempoolKV() {
  const e = el('mempoolKV');
  if (!e) return;
  e.innerHTML = `
    <span class="k">pending tx</span><span class="v">${mempool.size}</span>
    <span class="k">size MB</span><span class="v">${mempool.bytes}</span>
    <span class="k">fastest</span><span class="v">${mempool.fastestFee} sat/vB</span>
    <span class="k">1h fee</span><span class="v">${mempool.hourFee} sat/vB</span>
    <span class="k">eco</span><span class="v">${mempool.ecoFee} sat/vB</span>
  `;
  setText('mempoolSize', mempool.size);
}

function initMempoolWS() {
  const ws = new WebSocket('wss://mempool.space/api/v1/ws');

  ws.onopen = () => {
    ws.send(JSON.stringify({ action: 'want', data: ['blocks', 'stats', 'mempool-blocks'] }));
    mempoolRetry = 0;
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);

      if (msg.mempoolInfo) {
        const info = msg.mempoolInfo;
        mempool.size = (info.size || 0).toLocaleString('en-US');
        mempool.bytes = ((info.bytes || 0) / 1e6).toFixed(1);
        mempool.minFee = info.mempoolminfee ? (info.mempoolminfee * 1e8).toFixed(0) : '—';
        renderMempoolKV();
      }

      if (msg.fees) {
        mempool.fastestFee = msg.fees.fastestFee ?? '—';
        mempool.hourFee = msg.fees.hourFee ?? '—';
        mempool.ecoFee = msg.fees.economyFee ?? '—';
        renderMempoolKV();
      }

      if (msg['mempool-blocks']) {
        const feed = el('blockFeed');
        if (!feed) return;
        feed.innerHTML = '';
        msg['mempool-blocks'].slice(0, 6).forEach((b, i) => {
          const nTx = b.nTx ?? '?';
          const feeRange = b.feeRange
            ? `${Math.round(b.feeRange[0])}–${Math.round(b.feeRange[b.feeRange.length - 1])} sat/vB`
            : '';
          const size = b.blockSize ? `${(b.blockSize / 1e6).toFixed(2)}MB` : '';
          appendLi(feed, `<span class="dx">+${i}</span> <span class="hl">${nTx} tx</span> <span class="dx">${size} ${feeRange}</span>`);
        });
      }

      if (msg.block) {
        const b = msg.block;
        prependLi(
          el('blockFeed'),
          `<span class="hl">BLOCK ${b.height ?? '?'}</span> <span class="dx">${b.tx_count ?? '?'} tx · ${((b.size || 0) / 1e6).toFixed(2)} MB</span>`
        );
      }
    } catch {}
  };

  ws.onerror = () => {};
  ws.onclose = () => setTimeout(initMempoolWS, retryDelay(mempoolRetry++));
}

/* ── ISS position (2s poll) ── */
function drawISSMap() {
  const canvas = el('issCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  /* grid lines */
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 6; i++) {
    const x = (W / 6) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let i = 0; i <= 3; i++) {
    const y = (H / 3) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  if (issHistory.length < 2) return;

  /* trail */
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  issHistory.forEach((p, i) => {
    const x = ((p.lon + 180) / 360) * W;
    const y = ((90 - p.lat) / 180) * H;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  /* current dot */
  const last = issHistory[issHistory.length - 1];
  const lx = ((last.lon + 180) / 360) * W;
  const ly = ((90 - last.lat) / 180) * H;
  ctx.beginPath();
  ctx.arc(lx, ly, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

function pollISS() {
  fetch('https://api.wheretheiss.at/v1/satellites/25544')
    .then((r) => r.json())
    .then((d) => {
      const lat = parseFloat(d.latitude);
      const lon = parseFloat(d.longitude);
      const alt = parseFloat(d.altitude);
      const vel = parseFloat(d.velocity);

      issHistory.push({ lat, lon });
      if (issHistory.length > 80) issHistory.shift();

      const kv = el('issKV');
      if (kv) {
        kv.innerHTML = `
          <span class="k">lat</span><span class="v">${lat.toFixed(4)}</span>
          <span class="k">lon</span><span class="v">${lon.toFixed(4)}</span>
          <span class="k">alt km</span><span class="v">${Math.round(alt)}</span>
          <span class="k">km/s</span><span class="v">${(vel / 3600).toFixed(2)}</span>
        `;
      }

      const latDir = lat >= 0 ? 'N' : 'S';
      const lonDir = lon >= 0 ? 'E' : 'W';
      setText('issCoords', `${Math.abs(lat).toFixed(1)}°${latDir} ${Math.abs(lon).toFixed(1)}°${lonDir}`);

      drawISSMap();
    })
    .catch(() => {});
}

/* ── USGS seismic (15s poll) ── */
function pollQuakes() {
  fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson')
    .then((r) => r.json())
    .then((d) => {
      const feats = d.features || [];
      setText('quakeMeta', `${feats.length}/hr`);
      setText('quakeStat', feats.length);

      const feed = el('quakeFeed');
      if (!feed) return;
      feed.innerHTML = '';
      feats.slice(0, 25).forEach((q) => {
        const mag = q.properties.mag ?? '?';
        const place = q.properties.place || '?';
        const t = new Date(q.properties.time).toLocaleTimeString('en-GB', { hour12: false });
        appendLi(feed, `<span class="hl">M${mag}</span> <span class="dx">${place}</span> <span class="dx">${t}</span>`);
      });
    })
    .catch(() => {});
}

/* ── OpenSky aviation (12s poll) ── */
function pollFlights() {
  fetch('https://opensky-network.org/api/states/all')
    .then((r) => r.json())
    .then((d) => {
      const states = d.states || [];
      const valid = states.filter((f) => f[5] != null && f[6] != null);
      setText('flightMeta', `${states.length.toLocaleString('en-US')} tracked`);
      setText('flightStat', states.length.toLocaleString('en-US'));

      const feed = el('flightFeed');
      if (!feed) return;
      feed.innerHTML = '';
      valid.slice(0, 30).forEach((f) => {
        const cs = (f[1] || 'UNK').trim();
        const lat = parseFloat(f[6]).toFixed(2);
        const lon = parseFloat(f[5]).toFixed(2);
        const alt = Math.round(f[7] || 0);
        const vel = Math.round(f[9] || 0);
        const co = f[2] || '?';
        appendLi(feed, `<span class="hl">${cs}</span> <span class="dx">${co}</span> <span class="dx">${lat},${lon}</span> <span class="dx">${alt}m ${vel}m/s</span>`);
      });
    })
    .catch(() => {});
}

/* ── GitHub Events (8s poll) ── */
function pollGitHub() {
  fetch('https://api.github.com/events?per_page=30')
    .then((r) => r.json())
    .then((events) => {
      setText('githubMeta', `${(events || []).length} recent`);
      const feed = el('githubFeed');
      if (!feed) return;
      feed.innerHTML = '';
      (events || []).slice(0, 22).forEach((e) => {
        const type = (e.type || '?').replace('Event', '');
        const repo = e.repo?.name || '?';
        const actor = e.actor?.login || 'anon';
        appendLi(feed, `<span class="dx">${type}</span> <span class="hl">${repo}</span> <span class="dx">${actor}</span>`);
      });
    })
    .catch(() => {});
}

/* ── Wikipedia SSE ── */
function initWikiStream() {
  const source = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange');

  source.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (!msg.title || msg.type !== 'edit') return;

      rates.wikiWindow.push(Date.now());

      const lang = (msg.wiki || '?').replace('wiki', '').slice(0, 6);
      prependLi(
        el('wikiFeed'),
        `<span class="dx">${lang}</span> <span class="hl">${msg.title}</span> <span class="dx">${msg.user || 'anon'}</span>`
      );

      wikiRetry = 0;
    } catch {}
  };

  source.onerror = () => {
    source.close();
    setTimeout(initWikiStream, retryDelay(wikiRetry++));
  };
}

/* ── clocks & uptime ── */
function runClocks() {
  const tick = () => {
    const now = Date.now();
    const cutoff = now - 60000;

    /* trim rate windows from the front (oldest timestamps first) */
    while (rates.txWindow.length > 0 && rates.txWindow[0] < cutoff) rates.txWindow.shift();
    while (rates.wikiWindow.length > 0 && rates.wikiWindow[0] < cutoff) rates.wikiWindow.shift();

    setText('txRate', rates.txWindow.length);
    setText('txMeta', `${rates.txWindow.length}/min`);
    setText('wikiRate', rates.wikiWindow.length);
    setText('wikiMeta', `${rates.wikiWindow.length}/min`);
    setText('mempoolSize', mempool.size);

    const d = new Date(now);
    setText('utcClock', d.toUTCString().split(' ')[4]);

    const elapsed = Math.floor((now - BOOT_TIME) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    setText('uptimeEl', h > 0 ? `up ${h}h ${m}m` : m > 0 ? `up ${m}m ${s}s` : `up ${s}s`);
  };
  tick();
  setInterval(tick, 1000);
}

/* ── boot ── */
function boot() {
  buildCryptoGrid();
  runClocks();

  /* WebSocket streams */
  initBinanceWS();
  initBlockchainWS();
  initMempoolWS();
  initWikiStream();

  /* initial polls */
  pollISS();
  pollQuakes();
  pollFlights();
  pollGitHub();

  /* recurring polls */
  setInterval(pollISS, 2000);
  setInterval(pollQuakes, 15000);
  setInterval(pollFlights, 12000);
  setInterval(pollGitHub, 8000);
}

boot();
