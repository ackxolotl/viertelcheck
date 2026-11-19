// Streams a BBBike .osm.gz extract and writes Overpass-style JSON/TSV files into raw/.
// Usage: node --max-old-space-size=6144 build/extract_osm.js raw/bbbike/Muenchen.osm.gz raw
const fs = require('fs'), zlib = require('zlib'), readline = require('readline'), path = require('path');
const [FILE, OUT] = process.argv.slice(2);
const BB = { s: 48.045, w: 11.34, n: 48.265, e: 11.745 };
const inBB = (lat, lon) => lat >= BB.s && lat <= BB.n && lon >= BB.w && lon <= BB.e;
const t0 = Date.now(); const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = s => s.indexOf('&') < 0 ? s : s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
const attr = (line, name) => { const i = line.indexOf(' ' + name + '="'); if (i < 0) return null; const s = i + name.length + 3; return line.slice(s, line.indexOf('"', s)); };

// Generic streaming pass. want: 'node' | 'way' | 'relation'. cb(el) for each finished element of that type.
async function pass(want, cb) {
  const rl = readline.createInterface({ input: fs.createReadStream(FILE).pipe(zlib.createGunzip({ chunkSize: 1 << 20 })), crlfDelay: Infinity });
  let cur = null, n = 0;
  const prefix = '<' + want + ' ', close = '</' + want + '>';
  for await (const raw of rl) {
    const line = raw.trimStart();
    if (cur) {
      if (line.startsWith('<tag ')) cur.tags[unesc(attr(line, 'k'))] = unesc(attr(line, 'v'));
      else if (line.startsWith('<nd ')) cur.refs.push(+attr(line, 'ref'));
      else if (line.startsWith('<member ')) cur.members.push({ type: attr(line, 'type'), ref: +attr(line, 'ref'), role: unesc(attr(line, 'role') || '') });
      else if (line.startsWith(close)) { cb(cur); cur = null; n++; }
      continue;
    }
    if (line.startsWith(prefix)) {
      cur = { type: want, id: +attr(line, 'id'), tags: {} };
      if (want === 'node') { cur.lat = +attr(line, 'lat'); cur.lon = +attr(line, 'lon'); }
      if (want === 'way') cur.refs = [];
      if (want === 'relation') cur.members = [];
      if (line.endsWith('/>')) { cb(cur); cur = null; n++; }
    }
  }
  return n;
}

const isGreen = t => t.leisure === 'park' || t.landuse === 'recreation_ground' || t.leisure === 'nature_reserve' || t.landuse === 'forest' || t.natural === 'wood' || t.landuse === 'cemetery';
const isWater = t => t.natural === 'water';
const isRiver = t => t.waterway === 'river' || t.waterway === 'canal';
const isRoad = t => /^(motorway|trunk|primary|secondary|tertiary)$/.test(t.highway || '') || (t.railway === 'rail' && !t.service && /^(main|branch)$/.test(t.usage || ''));
const WALK_HW = /^(primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|pedestrian|service|track|footway|path|steps|trunk|trunk_link|cycleway|bridleway)$/;
function isWalk(t) {
  const hw = t.highway || ''; if (!WALK_HW.test(hw)) return false;
  const foot = t.foot || '', okFoot = /^(yes|designated|permissive|destination)$/.test(foot);
  if (/^(no|private)$/.test(foot)) return false;
  if (/^(private|no)$/.test(t.access || '') && !okFoot) return false;
  if ((hw === 'cycleway' || hw === 'bridleway') && !okFoot) return false;
  if (hw === 'footway' && /^(sidewalk|crossing)$/.test(t.footway || '')) return false; // streets themselves carry pedestrians
  if (hw === 'service' && /^(parking_aisle|drive-through|driveway)$/.test(t.service || '')) return false;
  if (t.motorroad === 'yes' || t.indoor === 'yes' || t.area === 'yes' && hw !== 'pedestrian') return false;
  if (t.tunnel === 'yes' && /^(trunk|trunk_link|primary|primary_link|secondary|secondary_link)$/.test(hw) && !okFoot) return false;
  return true;
}
const isRoute = t => t.type === 'route' && /^(subway|light_rail|train|tram|bus)$/.test(t.route || '');
const isAdmin = (r) => r.id === 62428 || (r.tags.boundary === 'administrative' && /^(9|10)$/.test(r.tags.admin_level || ''));

(async () => {
  // pass 1: relations
  const rels = [];
  const needWays = new Set(), needNodes = new Set(), routeNodes = new Set();
  await pass('relation', r => {
    const t = r.tags;
    if (isRoute(t)) { rels.push({ ...r, kind: 'route' }); for (const m of r.members) if (m.type === 'node') { needNodes.add(m.ref); routeNodes.add(m.ref); } }
    else if (t.type === 'multipolygon' && (isGreen(t) || isWater(t))) { rels.push({ ...r, kind: isWater(t) ? 'water' : 'green' }); for (const m of r.members) if (m.type === 'way') needWays.add(m.ref); }
    else if (isAdmin(r)) { rels.push({ ...r, kind: 'admin' }); for (const m of r.members) if (m.type === 'way') needWays.add(m.ref); }
  });
  log('relations kept', rels.length, 'member ways', needWays.size);

  // pass 2: ways
  const ways = new Map(); // id -> {tags, refs, kind}
  const walkWays = [];
  await pass('way', w => {
    const t = w.tags; let kind = null;
    if (isWalk(t)) { walkWays.push(w.refs); for (const r of w.refs) needNodes.add(r); }
    if (isGreen(t)) kind = 'green'; else if (isWater(t)) kind = 'water'; else if (isRiver(t)) kind = 'river'; else if (isRoad(t)) kind = 'road';
    else if (t['addr:housenumber'] && t['addr:street']) kind = 'addr';
    if (!kind && !needWays.has(w.id)) return;
    ways.set(w.id, { id: w.id, tags: kind === 'addr' ? { s: t['addr:street'], h: t['addr:housenumber'], p: t['addr:postcode'] || '' } : t, refs: w.refs, kind });
    for (const r of w.refs) needNodes.add(r);
  });
  log('ways kept', ways.size, 'walk ways', walkWays.length, 'nodes needed', needNodes.size);

  // pass 3: nodes
  const coords = new Map(); const nodeTags = new Map();
  const addrRows = [], places = [];
  await pass('node', nd => {
    const t = nd.tags;
    if (needNodes.has(nd.id)) { coords.set(nd.id, [nd.lat, nd.lon]); if (routeNodes.has(nd.id)) nodeTags.set(nd.id, t); }
    if (!inBB(nd.lat, nd.lon)) return;
    if (t['addr:housenumber'] && t['addr:street']) addrRows.push([nd.lat, nd.lon, t['addr:street'], t['addr:housenumber'], t['addr:postcode'] || '']);
    if (/^(suburb|quarter|neighbourhood)$/.test(t.place || '') && t.name) places.push({ type: 'node', id: nd.id, lat: nd.lat, lon: nd.lon, tags: { name: t.name, place: t.place } });
  });
  log('coords', coords.size, 'addr nodes', addrRows.length, 'places', places.length);

  const geom = refs => refs.map(r => coords.get(r)).filter(Boolean).map(([lat, lon]) => ({ lat, lon }));
  const anyIn = g => g.some(p => inBB(p.lat, p.lon));
  const wayEl = w => ({ type: 'way', id: w.id, tags: w.tags, geometry: geom(w.refs) });
  const relGeomEl = r => ({ type: 'relation', id: r.id, tags: r.tags, members: r.members.filter(m => m.type === 'way' && ways.has(m.ref)).map(m => ({ type: 'way', ref: m.ref, role: m.role, geometry: geom(ways.get(m.ref).refs) })) });
  const write = (name, elements) => { fs.writeFileSync(path.join(OUT, name), JSON.stringify({ elements })); log('wrote', name, elements.length); };

  // transit
  const routeEls = (re) => {
    const rs = rels.filter(r => r.kind === 'route' && re.test(r.tags.route) && r.members.some(m => m.type === 'node' && coords.has(m.ref) && inBB(...coords.get(m.ref))));
    const nodes = new Set(); for (const r of rs) for (const m of r.members) if (m.type === 'node' && coords.has(m.ref)) nodes.add(m.ref);
    return [...rs.map(r => ({ type: 'relation', id: r.id, tags: r.tags, members: r.members })),
      ...[...nodes].map(id => ({ type: 'node', id, lat: coords.get(id)[0], lon: coords.get(id)[1], tags: nodeTags.get(id) || {} }))];
  };
  write('transit_rail.json', routeEls(/^(subway|light_rail|train|tram)$/));
  write('transit_bus.json', routeEls(/^bus$/));

  const wayList = kind => [...ways.values()].filter(w => w.kind === kind).map(wayEl).filter(e => e.geometry.length > 1 && anyIn(e.geometry));
  const relList = kind => rels.filter(r => r.kind === kind).map(relGeomEl).filter(e => e.members.some(m => anyIn(m.geometry)));
  write('green.json', [...wayList('green'), ...relList('green')]);
  write('water.json', [...wayList('water'), ...relList('water'), ...wayList('river')]);
  write('roads.json', wayList('road'));
  write('admin.json', [...relList('admin'), ...places]);

  for (const w of ways.values()) {
    if (w.kind !== 'addr') continue;
    const g = geom(w.refs); if (!g.length) continue;
    let s = Infinity, n = -Infinity, we = Infinity, e = -Infinity;
    for (const p of g) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); we = Math.min(we, p.lon); e = Math.max(e, p.lon); }
    const lat = (s + n) / 2, lon = (we + e) / 2;
    if (inBB(lat, lon)) addrRows.push([+lat.toFixed(7), +lon.toFixed(7), w.tags.s, w.tags.h, w.tags.p]);
  }
  {
    const S = require('./score.js');
    const idx = new Map(); const nodes = []; const out = [];
    for (const refs of walkWays) {
      const cs = refs.map(r => coords.get(r));
      if (cs.some(c => !c) || !cs.some(c => inBB(c[0], c[1]))) continue;
      out.push(refs.map((r, k) => {
        let i = idx.get(r);
        if (i === undefined) { i = nodes.length / 2; idx.set(r, i); const [x, y] = S.toXY(cs[k][0], cs[k][1]); nodes.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10); }
        return i;
      }));
    }
    fs.writeFileSync(path.join(OUT, 'walk.json'), JSON.stringify({ nodes, ways: out }));
    log('wrote walk.json ways', out.length, 'nodes', nodes.length / 2);
  }
  const clean = v => String(v).replace(/[\t\n\r]/g, ' ');
  fs.writeFileSync(path.join(OUT, 'addr.tsv'), addrRows.map(r => r.map(clean).join('\t')).join('\n'));
  log('wrote addr.tsv', addrRows.length);
})();
