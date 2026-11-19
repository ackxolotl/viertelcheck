/* Viertelcheck scoring model — shared by the build script (Node) and the page.
 * Distances are straight-line metres in a local projection centred on Munich,
 * multiplied by a detour factor to approximate walking along streets. */
(function (root) {
  const LAT0 = 48.137, LON0 = 11.575;
  const M_LAT = 111132;
  const M_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);
  const DETOUR = 1.25;      // street network vs. straight line
  const WALK = 80;          // metres per minute (4.8 km/h)
  const MAX_MIN = 25;       // nothing further than this counts
  const MAX_WALK = MAX_MIN * WALK;          // 2000 m along streets
  const MAX_R = MAX_WALK / DETOUR;          // straight-line search radius without a street network

  const toXY = (lat, lon) => [(lon - LON0) * M_LON, (lat - LAT0) * M_LAT];
  const toLatLon = (x, y) => [LAT0 + y / M_LAT, LON0 + x / M_LON];
  const minutes = d => d * DETOUR / WALK;

  // Walking-time decay curves: [minutes, share of full value]
  const PROFILES = {
    daily:   [[3, 1], [6, .7], [10, .35], [15, .1], [20, 0]],
    leisure: [[5, 1], [10, .65], [15, .35], [20, .12], [25, 0]],
    rail:    [[4, 1], [8, .75], [12, .45], [16, .2], [22, 0]],
    stop:    [[2, 1], [5, .65], [8, .3], [12, 0]],
    park:    [[5, 1], [10, .85], [15, .55], [20, .25], [25, 0]],
  };
  function decay(profile, min) {
    const p = PROFILES[profile];
    if (min <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (min <= p[i][0]) {
        const [m0, v0] = p[i - 1], [m1, v1] = p[i];
        return v0 + (v1 - v0) * (min - m0) / (m1 - m0);
      }
    }
    return 0;
  }

  // Categories. Each group scores its nearest options (depth weights reward choice);
  // a category blends its groups either as a weighted sum or as "any of these" (or).
  const CATS = [
    { id: 'groceries', label: 'Groceries', hint: 'Supermarkets, plus markets, butchers, greengrocers and kiosks',
      groups: [
        { id: 'supermarket', label: 'Supermarket', w: .8, depth: [1, .6, .4, .3], profile: 'daily' },
        { id: 'foodshop', label: 'Food shop', w: .2, depth: [1, .6, .4], profile: 'daily' }] },
    { id: 'transit', label: 'Transit', hint: 'U-Bahn and S-Bahn lines, trams and buses. More lines nearby scores higher',
      combine: 'or',
      groups: [
        { id: 'rail', label: 'U-/S-Bahn', w: .9, depth: [1, .35, .25, .2, .15, .1], profile: 'rail', lines: true },
        { id: 'tram', label: 'Tram', w: .55, depth: [1, .4, .25], profile: 'stop', lines: true },
        { id: 'bus', label: 'Bus', w: .35, depth: [1, .4, .3, .2], profile: 'stop', lines: true }] },
    { id: 'bakery', label: 'Bakery', hint: 'Bakeries and pastry shops',
      groups: [{ id: 'bakery', label: 'Bakery', w: 1, depth: [1, .5, .3], profile: 'daily' }] },
    { id: 'cafes', label: 'Cafés', hint: 'Cafés and ice-cream parlours',
      groups: [{ id: 'cafe', label: 'Café', w: 1, depth: [1, .7, .5, .4, .35, .3, .3, .25, .25, .2, .2, .2], profile: 'daily' }] },
    { id: 'food', label: 'Restaurants', hint: 'Restaurants, takeaways and food courts',
      groups: [{ id: 'restaurant', label: 'Restaurant', w: 1, depth: [1, .8, .6, .5, .45, .4, .35, .3, .3, .3, .25, .25, .25, .2, .2, .2, .2, .2, .2, .2], profile: 'daily' }] },
    { id: 'nightlife', label: 'Bars & beer gardens', hint: 'Bars, pubs, beer gardens and clubs',
      groups: [{ id: 'bar', label: 'Bar', w: 1, depth: [1, .7, .5, .4, .35, .3, .3, .25, .25, .2], profile: 'daily' }] },
    { id: 'health', label: 'Health', hint: 'Pharmacies, GPs, dentists and other practices',
      groups: [
        { id: 'pharmacy', label: 'Pharmacy', w: .4, depth: [1, .3], profile: 'daily' },
        { id: 'doctor', label: 'Doctor', w: .6, depth: [1, .6, .5, .4, .3, .3, .25, .25], profile: 'daily' }] },
    { id: 'errands', label: 'Errands', hint: 'Drugstores (dm, Rossmann, Müller), post, cash, hairdressers, laundries',
      groups: [
        { id: 'drugstore', label: 'Drugstore', w: .35, depth: [1, .3], profile: 'daily' },
        { id: 'post', label: 'Post office', w: .2, depth: [1], profile: 'daily' },
        { id: 'cash', label: 'Bank / ATM', w: .15, depth: [1], profile: 'daily' },
        { id: 'service', label: 'Service', w: .3, depth: [1, .7, .5, .4, .3], profile: 'daily' }] },
    { id: 'green', label: 'Parks & Isar', hint: 'Parks, woods, the Isar and lakes. Big parks count more than pocket parks',
      groups: [{ id: 'park', label: 'Park', w: 1, depth: [1, .3, .15], profile: 'park', keyed: true }] },
    { id: 'sport', label: 'Sport', hint: 'Gyms, sports centres and pools',
      groups: [{ id: 'sport', label: 'Sport', w: 1, depth: [1, .6, .4, .3], profile: 'leisure' }] },
    { id: 'culture', label: 'Culture', hint: 'Cinemas, theatres, museums, galleries and libraries',
      groups: [{ id: 'culture', label: 'Culture', w: 1, depth: [1, .7, .5, .4, .35, .3, .3, .25, .25, .2], profile: 'leisure' }] },
    { id: 'shops', label: 'Shops', hint: 'Clothes, books, electronics and every other kind of shop',
      groups: [{ id: 'shop', label: 'Shop', w: 1, depth: [1, .8, .7, .6, .5, .5, .45, .4, .4, .35, .35, .3, .3, .3, .3, .25, .25, .25, .25, .25, .2, .2, .2, .2, .2, .2, .2, .2, .2, .2], profile: 'daily' }] },
    { id: 'buzz', label: 'Street life', hint: 'How many shops, cafés, bars and services are within 500 m: the density that makes a street feel like a city',
      count: { radius: 500, lo: 15, hi: 1000, from: ['supermarket', 'foodshop', 'bakery', 'cafe', 'restaurant', 'bar', 'pharmacy', 'doctor', 'drugstore', 'post', 'cash', 'service', 'culture', 'shop'] } },
  ];

  const DEFAULT_WEIGHTS = { groceries: 5, transit: 5, bakery: 3, cafes: 4, food: 3, nightlife: 3, health: 3,
    errands: 3, green: 3, sport: 2, culture: 2, shops: 2, buzz: 5 };

  const TIERS = [
    [90, 'Big-city core'], [80, 'Very urban'], [68, 'Urban'], [55, 'Mixed'], [40, 'Quiet residential'], [0, 'Suburban'],
  ];
  const tier = s => TIERS.find(t => s >= t[0])[1];

  // ---------- spatial index ----------
  const CELL = 400;
  // group = { xs: Float64Array|number[], ys, keys?: number[] (line or park id per point), mult?: number[] per key }
  function indexGroup(g) {
    const buckets = new Map();
    for (let i = 0; i < g.xs.length; i++) {
      const k = Math.floor(g.xs[i] / CELL) + ':' + Math.floor(g.ys[i] / CELL);
      let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(i);
    }
    g._b = buckets; return g;
  }
  function forNear(g, x, y, r, fn) {
    const cx0 = Math.floor((x - r) / CELL), cx1 = Math.floor((x + r) / CELL);
    const cy0 = Math.floor((y - r) / CELL), cy1 = Math.floor((y + r) / CELL);
    const r2 = r * r;
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const b = g._b.get(cx + ':' + cy); if (!b) continue;
      for (const i of b) { const dx = g.xs[i] - x, dy = g.ys[i] - y, d2 = dx * dx + dy * dy; if (d2 <= r2) fn(i, Math.sqrt(d2)); }
    }
  }

  // nearest options of one group, by key (line / park) or by point
  // nearest options of one group by walking distance (metres), keyed by line / park or by point
  function nearest(g, x, y, walk) {
    const best = new Map(); // key -> [walkMetres, pointIndex]
    forNear(g, x, y, walk ? MAX_WALK : MAX_R, (i, d) => {
      const wd = walk && g.se && g.se[i] >= 0 ? walk.distTo(g.se[i], g.st[i], g.sd[i]) : d * DETOUR;
      if (!(wd <= MAX_WALK)) return;
      const k = g.keys ? g.keys[i] : i;
      const cur = best.get(k);
      if (!cur || wd < cur[0]) best.set(k, [wd, i]);
    });
    return best;
  }

  function scoreGroup(spec, g, x, y, detail, walk) {
    if (!g) return { score: 0, items: [] };
    const best = nearest(g, x, y, walk);
    const vals = [];
    for (const [k, [d, i]] of best) {
      const min = d / WALK;
      const v = decay(spec.profile, min) * (g.mult ? g.mult[k] : 1);
      if (v > 0 || detail) vals.push({ k, i, d, min, v });
    }
    vals.sort((a, b) => b.v - a.v || a.d - b.d);
    let s = 0, tot = 0;
    spec.depth.forEach((w, j) => { tot += w; if (vals[j]) s += w * vals[j].v; });
    const out = { score: s / tot };
    if (detail) {
      out.items = vals.slice(0, 12);
      out.within10 = vals.filter(v => v.min <= 10).length;
    }
    return out;
  }

  // Park/water outlines -> boundary sample points (every ~45 m), keyed by area index.
  // areas: [{ m: multiplier, rings: [[x0,y0,x1,y1,...] absolute ints] }]
  function sampleAreas(areas) {
    const xs = [], ys = [], keys = [], mult = [];
    areas.forEach((a, k) => {
      mult.push(a.m);
      for (const r of a.rings) for (let i = 2; i < r.length; i += 2) {
        const ax = r[i - 2], ay = r[i - 1], bx = r[i], by = r[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 45));
        for (let j = 0; j < n; j++) { xs.push(Math.round(ax + (bx - ax) * j / n)); ys.push(Math.round(ay + (by - ay) * j / n)); keys.push(k); }
      }
    });
    return { xs, ys, keys, mult };
  }

  // raw: {groupId: {xs, ys, keys?, mult?}} -> indexed groups + the combined street-life group
  function prepare(raw, graph) {
    const groups = {};
    for (const id in raw) {
      const g = groups[id] = indexGroup({ xs: raw[id].xs, ys: raw[id].ys, keys: raw[id].keys, mult: raw[id].mult });
      if (graph) { // snap every point onto the street network once
        const n = g.xs.length; g.se = new Int32Array(n); g.st = new Float32Array(n); g.sd = new Float32Array(n);
        for (let i = 0; i < n; i++) { const s = graph.snap(g.xs[i], g.ys[i], 250); g.se[i] = s ? s.e : -1; g.st[i] = s ? s.t : 0; g.sd[i] = s ? s.d : 0; }
      }
    }
    const from = CATS.find(c => c.count).count.from;
    let n = 0; for (const id of from) n += raw[id] ? raw[id].xs.length : 0;
    const xs = new Float64Array(n), ys = new Float64Array(n); let j = 0;
    for (const id of from) if (raw[id]) for (let i = 0; i < raw[id].xs.length; i++) { xs[j] = raw[id].xs[i]; ys[j++] = raw[id].ys[i]; }
    return { groups, all: indexGroup({ xs, ys }), graph: graph || null };
  }

  // ---------- walking network ----------
  // net: { xs, ys: vertex coords (m); eu, ev: edge endpoints; el: edge length (m) }
  function makeGraph(net) {
    const nV = net.xs.length, nE = net.eu.length, xs = net.xs, ys = net.ys, eu = net.eu, ev = net.ev, el = net.el;
    const start = new Int32Array(nV + 1);
    for (let e = 0; e < nE; e++) { start[eu[e] + 1]++; start[ev[e] + 1]++; }
    for (let i = 0; i < nV; i++) start[i + 1] += start[i];
    const adjV = new Int32Array(2 * nE), adjL = new Float32Array(2 * nE), fill = start.slice(0, nV);
    for (let e = 0; e < nE; e++) {
      const u = eu[e], v = ev[e];
      adjV[fill[u]] = v; adjL[fill[u]++] = el[e]; adjV[fill[v]] = u; adjL[fill[v]++] = el[e];
    }
    const EC = 100, buckets = new Map(), bk = (cx, cy) => (cx + 2000) * 4096 + (cy + 2000);
    for (let e = 0; e < nE; e++) {
      const ax = xs[eu[e]], ay = ys[eu[e]], bx = xs[ev[e]], by = ys[ev[e]];
      for (let cx = Math.floor(Math.min(ax, bx) / EC); cx <= Math.floor(Math.max(ax, bx) / EC); cx++)
        for (let cy = Math.floor(Math.min(ay, by) / EC); cy <= Math.floor(Math.max(ay, by) / EC); cy++) {
          const k = bk(cx, cy); let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(e);
        }
    }
    // nearest point on any edge within maxR: {e, t (0..1 from eu to ev), d (metres off the network)}
    function snap(x, y, maxR) {
      let be = -1, bd = Infinity, bt = 0;
      for (const r of [60, maxR]) {
        for (let cx = Math.floor((x - r) / EC); cx <= Math.floor((x + r) / EC); cx++)
          for (let cy = Math.floor((y - r) / EC); cy <= Math.floor((y + r) / EC); cy++) {
            const b = buckets.get(bk(cx, cy)); if (!b) continue;
            for (const e of b) {
              const ax = xs[eu[e]], ay = ys[eu[e]], dx = xs[ev[e]] - ax, dy = ys[ev[e]] - ay, L2 = dx * dx + dy * dy;
              let t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
              const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
              if (d < bd) { bd = d; be = e; bt = t; }
            }
          }
        if (bd <= r) break;
      }
      return be >= 0 && bd <= maxR ? { e: be, t: bt, d: bd } : null;
    }
    // Dijkstra with a binary heap, reset only what the last run touched
    const dist = new Float64Array(nV).fill(Infinity);
    let touched = new Int32Array(4096), nt = 0, hk = new Float64Array(4096), hv = new Int32Array(4096), hn = 0, src = null;
    function relax(v, d) {
      if (dist[v] === Infinity) { if (nt === touched.length) { const t = new Int32Array(nt * 2); t.set(touched); touched = t; } touched[nt++] = v; }
      dist[v] = d;
      if (hn === hk.length) { const a = new Float64Array(hn * 2), b = new Int32Array(hn * 2); a.set(hk); b.set(hv); hk = a; hv = b; }
      let i = hn++;
      while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= d) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
      hk[i] = d; hv[i] = v;
    }
    function run(x, y, maxD) {
      for (let i = 0; i < nt; i++) dist[touched[i]] = Infinity;
      nt = 0; hn = 0;
      src = snap(x, y, 300);
      if (!src) return false;
      const L = el[src.e];
      relax(eu[src.e], src.d + src.t * L);
      if (src.d + (1 - src.t) * L < dist[ev[src.e]]) relax(ev[src.e], src.d + (1 - src.t) * L);
      while (hn) {
        const k = hk[0], a = hv[0];
        const lk = hk[--hn], lv = hv[hn]; let i = 0;
        for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hk[c + 1] < hk[c]) c++; if (hk[c] >= lk) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; }
        hk[i] = lk; hv[i] = lv;
        if (k > dist[a]) continue;
        if (k > maxD) break;
        for (let j = start[a]; j < start[a + 1]; j++) { const nd = k + adjL[j]; if (nd < dist[adjV[j]]) relax(adjV[j], nd); }
      }
      return true;
    }
    // walking metres from the last run's start to a point snapped onto edge e
    function distTo(e, t, d) {
      const L = el[e];
      let r = Math.min(dist[eu[e]] + t * L, dist[ev[e]] + (1 - t) * L);
      if (src && e === src.e) r = Math.min(r, src.d + Math.abs(t - src.t) * L);
      return r + d;
    }
    // every edge reached by the last run: cb(ax, ay, bx, by, farEndMetres)
    function forEachReached(maxD, cb) {
      for (let i = 0; i < nt; i++) {
        const a = touched[i], da = dist[a]; if (da > maxD) continue;
        for (let j = start[a]; j < start[a + 1]; j++) { const b = adjV[j]; if (b < a && dist[b] <= maxD) continue; const db = dist[b]; if (db > maxD) continue; cb(xs[a], ys[a], xs[b], ys[b], Math.max(da, db)); }
      }
    }
    return { nV, nE, snap, run, distTo, forEachReached, get source() { return src; } };
  }

  function countNear(g, x, y, r) { let n = 0; forNear(g, x, y, r, () => n++); return n; }

  // data: { groups: {id: group}, all: group (every POI, for street life) }
  function evaluate(data, x, y, detail) {
    const walk = data.graph && data.graph.run(x, y, MAX_WALK) ? data.graph : null;
    const cats = {};
    for (const c of CATS) {
      if (c.count) {
        const n = countNear(data.all, x, y, c.count.radius);
        const s = Math.max(0, Math.min(1, Math.log(Math.max(n, 1) / c.count.lo) / Math.log(c.count.hi / c.count.lo)));
        cats[c.id] = { score: s, count: n };
        continue;
      }
      const gs = c.groups.map(gs => ({ spec: gs, r: scoreGroup(gs, data.groups[gs.id], x, y, detail, walk) }));
      let s;
      if (c.combine === 'or') s = 1 - gs.reduce((p, { spec, r }) => p * (1 - spec.w * r.score), 1);
      else s = gs.reduce((a, { spec, r }) => a + spec.w * r.score, 0);
      cats[c.id] = detail ? { score: s, groups: gs.map(({ spec, r }) => ({ id: spec.id, ...r })) } : { score: s };
    }
    return cats;
  }

  function overall(catScores, weights) { // catScores: {id: 0..1}
    let s = 0, t = 0;
    for (const c of CATS) { const w = weights[c.id] ?? DEFAULT_WEIGHTS[c.id]; s += w * (catScores[c.id] || 0); t += w; }
    return t ? 100 * s / t : 0;
  }

  const api = { LAT0, LON0, M_LAT, M_LON, DETOUR, WALK, MAX_R, PROFILES, CATS, DEFAULT_WEIGHTS, TIERS,
    MAX_WALK, toXY, toLatLon, minutes, decay, tier, indexGroup, forNear, sampleAreas, prepare, makeGraph, evaluate, overall };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CityScore = api;
})(typeof window !== 'undefined' ? window : globalThis);
