// Turns raw Overpass downloads (raw/) into compact data files for the page (site/data/).
// Usage: node build/build.js
const fs = require('fs');
const path = require('path');
const S = require('./score.js');

const RAW = path.join(__dirname, '..', 'raw');
const OUT = path.join(__dirname, '..', 'site', 'data');
fs.mkdirSync(OUT, { recursive: true });
const readJSON = f => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
const xy = (lat, lon) => S.toXY(lat, lon).map(v => Math.round(v));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---------- geometry helpers ----------
function simplify(pts, tol) { // pts: [[x,y],...] Douglas-Peucker; closed rings are split at the far point
  if (pts.length < 3) return pts;
  if (pts.length > 3 && same(pts[0], pts[pts.length - 1])) {
    let k = 1, md = -1;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > md) { md = d; k = i; } }
    const a = simplifyOpen(pts.slice(0, k + 1), tol), b = simplifyOpen(pts.slice(k), tol);
    return a.concat(b.slice(1));
  }
  return simplifyOpen(pts, tol);
}
function simplifyOpen(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function enc(pts) { // delta-encoded flat ints
  const out = []; let px = 0, py = 0;
  for (const [x, y] of pts) { const X = Math.round(x), Y = Math.round(y); out.push(X - px, Y - py); px = X; py = Y; }
  return out;
}
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
function assemble(ways) { // join open ways into rings
  const rings = []; const pool = ways.map(w => w.slice());
  while (pool.length) {
    let cur = pool.shift(); let guard = 0;
    while (!same(cur[0], cur[cur.length - 1]) && guard++ < 5000) {
      const end = cur[cur.length - 1];
      const idx = pool.findIndex(w => same(w[0], end) || same(w[w.length - 1], end));
      if (idx < 0) break;
      let w = pool.splice(idx, 1)[0];
      if (!same(w[0], end)) w = w.reverse();
      cur = cur.concat(w.slice(1));
    }
    rings.push(cur);
  }
  return rings;
}
const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };
function inRing(x, y, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const inPoly = (x, y, poly) => poly.outer.some(r => inRing(x, y, r)) && !poly.inner.some(r => inRing(x, y, r));
const geomPts = g => g.map(p => xy(p.lat, p.lon));
function polysOf(el) { // -> {outer:[ring], inner:[ring]} in metres
  if (el.type === 'way') return el.geometry ? { outer: [geomPts(el.geometry)], inner: [] } : null;
  if (el.type === 'relation') {
    const o = [], i = [];
    for (const m of el.members || []) if (m.type === 'way' && m.geometry) (m.role === 'inner' ? i : o).push(geomPts(m.geometry));
    return { outer: assemble(o), inner: assemble(i) };
  }
  return null;
}

// ---------- POIs ----------
const GROUPS = {}; // id -> {pts:[], names:[], types:[], typeList:[]}
function add(gid, x, y, name, type) {
  const g = GROUPS[gid] || (GROUPS[gid] = { pts: [], names: [], t: [], types: [] });
  let ti = g.types.indexOf(type); if (ti < 0) { ti = g.types.length; g.types.push(type); }
  g.pts.push([x, y]); g.names.push(name); g.t.push(ti);
}
const pretty = s => (s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const FOODSHOP = new Set(['convenience', 'kiosk', 'greengrocer', 'butcher', 'deli', 'beverages', 'cheese', 'seafood', 'farm', 'health_food', 'frozen_food', 'spices', 'pasta', 'tea', 'coffee', 'wine', 'chocolate', 'food']);
const SERVICE = new Set(['hairdresser', 'laundry', 'dry_cleaning', 'tailor', 'copyshop', 'shoe_repair', 'optician', 'locksmith', 'key_cutter']);
const NOSHOP = new Set(['car', 'car_repair', 'car_parts', 'tyres', 'motorcycle', 'motorcycle_repair', 'vacant', 'funeral_directors', 'bookmaker', 'lottery', 'wholesale', 'trade', 'storage_rental', 'boat', 'caravan', 'truck', 'fuel', 'gas', 'agrarian', 'yes', 'no', 'disused', 'outpost', 'pawnbroker', 'money_lender', 'e-cigarette', 'erotic', 'weapons', 'car_wash', 'mall', 'department_store_vacant']);
const TYPE = {
  cafe: 'Café', ice_cream: 'Ice cream', restaurant: 'Restaurant', fast_food: 'Takeaway', food_court: 'Food court',
  bar: 'Bar', pub: 'Pub', biergarten: 'Beer garden', nightclub: 'Club', doctors: 'Doctor', doctor: 'Doctor', dentist: 'Dentist',
  clinic: 'Clinic', centre: 'Medical centre', cinema: 'Cinema', theatre: 'Theatre', library: 'Library', arts_centre: 'Arts centre',
  music_venue: 'Music venue', concert_hall: 'Concert hall', museum: 'Museum', gallery: 'Gallery', fitness_centre: 'Gym',
  sports_centre: 'Sports centre', swimming_pool: 'Pool', ice_rink: 'Ice rink', bank: 'Bank', atm: 'ATM', marketplace: 'Market',
  supermarket: 'Supermarket', organic: 'Organic supermarket', bakery: 'Bakery', pastry: 'Pastry shop', confectionery: 'Confectioner',
  chemist: 'Drugstore', post_office: 'Post office', pharmacy: 'Pharmacy', dry_cleaning: 'Dry cleaner', copyshop: 'Copy shop',
  greengrocer: 'Greengrocer', beverages: 'Drinks shop', convenience: 'Convenience store', kiosk: 'Kiosk', deli: 'Deli',
};
const typeOf = v => TYPE[v] || pretty(v);
function classify(r) {
  const a = r.amenity, s = r.shop, l = r.leisure, t = r.tourism, h = r.healthcare;
  if (a === 'post_box') return null;
  if (s === 'supermarket' || s === 'organic') return ['supermarket', s];
  if (a === 'marketplace') return ['foodshop', a];
  if (FOODSHOP.has(s)) return ['foodshop', s];
  if (['bakery', 'pastry', 'confectionery'].includes(s)) return ['bakery', s];
  if (a === 'cafe' || a === 'ice_cream') return ['cafe', a];
  if (['restaurant', 'fast_food', 'food_court'].includes(a)) return ['restaurant', a];
  if (['bar', 'pub', 'biergarten', 'nightclub'].includes(a)) return ['bar', a];
  if (a === 'pharmacy' || h === 'pharmacy') return ['pharmacy', 'pharmacy'];
  if (['doctors', 'dentist', 'clinic'].includes(a)) return ['doctor', a];
  if (['doctor', 'dentist', 'clinic', 'centre'].includes(h)) return ['doctor', h];
  if (s === 'chemist') return ['drugstore', s];
  if (a === 'post_office') return ['post', a];
  if (a === 'bank' || a === 'atm') return ['cash', a];
  if (SERVICE.has(s)) return ['service', s];
  if (['fitness_centre', 'sports_centre', 'swimming_pool', 'ice_rink'].includes(l)) return ['sport', l];
  if (['cinema', 'theatre', 'library', 'arts_centre', 'music_venue', 'concert_hall'].includes(a)) return ['culture', a];
  if (t === 'museum' || t === 'gallery') return ['culture', t];
  if (s && !NOSHOP.has(s)) return ['shop', s];
  return null;
}
{
  const lines = fs.readFileSync(path.join(RAW, 'pois.tsv'), 'utf8').split('\n');
  const head = lines[0].split('\t').map(h => h.replace(/^@/, ''));
  let n = 0;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = line.split('\t'); const r = {}; head.forEach((h, i) => r[h] = c[i] || '');
    if (!r.lat) continue;
    const k = classify(r); if (!k) continue;
    const [x, y] = xy(+r.lat, +r.lon);
    add(k[0], x, y, (r.name || r.brand || '').trim(), typeOf(k[1])); n++;
  }
  log('POIs classified', n, Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, g.pts.length])));
}

// ---------- transit ----------
const LINE_COLORS = {
  U1: '#3c7233', U2: '#c3022d', U3: '#ed6720', U4: '#00ab85', U5: '#bd7b00', U6: '#0065ae', U7: '#3c7233', U8: '#c3022d', S5: '#0d6b9c',
  S1: '#1ab3e2', S2: '#71bf44', S3: '#7b107d', S4: '#ee1c25', S6: '#008a51', S7: '#963833', S8: '#2f2f2f', S20: '#f05a73',
};
const linesOut = []; // {ref, mode, color}
const lineSeqs = []; // drawn network: {li, seq:[[x,y]...]}
{
  const T = { elements: [...readJSON('transit_rail.json').elements, ...readJSON('transit_bus.json').elements] };
  const nodes = new Map();
  for (const e of T.elements) if (e.type === 'node') nodes.set(e.id, e);
  const lineIdx = new Map();
  const stopsByLine = new Map(); // li -> [[x,y,name]]
  const seqSeen = new Set();
  for (const e of T.elements) {
    if (e.type !== 'relation') continue;
    const tg = e.tags || {}; const ref = (tg.ref || '').trim(); if (!ref) continue;
    let mode = null;
    if (tg.route === 'subway' && /^U\d$/.test(ref)) mode = 'rail';
    else if ((tg.route === 'train' || tg.route === 'light_rail') && /^S\d+$/.test(ref)) mode = 'rail';
    else if (tg.route === 'tram' && /^\d+$/.test(ref)) mode = 'tram';
    else if (tg.route === 'bus' && /^X?\d+$/.test(ref) && !/^N/.test(ref)) mode = 'bus';
    if (!mode) continue;
    if (mode === 'bus' && tg.network && !/MVV|MVG|Münch/i.test(tg.network)) continue;
    const key = mode + ':' + ref;
    if (!lineIdx.has(key)) {
      lineIdx.set(key, linesOut.length);
      linesOut.push({ ref, mode, color: LINE_COLORS[ref] || (mode === 'tram' ? '#c8102e' : mode === 'bus' ? '#0b5a6b' : '#555') });
      stopsByLine.set(linesOut.length - 1, []);
    }
    const li = lineIdx.get(key);
    const seq = [];
    for (const m of e.members || []) {
      if (m.type !== 'node' || !/^(stop|stop_entry_only|stop_exit_only|platform|platform_entry_only|platform_exit_only)$/.test(m.role)) continue;
      const n = nodes.get(m.ref); if (!n) continue;
      const [x, y] = xy(n.lat, n.lon);
      const name = ((n.tags && n.tags.name) || '').replace(/^München[, ]+/, '').trim();
      const arr = stopsByLine.get(li);
      if (!arr.some(s => Math.hypot(s[0] - x, s[1] - y) < 40)) arr.push([x, y, name]);
      if (/^stop/.test(m.role)) seq.push([x, y]);
    }
    if (mode !== 'bus' && seq.length > 1) {
      const sig = li + ':' + seq.map(p => p.join(',')).sort().join(';');
      if (!seqSeen.has(sig)) { seqSeen.add(sig); lineSeqs.push({ li, seq }); }
    }
  }
  for (const mode of ['rail', 'tram', 'bus']) {
    const g = GROUPS[mode] = { pts: [], names: [], t: [], types: [], keys: [] };
    for (const [li, stops] of stopsByLine) {
      if (linesOut[li].mode !== mode) continue;
      for (const [x, y, name] of stops) { g.pts.push([x, y]); g.names.push(name); g.t.push(0); g.keys.push(li); }
    }
    g.types = [mode === 'rail' ? 'Station' : 'Stop'];
  }
  log('lines', linesOut.length, 'rail', linesOut.filter(l => l.mode === 'rail').map(l => l.ref).join(' '),
    '| tram', linesOut.filter(l => l.mode === 'tram').length, '| bus', linesOut.filter(l => l.mode === 'bus').length,
    '| stops', GROUPS.rail.pts.length, GROUPS.tram.pts.length, GROUPS.bus.pts.length);
}

// ---------- green ----------
const mapParks = [];
const AREAS = []; // parks, woods, water: scored by distance to their edge
{
  const G = readJSON('green.json');
  const seen = new Set();
  for (const el of G.elements) {
    const p = polysOf(el); if (!p || !p.outer.length) continue;
    const tg = el.tags || {};
    const type = tg.landuse === 'cemetery' ? 2 : (tg.landuse === 'forest' || tg.natural === 'wood') ? 1 : tg.leisure === 'nature_reserve' ? 3 : 0;
    const area = p.outer.reduce((a, r) => a + ringArea(r), 0) - p.inner.reduce((a, r) => a + ringArea(r), 0);
    const draw = { t: type, o: p.outer.map(r => enc(simplify(r, 6))), i: p.inner.map(r => enc(simplify(r, 6))) };
    if (area > 1500) mapParks.push(draw);
    if (area < 5000) continue;
    if (type !== 2 && tg.access && /private|no/.test(tg.access)) continue;
    const sig = Math.round(area / 100) + ':' + p.outer[0][0].join(',');
    if (seen.has(sig)) continue; seen.add(sig);
    let f = 0.35 + 0.65 * Math.log10(area / 5000) / Math.log10(1e6 / 5000);
    f = Math.min(1, f) * (type === 2 ? 0.6 : type === 1 ? 0.9 : 1);
    AREAS.push({ n: tg.name || '', t: type, m: +f.toFixed(3), rings: p.outer.map(r => simplify(r, 8).flat()) });
  }
  log('green areas', AREAS.length, 'drawn', mapParks.length);
}

// ---------- water, roads ----------
const mapWater = [], mapRivers = [], mapRoads = { motorway: [], trunk: [], primary: [], secondary: [], tertiary: [], rail: [] };
{
  const W = readJSON('water.json');
  for (const el of W.elements) {
    const tg = el.tags || {};
    if (tg.waterway && el.type === 'way' && el.geometry) { mapRivers.push({ w: tg.waterway === 'river' ? 1 : 0, p: enc(simplify(geomPts(el.geometry), 5)) }); continue; }
    const p = polysOf(el); if (!p || !p.outer.length) continue;
    const area = p.outer.reduce((a, r) => a + ringArea(r), 0);
    if (area < 800) continue;
    if (area > 50000) // rivers and lakes count as green space
      AREAS.push({ n: tg.name || (tg.water === 'river' ? 'River' : 'Lake'), t: 4, m: 0.85, rings: p.outer.map(r => simplify(r, 8).flat()) });
    mapWater.push({ o: p.outer.map(r => enc(simplify(r, 4))), i: p.inner.map(r => enc(simplify(r, 4))) });
  }
  const R = readJSON('roads.json');
  for (const el of R.elements) {
    if (!el.geometry) continue;
    const tg = el.tags || {};
    let cls = tg.railway === 'rail' ? 'rail' : (tg.highway || '').replace(/_link$/, '');
    if (!mapRoads[cls]) continue;
    mapRoads[cls].push(enc(simplify(geomPts(el.geometry), cls === 'tertiary' ? 6 : 4)));
  }
  log('water', mapWater.length, 'rivers', mapRivers.length, 'roads', Object.fromEntries(Object.entries(mapRoads).map(([k, v]) => [k, v.length])));
}

// ---------- admin ----------
let city = null; const districts = []; const places = [];
{
  const A = readJSON('admin.json');
  for (const el of A.elements) {
    if (el.type === 'relation' && el.id === 62428) city = polysOf(el);
    else if (el.type === 'relation' && el.tags && el.tags.admin_level === '9') {
      const p = polysOf(el); if (!p) continue;
      districts.push({ name: el.tags.name.replace(/^Stadtbezirk \d+\s*/, ''), num: el.tags['ref'] || el.tags['name:prefix'] || '', poly: p });
    } else if (el.type === 'node' && el.tags && el.tags.name) {
      const [x, y] = xy(el.lat, el.lon); places.push({ n: el.tags.name, k: el.tags.place, x, y });
    }
  }
  const cityS = { outer: city.outer.map(r => simplify(r, 10)), inner: city.inner.map(r => simplify(r, 10)) };
  global.cityS = cityS;
  const centroid = r => { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };
  for (let i = districts.length - 1; i >= 0; i--) {
    const big = districts[i].poly.outer.reduce((a, r) => r.length > a.length ? r : a, []);
    if (!big.length || !inPoly(...centroid(big), cityS)) districts.splice(i, 1);
  }
  for (let i = places.length - 1; i >= 0; i--) if (!inPoly(places[i].x, places[i].y, cityS)) places.splice(i, 1);
  log('city rings', city && city.outer.length, 'districts', districts.length, districts.map(d => d.name).join(', '), '| places', places.length);
}

// ---------- grid ----------
// ---------- walking network ----------
function dpIdx(pts, tol) { // Douglas-Peucker on an open polyline, returns kept indices
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, c] = stack.pop(); if (c - a < 2) continue;
    const [ax, ay] = pts[a], [bx, by] = pts[c], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let md = -1, mi = -1;
    for (let i = a + 1; i < c; i++) {
      const d = L ? Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, c]); }
  }
  const out = []; keep.forEach((k, i) => k && out.push(i)); return out;
}
let graph = null;
{
  const W = readJSON('walk.json'), N = W.nodes, nN = N.length / 2;
  const use = new Uint8Array(nN);
  for (const w of W.ways) { for (const i of w) use[i] = Math.min(9, use[i] + 1); use[w[0]] = Math.min(9, use[w[0]] + 1); use[w[w.length - 1]] = Math.min(9, use[w[w.length - 1]] + 1); }
  const vid = new Int32Array(nN).fill(-1), vx = [], vy = [];
  const newV = (x, y) => { vx.push(x); vy.push(y); return vx.length - 1; };
  const getV = i => vid[i] >= 0 ? vid[i] : (vid[i] = newV(N[2 * i], N[2 * i + 1]));
  let eu = [], ev = [], el = [];
  const addEdge = (u, v, L) => { // long edges get midpoints so snapping stays precise
    const n = Math.ceil(L / 250);
    let prev = u;
    for (let k = 1; k < n; k++) { const m = newV(vx[u] + (vx[v] - vx[u]) * k / n, vy[u] + (vy[v] - vy[u]) * k / n); eu.push(prev); ev.push(m); el.push(L / n); prev = m; }
    eu.push(prev); ev.push(v); el.push(L / n);
  };
  for (const w of W.ways) {
    let s0 = 0;
    for (let k = 1; k < w.length; k++) {
      if (use[w[k]] < 2 && k !== w.length - 1) continue;
      const pts = []; for (let j = s0; j <= k; j++) pts.push([N[2 * w[j]], N[2 * w[j] + 1]]);
      const cum = [0]; for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
      const keep = dpIdx(pts, 6);
      let pv = getV(w[s0]), pj = 0;
      for (let q = 1; q < keep.length; q++) {
        const j = keep[q], v = j === pts.length - 1 ? getV(w[k]) : newV(pts[j][0], pts[j][1]);
        const L = cum[j] - cum[pj];
        if (v !== pv && L > 0.05) addEdge(pv, v, L);
        pv = v; pj = j;
      }
      s0 = k;
    }
  }
  log('walk graph raw', vx.length, 'vertices', eu.length, 'edges');
  // keep the largest connected piece
  const par = new Int32Array(vx.length).map((_, i) => i);
  const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let e = 0; e < eu.length; e++) { const a = find(eu[e]), c = find(ev[e]); if (a !== c) par[a] = c; }
  const size = new Map(); for (let i = 0; i < vx.length; i++) { const r = find(i); size.set(r, (size.get(r) || 0) + 1); }
  const main = [...size].sort((a, c) => c[1] - a[1])[0][0];
  // spatial (Z-order) numbering so the binary compresses well
  const morton = (x, y) => { let z = 0; for (let i = 0; i < 16; i++) z += (((x >> i) & 1) * 2 ** (2 * i)) + (((y >> i) & 1) * 2 ** (2 * i + 1)); return z; };
  const keepV = []; for (let i = 0; i < vx.length; i++) if (find(i) === main) keepV.push(i);
  const mc = new Map(keepV.map(i => [i, morton(Math.round((vx[i] + 20000) / 2), Math.round((vy[i] + 15000) / 2))]));
  keepV.sort((a, c) => mc.get(a) - mc.get(c));
  const remap = new Int32Array(vx.length).fill(-1); keepV.forEach((i, k) => remap[i] = k);
  const nV = keepV.length;
  const X = new Int16Array(nV), Y = new Int16Array(nV);
  keepV.forEach((i, k) => { X[k] = Math.round(vx[i]); Y[k] = Math.round(vy[i]); });
  const E = new Map();
  for (let e = 0; e < eu.length; e++) {
    let u = remap[eu[e]], v = remap[ev[e]]; if (u < 0 || v < 0 || u === v) continue;
    if (u > v) [u, v] = [v, u];
    const key = u * 2 ** 21 + v, L = Math.max(1, Math.round(el[e] * 10));
    if (!E.has(key) || E.get(key)[2] > L) E.set(key, [u, v, L]);
  }
  const edges = [...E.values()].sort((a, c) => a[0] - c[0] || a[1] - c[1]);
  const nE = edges.length;
  if (edges.some(e => e[2] > 65535)) throw new Error('edge too long');
  // binary: 'WLK1' nV nE | ev-eu Int32[nE] | x Int16[nV] | y Int16[nV] | len dm Uint16[nE] | edges-per-vertex Uint8[nV]
  const buf = Buffer.alloc(12 + 4 * nE + 4 * nV + 2 * nE + nV);
  buf.write('WLK1', 0, 'ascii'); buf.writeUInt32LE(nV, 4); buf.writeUInt32LE(nE, 8);
  let o = 12;
  for (const [u, v] of edges) { buf.writeInt32LE(v - u, o); o += 4; }
  for (let i = 0; i < nV; i++) { buf.writeInt16LE(X[i], o); o += 2; }
  for (let i = 0; i < nV; i++) { buf.writeInt16LE(Y[i], o); o += 2; }
  for (const e of edges) { buf.writeUInt16LE(e[2], o); o += 2; }
  const cnt = new Uint8Array(nV); for (const [u] of edges) { if (cnt[u] === 255) throw new Error('degree'); cnt[u]++; }
  Buffer.from(cnt).copy(buf, o);
  const gz = require('zlib').gzipSync(buf, { level: 9 });
  fs.writeFileSync(path.join(OUT, 'walk.txt'), gz.toString('base64')); // artifacts serve text, not raw binary
  log('walk graph', nV, 'vertices', nE, 'edges, binary', (buf.length / 1024).toFixed(0) + ' KB, gzipped', (gz.length / 1024).toFixed(0) + ' KB');
  // build the graph from exactly what the page will decode
  graph = S.makeGraph({ xs: X, ys: Y, eu: Int32Array.from(edges, e => e[0]), ev: Int32Array.from(edges, e => e[1]), el: Float32Array.from(edges, e => e[2] / 10) });
}

const AREA_TYPES = ['Park', 'Woods', 'Cemetery', 'Nature reserve', 'Water'];
{ const s = S.sampleAreas(AREAS); GROUPS.park = { pts: s.xs.map((x, i) => [x, s.ys[i]]), keys: s.keys, mult: s.mult, names: [], t: [], types: AREA_TYPES, areas: true };
  log('area samples', s.xs.length); }
const prepared = S.prepare(Object.fromEntries(Object.entries(GROUPS).map(([id, g]) => [id, { xs: g.pts.map(p => p[0]), ys: g.pts.map(p => p[1]), keys: g.keys, mult: g.mult }])), process.env.NO_WALK ? null : graph);
log('snapped POIs to the walking network');
const CELL = 100;
let grid;
{
  const ring = city.outer.reduce((a, r) => r.length > a.length ? r : a);
  const minX = Math.min(...ring.map(p => p[0])), maxX = Math.max(...ring.map(p => p[0]));
  const minY = Math.min(...ring.map(p => p[1])), maxY = Math.max(...ring.map(p => p[1]));
  const x0 = Math.floor(minX / CELL) * CELL, y0 = Math.floor(minY / CELL) * CELL;
  const cols = Math.ceil((maxX - x0) / CELL), rows = Math.ceil((maxY - y0) / CELL);
  const nc = S.CATS.length;
  const buf = Buffer.alloc(cols * rows * nc, 255);
  let inside = 0;
  if (!process.env.SKIP_GRID) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = x0 + (c + .5) * CELL, y = y0 + (r + .5) * CELL;
    if (!inPoly(x, y, city)) continue;
    inside++;
    if (inside % 5000 === 0) log('grid cells', inside);
    const sc = S.evaluate(prepared, x, y, false);
    S.CATS.forEach((cat, k) => { buf[(r * cols + c) * nc + k] = Math.round(sc[cat.id].score * 250); });
  }
  grid = { x0, y0, cell: CELL, cols, rows, cats: S.CATS.map(c => c.id), b64: buf.toString('base64') };
  log('grid', cols, 'x', rows, 'inside', inside);
}

// ---------- addresses ----------
let addr = null;
{
  const f = path.join(RAW, 'addr.tsv');
  if (fs.existsSync(f)) {
    const streets = new Map();
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const [lat, lon, street, hn, pc] = line.split('\t');
      if (!lat || !street || !hn) continue;
      { const [ax, ay] = xy(+lat, +lon); if (!inPoly(ax, ay, global.cityS)) continue; }
      const st = streets.get(street) || streets.set(street, { pc: new Set(), nums: new Map() }).get(street);
      if (pc) st.pc.add(pc.trim());
      const h = hn.trim().replace(/\s+/g, '');
      if (!st.nums.has(h)) st.nums.set(h, xy(+lat, +lon));
    }
    const num = h => { const m = /^(\d+)(.*)$/.exec(h); return m ? [+m[1], m[2]] : [1e9, h]; };
    const out = [];
    for (const [name, st] of streets) {
      const hs = [...st.nums.keys()].sort((a, b) => { const A = num(a), B = num(b); return A[0] - B[0] || A[1].localeCompare(B[1]); });
      out.push([name, [...st.pc].sort().join(' '), hs.join(','), enc(hs.map(h => st.nums.get(h)))]);
    }
    out.sort((a, b) => a[0].localeCompare(b[0], 'de'));
    addr = out;
    log('streets', out.length, 'addresses', out.reduce((a, s) => a + s[2].split(',').length, 0));
  } else log('no addr.tsv yet');
}

// ---------- write ----------
const core = {
  built: new Date().toISOString().slice(0, 10),
  areas: { types: AREA_TYPES, list: AREAS.map(a => ({ n: a.n, t: a.t, m: a.m, r: a.rings.map(r => enc(r.reduce((acc, v, i) => (i % 2 ? acc[acc.length - 1].push(v) : acc.push([v]), acc), []))) })) },
  groups: Object.fromEntries(Object.entries(GROUPS).filter(([id]) => id !== 'park').map(([id, g]) => [id, {
    p: enc(g.pts), n: g.names, t: g.t, types: g.types, ...(g.keys ? { k: g.keys } : {}), ...(g.mult ? { m: g.mult } : {}),
  }])),
  lines: linesOut,
  grid,
  districts: districts.map(d => ({ name: d.name, num: d.num, o: d.poly.outer.map(r => enc(simplify(r, 12))), i: d.poly.inner.map(r => enc(simplify(r, 12))) })),
  places,
};
const map = {
  city: { o: city.outer.map(r => enc(simplify(r, 8))), i: city.inner.map(r => enc(simplify(r, 8))) },
  parks: mapParks, water: mapWater, rivers: mapRivers, roads: mapRoads,
  net: lineSeqs.map(s => ({ li: s.li, p: enc(s.seq) })),
};
const write = (name, obj) => { const s = JSON.stringify(obj); fs.writeFileSync(path.join(OUT, name), s); log('wrote', name, (s.length / 1024).toFixed(0) + ' KB'); };
if (!process.env.SKIP_GRID) { write('core.json', core); write('map.json', map); if (addr) write('addr.json', addr); }

// sanity: sample spots
const SPOTS = { 'Gärtnerplatz': [48.1316, 11.5755], 'Münchner Freiheit': [48.1617, 11.5862], 'Maxvorstadt (Türkenstr.)': [48.1503, 11.5776],
  'Haidhausen (Weißenburger Pl.)': [48.1294, 11.5948], 'Neuhausen (Rotkreuzpl.)': [48.1530, 11.5340], 'Sendling (Harras)': [48.1170, 11.5370],
  'Giesing (Tegernseer Ldstr.)': [48.1120, 11.5780], 'Bogenhausen (Arabellapark)': [48.1530, 11.6170], 'Trudering': [48.1230, 11.6680],
  'Moosach (Hanauer Str.)': [48.1800, 11.5100], 'Aubing': [48.1540, 11.4110], 'Hasenbergl': [48.2130, 11.5560], 'Marienplatz': [48.1374, 11.5755] };
for (const [n, [lat, lon]] of Object.entries(SPOTS)) {
  const [x, y] = S.toXY(lat, lon); const sc = S.evaluate(prepared, x, y, true);
  const flat = Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, v.score]));
  console.log(n.padEnd(30), S.overall(flat, S.DEFAULT_WEIGHTS).toFixed(0).padStart(3), S.CATS.map(c => c.id.slice(0, 5) + ':' + Math.round(flat[c.id] * 100)).join(' '), 'buzz n=' + sc.buzz.count);
}
