const missionStart = Date.now();
const statusRegistry = new Map();
const RETRY_BASE_MS = 3000;
const MAX_RETRY_MS = 30000;
const NASA_API_KEY = 'DEMO_KEY';

const POLL_INTERVALS = {
  flights: 7000,
  ships: 20000,
  space: 125000,
  quakes: 10000,
  weather: 14000,
  github: 6000,
  market: 5000,
};

const state = {
  flights: [],
  ships: [],
  satellites: [],
  iss: null,
  binance: null,
  wsRetry: 0,
  wikiRetry: 0,
};

const feedEls = {
  flights: document.getElementById('flightsFeed'),
  ships: document.getElementById('shipsFeed'),
  space: document.getElementById('spaceFeed'),
  weather: document.getElementById('weatherFeed'),
  quakes: document.getElementById('quakeFeed'),
  market: document.getElementById('marketFeed'),
  github: document.getElementById('githubFeed'),
  wiki: document.getElementById('wikiFeed'),
};

const metaEls = {
  flights: document.getElementById('flightsMeta'),
  ships: document.getElementById('shipsMeta'),
  space: document.getElementById('spaceMeta'),
  weather: document.getElementById('weatherMeta'),
  quakes: document.getElementById('quakeMeta'),
  market: document.getElementById('marketMeta'),
};

function setStatus(key, status, detail = '') {
  statusRegistry.set(key, { status, detail, at: new Date() });
  const target = document.getElementById('statusList');
  target.innerHTML = '';
  for (const [name, entry] of statusRegistry.entries()) {
    const item = document.createElement('li');
    const statusClass = entry.status === 'CONNECTED' ? 'status-good' : entry.status === 'SIGNAL LOST' ? 'status-lost' : 'status-pending';
    const badge = document.createElement('span');
    badge.className = statusClass;
    badge.textContent = entry.status;
    item.appendChild(badge);
    item.appendChild(document.createTextNode(` // ${name}${entry.detail ? ` // ${entry.detail}` : ''}`));
    target.appendChild(item);
  }
}

function setMeta(name, text) {
  if (metaEls[name]) {
    metaEls[name].textContent = text;
  }
}

function renderList(el, rows, kind = 'good') {
  if (!el) return;
  el.innerHTML = '';
  rows.forEach((row) => {
    const li = document.createElement('li');
    li.className = kind;
    li.textContent = row;
    el.appendChild(li);
  });
}

function renderError(el, msg) {
  if (!el) return;
  el.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'alert';
  li.textContent = msg;
  el.appendChild(li);
}

function project(lon, lat, width, height) {
  return {
    x: ((lon + 180) / 360) * width,
    y: ((90 - lat) / 180) * height,
  };
}

function getNeoMissDistanceKm(neo) {
  const rawDistance = neo?.close_approach_data?.[0]?.miss_distance?.kilometers;
  const distance = Number(rawDistance);
  return Number.isFinite(distance) ? distance : null;
}

function drawMap() {
  const canvas = document.getElementById('tacticalMap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;

  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(0, 229, 255, 0.2)';
  for (let i = 0; i <= 12; i++) {
    const x = (width / 12) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let i = 0; i <= 6; i++) {
    const y = (height / 6) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.35;
  const sweep = (Date.now() / 30) % 360;
  const sweepRad = (sweep * Math.PI) / 180;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.arc(centerX, centerY, radius, sweepRad, sweepRad + 0.24);
  ctx.closePath();
  const grd = ctx.createRadialGradient(centerX, centerY, 20, centerX, centerY, radius);
  grd.addColorStop(0, 'rgba(127, 255, 0, 0.38)');
  grd.addColorStop(1, 'rgba(127, 255, 0, 0)');
  ctx.fillStyle = grd;
  ctx.fill();

  const drawPoints = (entries, color, size = 2.2) => {
    ctx.fillStyle = color;
    entries.forEach(({ lon, lat }) => {
      const p = project(lon, lat, width, height);
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  drawPoints(state.flights, '#00e5ff', 1.6);
  drawPoints(state.ships, '#ffc857', 2.2);
  drawPoints(state.satellites, '#7fff00', 2.5);

  if (state.iss) {
    drawPoints([state.iss], '#ff4d6d', 3.4);
  }

  requestAnimationFrame(drawMap);
}

async function safeFetch(key, url, parser) {
  try {
    setStatus(key, 'CONNECTING');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = parser ? await parser(response) : await response.json();
    setStatus(key, 'CONNECTED');
    return data;
  } catch (error) {
    setStatus(key, 'SIGNAL LOST', error.message);
    throw error;
  }
}

async function pollFlights() {
  try {
    const data = await safeFetch('OpenSky', 'https://opensky-network.org/api/states/all');
    const rows = (data.states || []).slice(0, 24).map((f) => ({
      call: f[1] || 'UNK',
      lon: Number(f[5]),
      lat: Number(f[6]),
      alt: Number(f[7]),
      vel: Number(f[9]),
    })).filter((f) => Number.isFinite(f.lon) && Number.isFinite(f.lat));
    state.flights = rows.map(({ lon, lat }) => ({ lon, lat }));
    setMeta('flights', `${rows.length} tracks // refreshed ${new Date().toLocaleTimeString()}`);
    renderList(feedEls.flights, rows.slice(0, 10).map((f) => `${f.call.trim()} | ALT ${Math.round(f.alt || 0)}m | SPD ${Math.round(f.vel || 0)}m/s`));
  } catch {
    renderError(feedEls.flights, 'SIGNAL LOST // OpenSky feed unavailable');
  }
}

async function pollShips() {
  try {
    const data = await safeFetch('SpaceXShips', 'https://api.spacexdata.com/v4/ships');
    const rows = (data || []).filter((s) => Number.isFinite(s.longitude) && Number.isFinite(s.latitude)).slice(0, 24).map((s) => ({
      name: s.name,
      lon: Number(s.longitude),
      lat: Number(s.latitude),
      status: s.active ? 'ACTIVE' : 'STANDBY',
    }));
    state.ships = rows.map(({ lon, lat }) => ({ lon, lat }));
    setMeta('ships', `${rows.length} vessels tracked`);
    renderList(feedEls.ships, rows.slice(0, 10).map((s) => `${s.name} | ${s.status} | ${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`));
  } catch {
    renderError(feedEls.ships, 'SIGNAL LOST // Maritime feed unavailable');
  }
}

async function pollSpace() {
  try {
    const [iss, sats, neo] = await Promise.all([
      safeFetch('ISS', 'https://api.wheretheiss.at/v1/satellites/25544'),
      safeFetch('CelesTrak', 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json'),
      safeFetch('NASA-NEO', `https://api.nasa.gov/neo/rest/v1/feed/today?detailed=false&api_key=${encodeURIComponent(NASA_API_KEY)}`),
    ]);

    state.iss = { lon: Number(iss.longitude), lat: Number(iss.latitude) };

    const satList = (sats || [])
      .slice(0, 70)
      .filter((s) => Number.isFinite(Number(s.LONGITUDE)) && Number.isFinite(Number(s.LATITUDE)))
      .map((s) => ({
        satname: s.OBJECT_NAME,
        lon: Number(s.LONGITUDE),
        lat: Number(s.LATITUDE),
      }));

    state.satellites = satList.slice(0, 36).map(({ lon, lat }) => ({ lon, lat }));

    const neoBodies = Object.values(neo.near_earth_objects || {}).flat();
    setMeta('space', `ISS + ${state.satellites.length} sats + ${neoBodies.length} NEO objects`);

    renderList(feedEls.space, [
      `ISS | lat ${state.iss.lat.toFixed(2)} | lon ${state.iss.lon.toFixed(2)}`,
      ...(satList.slice(0, 4).map((s) => `SAT ${s.satname || 'UNK'} | ${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`)),
      ...(neoBodies.slice(0, 3).map((n) => {
        const distanceKm = getNeoMissDistanceKm(n);
        return `NEO ${n.name} | Miss dist ${distanceKm === null ? 'N/A' : `${Math.round(distanceKm).toLocaleString()}km`}`;
      })),
    ]);
  } catch {
    renderError(feedEls.space, 'SIGNAL LOST // Space feeds degraded');
  }
}

async function pollQuakes() {
  try {
    const data = await safeFetch(
      'USGS',
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson'
    );
    const rows = (data.features || []).slice(0, 12).map((q) => ({
      mag: q.properties.mag,
      place: q.properties.place,
      time: new Date(q.properties.time).toLocaleTimeString(),
    }));
    setMeta('quakes', `${rows.length} seismic events / hour`);
    renderList(feedEls.quakes, rows.map((q) => `M${q.mag || 0} | ${q.place} | ${q.time}`), 'alert');
  } catch {
    renderError(feedEls.quakes, 'SIGNAL LOST // Seismic feed unavailable');
  }
}

async function pollWeather() {
  try {
    const data = await safeFetch(
      'OpenMeteo',
      'https://api.open-meteo.com/v1/forecast?latitude=28.5729&longitude=-80.649&current=temperature_2m,wind_speed_10m,weather_code&timezone=UTC'
    );
    const c = data.current || {};
    setMeta('weather', 'Cape Canaveral tactical weather station');
    renderList(feedEls.weather, [
      `TEMP ${c.temperature_2m ?? '??'}°C`,
      `WIND ${c.wind_speed_10m ?? '??'} km/h`,
      `WX CODE ${c.weather_code ?? '??'}`,
    ]);
  } catch {
    renderError(feedEls.weather, 'SIGNAL LOST // Weather uplink down');
  }
}

async function pollGitHub() {
  try {
    const events = await safeFetch('GitHubEvents', 'https://api.github.com/events');
    renderList(feedEls.github, (events || []).slice(0, 16).map((e) => `${e.type} | ${e.repo?.name || 'unknown'} | ${e.actor?.login || 'anon'}`));
  } catch {
    renderError(feedEls.github, 'SIGNAL LOST // GitHub event stream unavailable');
  }
}

async function pollCoinGecko() {
  try {
    const data = await safeFetch(
      'CoinGecko',
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true'
    );
    renderList(feedEls.market, [
      `BTC $${Math.round(data.bitcoin?.usd || 0).toLocaleString()} | 24h ${Number(data.bitcoin?.usd_24h_change || 0).toFixed(2)}%`,
      `ETH $${Math.round(data.ethereum?.usd || 0).toLocaleString()} | 24h ${Number(data.ethereum?.usd_24h_change || 0).toFixed(2)}%`,
      `SOL $${Number(data.solana?.usd || 0).toFixed(2)} | 24h ${Number(data.solana?.usd_24h_change || 0).toFixed(2)}%`,
      state.binance ? `BINANCE BTCUSDT ${state.binance.price} | VOL ${state.binance.volume}` : 'BINANCE WS pending...',
    ]);
    setMeta('market', 'high frequency crypto telemetry');
  } catch {
    renderError(feedEls.market, 'SIGNAL LOST // Market APIs unavailable');
  }
}

function initBinanceSocket() {
  setStatus('BinanceWS', 'CONNECTING');
  const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker');

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      state.binance = {
        price: Number(msg.c).toFixed(2),
        volume: Number(msg.v).toFixed(2),
      };
      state.wsRetry = 0;
      setStatus('BinanceWS', 'CONNECTED');
    } catch {
      setStatus('BinanceWS', 'SIGNAL LOST', 'parse error');
    }
  };

  ws.onerror = () => setStatus('BinanceWS', 'SIGNAL LOST', 'socket error');
  ws.onclose = () => {
    const retryDelay = Math.min(RETRY_BASE_MS * 2 ** state.wsRetry, MAX_RETRY_MS);
    state.wsRetry += 1;
    setStatus('BinanceWS', 'SIGNAL LOST', 'reconnecting');
    setTimeout(initBinanceSocket, retryDelay);
  };
}

function initWikiStream() {
  setStatus('WikipediaStream', 'CONNECTING');
  const source = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange');

  const queue = [];
  source.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (!msg.title || msg.type !== 'edit') return;
      queue.push(`${msg.wiki || 'wiki'} | ${msg.title} | ${msg.user || 'anon'}`);
      if (queue.length > 24) queue.shift();
      renderList(feedEls.wiki, queue.slice(-14).reverse());
      state.wikiRetry = 0;
      setStatus('WikipediaStream', 'CONNECTED');
    } catch {
      setStatus('WikipediaStream', 'SIGNAL LOST', 'stream parse error');
    }
  };

  source.onerror = () => {
    const retryDelay = Math.min(RETRY_BASE_MS * 2 ** state.wikiRetry, MAX_RETRY_MS);
    state.wikiRetry += 1;
    setStatus('WikipediaStream', 'SIGNAL LOST', 'stream error');
    source.close();
    setTimeout(initWikiStream, retryDelay);
  };
}

function runClocks() {
  const utcEl = document.getElementById('utcClock');
  const localEl = document.getElementById('localClock');
  const missionEl = document.getElementById('missionClock');

  const tick = () => {
    const now = new Date();
    utcEl.textContent = now.toUTCString().split(' ')[4];
    localEl.textContent = now.toLocaleTimeString();
    const elapsed = Math.floor((Date.now() - missionStart) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    missionEl.textContent = `T+${h}:${m}:${s}`;
  };

  tick();
  setInterval(tick, 1000);
}

function boot() {
  runClocks();
  drawMap();
  initBinanceSocket();
  initWikiStream();

  pollFlights();
  pollShips();
  pollSpace();
  pollQuakes();
  pollWeather();
  pollGitHub();
  pollCoinGecko();

  setInterval(pollFlights, POLL_INTERVALS.flights);
  setInterval(pollShips, POLL_INTERVALS.ships);
  setInterval(pollSpace, POLL_INTERVALS.space);
  setInterval(pollQuakes, POLL_INTERVALS.quakes);
  setInterval(pollWeather, POLL_INTERVALS.weather);
  setInterval(pollGitHub, POLL_INTERVALS.github);
  setInterval(pollCoinGecko, POLL_INTERVALS.market);
}

boot();
