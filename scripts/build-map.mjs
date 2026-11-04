// Builds public/europe.json: playable countries split into regions, plus
// neighbouring land for context.
//
// Sources (all Natural Earth 1:10m, downloaded once into .cache/):
//  - admin-1 provinces give borders and owners (disputed areas follow that
//    dataset, e.g. Crimea belongs to Russia). Provinces of one country are
//    grouped into a handful of game regions;
//  - populated places give population;
//  - mountain ranges and rivers give terrain.
//
// Run: npm run build:map
import fs from 'node:fs';
import { feature, merge } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { geoArea, geoCentroid, geoContains } from 'd3-geo';
import pc from 'polygon-clipping';

const ADMIN1_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson';
const ADMIN1_FILE = '.cache/ne_10m_admin_1.geojson';
const PLACES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places_simple.geojson';
const PLACES_FILE = '.cache/ne_10m_places.geojson';
const RANGES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_geography_regions_polys.geojson';
const RANGES_FILE = '.cache/ne_10m_geo_regions.geojson';
const RIVERS_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_rivers_lake_centerlines.geojson';
const RIVERS_FILE = '.cache/ne_10m_rivers.geojson';
// Share of border detail kept after simplification (smaller = lighter file).
const KEEP = Number(process.env.KEEP ?? 0.09);

// Natural Earth admin name -> game code. Microstates and small territories join
// the country around them so the map has no holes.
const PLAYABLE = {
  Portugal: 'PT', Spain: 'ES', Andorra: 'ES', Gibraltar: 'ES', France: 'FR', Monaco: 'FR',
  'United Kingdom': 'GB', Jersey: 'GB', Guernsey: 'GB', 'Isle of Man': 'GB', Ireland: 'IE',
  Belgium: 'BE', Netherlands: 'NL', Luxembourg: 'LU', Germany: 'DE', Switzerland: 'CH', Liechtenstein: 'CH',
  Austria: 'AT', Italy: 'IT', 'San Marino': 'IT', Vatican: 'IT', Denmark: 'DK', 'Faroe Islands': 'DK',
  Norway: 'NO', Sweden: 'SE', Finland: 'FI', Aland: 'FI',
  Iceland: 'IS', Poland: 'PL', 'Czech Republic': 'CZ', Slovakia: 'SK', Hungary: 'HU',
  Slovenia: 'SI', Croatia: 'HR', 'Bosnia and Herzegovina': 'BA', 'Republic of Serbia': 'RS', Montenegro: 'ME',
  Kosovo: 'XK', Macedonia: 'MK', Albania: 'AL', Greece: 'GR', Bulgaria: 'BG',
  Romania: 'RO', Moldova: 'MD', Ukraine: 'UA', Belarus: 'BY', Lithuania: 'LT',
  Latvia: 'LV', Estonia: 'EE', Russia: 'RU', Turkey: 'TR', Cyprus: 'CY',
  // the island is one country
  'Northern Cyprus': 'CY', 'Dhekelia Sovereign Base Area': 'CY', 'Akrotiri Sovereign Base Area': 'CY',
};

// Mountain ranges that slow attackers down (Natural Earth names).
const MOUNTAINS = new Set([
  'ALPS', 'PYRENEES', 'CARPATHIAN MOUNTAINS', 'Transylvanian Alps', 'Tatra Mts.', 'Dinaric Alps',
  'Balkan Mts.', 'Pindus Mts.', 'APPENNINI', 'KJØLEN MOUNTAINS', 'Hardanger-vidda', 'URAL MOUNTAINS',
  'Cord. Cantábrica', 'S. Nevada', 'Taurus Mts.', 'PONTIC MOUNTAINS', 'CAUCASUS MTS.', 'Grampian Mts.',
  'Jura', 'Böhmerwald', 'Sudetes Mts.',
]);
/** A region is mountainous when this share of it lies in a range. */
const MOUNTAIN_SHARE = Number(process.env.MSHARE ?? 0.4);
// Narrow border ranges cover little area but still block armies.
const RANGE_WEIGHT = { PYRENEES: 2.2, 'Cord. Cantábrica': 1.6, 'URAL MOUNTAINS': 1.4, 'Taurus Mts.': 1.5, 'PONTIC MOUNTAINS': 1.5 };
// Big rivers: attacking across one is harder. Natural Earth name -> game name.
const RIVERS = {
  Rhine: 'Рейн', Rhein: 'Рейн', Rhin: 'Рейн', Waal: 'Рейн', Danube: 'Дунай', Donau: 'Дунай',
  Dnipro: 'Днепр', Dnepre: 'Днепр', Vistula: 'Висла', Oder: 'Одер', Elbe: 'Эльба', Volga: 'Волга',
  Don: 'Дон', Dniester: 'Днестр', Daugava: 'Даугава', Po: 'По', Loire: 'Луара',
};

// How many regions each country gets. Missing = 1.
const REGION_COUNT = {
  RU: 24, DE: 10, FR: 12, GB: 9, IT: 10, ES: 10, TR: 10, PL: 8, UA: 10, SE: 7, NO: 6, FI: 6, RO: 7,
  BY: 5, GR: 5, BG: 4, HU: 4, AT: 4, CZ: 4, PT: 4, RS: 4, IE: 3, DK: 3, NL: 3, BE: 3, CH: 3,
  IS: 2, BA: 3, HR: 3, SK: 3, LT: 3, LV: 3, EE: 2, AL: 2, MK: 2, MD: 2, SI: 2, ME: 2, XK: 2,
};

// Capital cities, lon/lat. The region holding one is that country's capital region.
const CAPITALS = {
  PT: [-9.14, 38.72], ES: [-3.7, 40.42], FR: [2.35, 48.86], GB: [-0.13, 51.51], IE: [-6.26, 53.35],
  BE: [4.35, 50.85], NL: [4.9, 52.37], LU: [6.13, 49.61], DE: [13.4, 52.52], CH: [7.45, 46.95],
  AT: [16.37, 48.21], IT: [12.5, 41.9], DK: [12.57, 55.68], NO: [10.75, 59.91], SE: [18.07, 59.33],
  FI: [24.94, 60.17], IS: [-21.94, 64.15], PL: [21.01, 52.23], CZ: [14.42, 50.08], SK: [17.11, 48.15],
  HU: [19.04, 47.5], SI: [14.51, 46.06], HR: [15.98, 45.81], BA: [18.41, 43.86], RS: [20.46, 44.79],
  ME: [19.26, 42.44], XK: [21.17, 42.66], MK: [21.43, 42.0], AL: [19.82, 41.33], GR: [23.73, 37.98],
  BG: [23.32, 42.7], RO: [26.1, 44.43], MD: [28.86, 47.01], UA: [30.52, 50.45], BY: [27.56, 53.9],
  LT: [25.28, 54.69], LV: [24.11, 56.95], EE: [24.75, 59.44], RU: [37.62, 55.75], TR: [32.85, 39.93],
  CY: [33.36, 35.17],
};

// The capital region is named after the city.
const CAPITAL_NAMES = {
  PT: 'Лиссабон', ES: 'Мадрид', FR: 'Париж', GB: 'Лондон', IE: 'Дублин', BE: 'Брюссель', NL: 'Амстердам',
  LU: 'Люксембург', DE: 'Берлин', CH: 'Берн', AT: 'Вена', IT: 'Рим', DK: 'Копенгаген', NO: 'Осло',
  SE: 'Стокгольм', FI: 'Хельсинки', IS: 'Рейкьявик', PL: 'Варшава', CZ: 'Прага', SK: 'Братислава',
  HU: 'Будапешт', SI: 'Любляна', HR: 'Загреб', BA: 'Сараево', RS: 'Белград', ME: 'Подгорица',
  XK: 'Приштина', MK: 'Скопье', AL: 'Тирана', GR: 'Афины', BG: 'София', RO: 'Бухарест', MD: 'Кишинёв',
  UA: 'Киев', BY: 'Минск', LT: 'Вильнюс', LV: 'Рига', EE: 'Таллин', RU: 'Москва', TR: 'Анкара', CY: 'Никосия',
};

// Shorter or neutral names for a few regions.
const NAME_FIX = { 'Автономная Республика Крым': 'Крым', 'Ханты-Мансийский автономный округ — Югра': 'Югра' };

// Provinces that become a region of their own however small (exclaves).
const OWN_REGION = new Set(['Kaliningrad']);

// Data window in lon/lat. A bit wider than the view so cut edges stay off-screen.
const W = -32, E = 72, S = 26, N = 82;
const BOX = [[[W, S], [E, S], [E, N], [W, N], [W, S]]];
const EARTH_KM2 = 6371 * 6371;

// ---------- geometry helpers ----------

const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[i][0] - r[j][0]) * (r[i][1] + r[j][1]);
  return a / 2; // > 0 means clockwise with lat pointing up
};
// d3-geo wants clockwise outer rings and counter-clockwise holes.
const rewind = (mp) => mp.map((poly) => poly.map((ring, k) => ((k === 0) === (ringArea(ring) > 0) ? ring : [...ring].reverse())));

// Rings running past the date line jump from +180 to −180; on a flat plane that
// becomes a band across the map. Move their western points past +180 instead.
const wrapsDateLine = (poly) => {
  const lons = poly[0].map((p) => p[0]);
  return Math.max(...lons) - Math.min(...lons) > 180;
};
const unwrap = (poly) => poly.map((ring) => ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]));
const asMulti = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => (wrapsDateLine(p) ? unwrap(p) : p));
const clip = (g) => {
  const out = pc.intersection(asMulti(g), BOX);
  return out.length ? { type: 'MultiPolygon', coordinates: rewind(out) } : null;
};

// ---------- 1. provinces ----------

async function cached(url, file) {
  if (!fs.existsSync(file)) {
    console.log('downloading ' + file + '…');
    fs.mkdirSync('.cache', { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error('download failed: ' + res.status);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const admin1 = await cached(ADMIN1_URL, ADMIN1_FILE);
const places = await cached(PLACES_URL, PLACES_FILE);
const rangesSrc = await cached(RANGES_URL, RANGES_FILE);
const riversSrc = await cached(RIVERS_URL, RIVERS_FILE);

const provinces = []; // playable
const context = new Map(); // admin name -> geometries
for (const f of admin1.features) {
  const p = f.properties;
  const pt = [p.longitude, p.latitude];
  if (!f.geometry || pt[0] < W - 3 || pt[0] > E + 3 || pt[1] < S - 2) continue;
  const g = clip(f.geometry);
  if (!g) continue;
  const code = PLAYABLE[p.admin];
  if (code) {
    provinces.push({
      code, geometry: g, name: p.name_ru || p.name, en: p.name,
      area: geoArea(g) * EARTH_KM2, centroid: geoCentroid(g),
    });
  } else {
    const key = p.admin;
    if (!context.has(key)) context.set(key, []);
    context.get(key).push(g);
  }
}

// ---------- 2b. population ----------
// Towns over 15 000 people count in full; the countryside adds a little per km².
const bbox = (g) => {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const poly of g.coordinates) for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};
for (const p of provinces) { p.box = bbox(p.geometry); p.pop = p.area * 0.004; }
for (const f of places.features) {
  const q = f.properties;
  const pop = q.pop_max ?? 0;
  if (pop < 15000) continue;
  const pt = [q.longitude, q.latitude];
  if (pt[0] < W || pt[0] > E || pt[1] < S || pt[1] > N) continue;
  const home = provinces.find((p) => pt[0] >= p.box[0] && pt[0] <= p.box[2] && pt[1] >= p.box[1] && pt[1] <= p.box[3] && geoContains(p.geometry, pt));
  if (home) home.pop += pop / 1000;
}

// ---------- 3. group provinces into regions ----------

const dist = (a, b) => {
  const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]);
};

/** Area-weighted k-means on province centres, deterministic. */
function cluster(items, k) {
  if (k <= 1 || items.length <= 1) return items.map(() => 0);
  // start from the biggest provinces that are far apart
  const byArea = [...items].sort((a, b) => b.area - a.area);
  const centers = [byArea[0].centroid];
  while (centers.length < k) {
    let best = null, bestD = -1;
    for (const it of byArea) {
      const d = Math.min(...centers.map((c) => dist(c, it.centroid))) * Math.sqrt(it.area);
      if (d > bestD) { bestD = d; best = it; }
    }
    centers.push(best.centroid);
  }
  let assign = items.map(() => 0);
  for (let iter = 0; iter < 30; iter++) {
    assign = items.map((it) => centers.map((c, i) => [dist(c, it.centroid), i]).sort((a, b) => a[0] - b[0])[0][1]);
    for (let i = 0; i < k; i++) {
      const mine = items.filter((_, j) => assign[j] === i);
      if (!mine.length) continue;
      const w = mine.reduce((s, it) => s + it.area, 0);
      centers[i] = [mine.reduce((s, it) => s + it.centroid[0] * it.area, 0) / w, mine.reduce((s, it) => s + it.centroid[1] * it.area, 0) / w];
    }
  }
  return assign;
}

const regionOf = new Map(); // province -> region id
const regionMeta = new Map(); // region id -> { code, name, area, cap }
for (const code of new Set(provinces.map((p) => p.code))) {
  const mine = provinces.filter((p) => p.code === code);
  if (!mine.length) throw new Error('no provinces for ' + code);
  const own = mine.filter((p) => OWN_REGION.has(p.en));
  const rest = mine.filter((p) => !OWN_REGION.has(p.en));

  // far-away islands (Canaries, Azores…) join the nearest region instead of making their own
  const total = rest.reduce((s, p) => s + p.area, 0);
  const mean = [rest.reduce((s, p) => s + p.centroid[0] * p.area, 0) / total, rest.reduce((s, p) => s + p.centroid[1] * p.area, 0) / total];
  const ds = rest.map((p) => dist(p.centroid, mean)).sort((a, b) => a - b);
  const limit = Math.max(3, ds[Math.floor(ds.length * 0.5)] * 3);
  const core = rest.filter((p) => dist(p.centroid, mean) <= limit);
  const far = rest.filter((p) => dist(p.centroid, mean) > limit);

  const k = Math.min(REGION_COUNT[code] ?? 1, core.length);
  const assign = cluster(core, k);
  const groups = Array.from({ length: k }, () => []);
  core.forEach((p, i) => groups[assign[i]].push(p));
  for (const p of far) {
    let best = 0, bestD = Infinity;
    groups.forEach((g, i) => g.forEach((q) => { const d = dist(p.centroid, q.centroid); if (d < bestD) { bestD = d; best = i; } }));
    groups[best].push(p);
  }
  for (const p of own) groups.push([p]);

  groups.filter((g) => g.length).forEach((g, i) => {
    const id = `${code}-${i + 1}`;
    const biggest = [...g].sort((a, b) => b.pop - a.pop)[0];
    const cap = g.some((p) => geoContains(p.geometry, CAPITALS[code]));
    regionMeta.set(id, {
      code, name: NAME_FIX[biggest.name] ?? biggest.name, area: Math.round(g.reduce((s, p) => s + p.area, 0)),
      pop: Math.round(g.reduce((s, p) => s + p.pop, 0)), cap,
    });
    for (const p of g) regionOf.set(p, id);
  });
  // the capital region takes its name from the province the capital is in
  let capProv = mine.find((p) => geoContains(p.geometry, CAPITALS[code]));
  if (!capProv) capProv = [...mine].sort((a, b) => dist(a.centroid, CAPITALS[code]) - dist(b.centroid, CAPITALS[code]))[0];
  for (const [id, m] of regionMeta) if (m.code === code) m.cap = id === regionOf.get(capProv);
  regionMeta.get(regionOf.get(capProv)).name = CAPITAL_NAMES[code];
}

// ---------- 3b. terrain ----------
const ranges = rangesSrc.features
  .filter((f) => f.properties.FEATURECLA === 'Range/mtn' && MOUNTAINS.has(f.properties.NAME))
  .map((f) => ({ g: clip(f.geometry), w: RANGE_WEIGHT[f.properties.NAME] ?? 1 })).filter((r) => r.g)
  .map((r) => ({ ...r, box: bbox(r.g) }));
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const mountainArea = new Map();
for (const p of provinces) {
  let km2 = 0;
  for (const r of ranges) {
    if (!overlaps(p.box, r.box)) continue;
    const cut = pc.intersection(p.geometry.coordinates, r.g.coordinates);
    if (cut.length) km2 += r.w * geoArea({ type: 'MultiPolygon', coordinates: rewind(cut) }) * EARTH_KM2;
  }
  const id = regionOf.get(p);
  mountainArea.set(id, (mountainArea.get(id) ?? 0) + Math.min(km2, p.area));
}
for (const [id, m] of regionMeta) { m.share = (mountainArea.get(id) ?? 0) / Math.max(1, m.area); m.mountain = m.share >= MOUNTAIN_SHARE; }
if (process.env.MSHARE) console.log([...regionMeta.values()].filter((m) => m.share > 0.2).sort((a, b) => b.share - a.share).map((m) => m.code + ':' + m.name + ' ' + m.share.toFixed(2)).join(', '));

// river lines, cut to the map and thinned for drawing
const thin = (line, tol) => {
  if (line.length < 3) return line;
  const keep = [line[0]];
  for (const pt of line.slice(1, -1)) if (dist(pt, keep[keep.length - 1]) >= tol) keep.push(pt);
  keep.push(line[line.length - 1]);
  return keep;
};
const riverLines = [];
for (const f of riversSrc.features) {
  const name = RIVERS[f.properties.name];
  if (!name || !f.geometry) continue;
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const l of lines) {
    const inside = l.filter(([x, y]) => x > W && x < E && y > S && y < N);
    if (inside.length < 2) continue;
    riverLines.push({ name, line: thin(inside, 0.06).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]) });
  }
}

// ---------- 4. merge into one topology and simplify ----------

const raw = [
  ...provinces.map((p) => ({ type: 'Feature', properties: { r: regionOf.get(p) }, geometry: p.geometry })),
  ...[...context].flatMap(([name, gs]) => gs.map((g) => ({ type: 'Feature', properties: { x: name }, geometry: g }))),
];
const t1 = topology({ p: { type: 'FeatureCollection', features: raw } }, 1e6);
const geoms = t1.objects.p.geometries;
const merged = [];
for (const [id, m] of regionMeta) {
  const geometry = merge(t1, geoms.filter((g) => g.properties.r === id));
  merged.push({ type: 'Feature', id, properties: { c: m.code, n: m.name, a: m.area, pop: m.pop, ...(m.mountain ? { m: 1 } : {}), ...(m.cap ? { cap: 1, p: CAPITALS[m.code] } : {}) }, geometry });
}
let xi = 0;
for (const name of context.keys()) {
  const geometry = merge(t1, geoms.filter((g) => g.properties.x === name));
  merged.push({ type: 'Feature', id: 'x' + xi++, properties: { name }, geometry });
}

let topo = topology({ land: { type: 'FeatureCollection', features: merged } }, 1e5);
topo = presimplify(topo);
topo = simplify(topo, quantile(topo, KEEP));
// drop weights left by presimplify to keep the file small
for (const arc of topo.arcs) for (const pt of arc) pt.length = 2;

// ---------- 5. coasts: which sea zones each region touches ----------
// Zone centres come from src/data/seas.ts so they are defined in one place.
const seaSrc = fs.readFileSync('src/data/seas.ts', 'utf8');
const ZONES = [...seaSrc.matchAll(/id: '(\w+)'.*?center: \[([-\d.]+), ([-\d.]+)\]/g)].map((m) => ({ id: m[1], c: [Number(m[2]), Number(m[3])] }));
const arcIdx = (i) => (i < 0 ? ~i : i);
const arcsOf = (g) => (g.type === 'Polygon' ? g.arcs.flat() : g.type === 'MultiPolygon' ? g.arcs.flat(2) : []).map(arcIdx);
const used = new Map();
for (const g of topo.objects.land.geometries) for (const a of arcsOf(g)) used.set(a, (used.get(a) ?? 0) + 1);
const onBox = ([x, y]) => Math.abs(x - W) < 0.01 || Math.abs(x - E) < 0.01 || Math.abs(y - S) < 0.01 || Math.abs(y - N) < 0.01;
for (const g of topo.objects.land.geometries) {
  if (!g.properties.c) continue;
  const hits = new Map();
  let total = 0;
  for (const a of arcsOf(g)) {
    if (used.get(a) !== 1) continue; // shared with another region = land border
    const line = feature(topo, { type: 'LineString', arcs: [a] }).geometry.coordinates;
    for (let k = 0; k < line.length; k += 2) {
      const p = line[k];
      if (onBox(p)) continue;
      let best = null, bestD = 9;
      for (const z of ZONES) { const d = dist(p, z.c); if (d < bestD) { bestD = d; best = z.id; } }
      if (best) { hits.set(best, (hits.get(best) ?? 0) + 1); total++; }
    }
  }
  // a zone counts if a fair share of the coastline faces it
  const zones = [...hits].filter(([, n]) => n >= 3 && n >= total * 0.08).sort((a, b) => b[1] - a[1]).map(([z]) => z);
  if (zones.length) g.properties.z = zones;
}

// ---------- 6. river crossings ----------
// Two neighbours are split by a river when the line between their centres crosses it.
const regionGeoms = topo.objects.land.geometries.filter((g) => g.properties.c);
const centreOf = new Map();
for (const g of regionGeoms) {
  const f = feature(topo, g);
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const big = polys.reduce((a, q) => (geoArea({ type: 'Polygon', coordinates: q }) > geoArea({ type: 'Polygon', coordinates: a }) ? q : a));
  centreOf.set(g.id, geoCentroid({ type: 'Polygon', coordinates: big }));
}
const arcOwners = new Map();
for (const g of regionGeoms) for (const a of arcsOf(g)) { if (!arcOwners.has(a)) arcOwners.set(a, new Set()); arcOwners.get(a).add(g.id); }
const landPairs = new Set();
for (const owners of arcOwners.values()) {
  const ids = [...owners].sort();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) landPairs.add(ids[i] + '|' + ids[j]);
}
const crosses = (p1, p2, q1, q2) => {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return d(p1, p2, q1) * d(p1, p2, q2) < 0 && d(q1, q2, p1) * d(q1, q2, p2) < 0;
};
const riverBetween = (a, b) => {
  for (const r of riverLines) for (let k = 1; k < r.line.length; k++) if (crosses(a, b, r.line[k - 1], r.line[k])) return r.name;
  return null;
};
const byId = new Map(regionGeoms.map((g) => [g.id, g]));
let crossings = 0;
for (const key of landPairs) {
  const [a, b] = key.split('|');
  const river = riverBetween(centreOf.get(a), centreOf.get(b));
  if (!river) continue;
  crossings++;
  for (const [x, y] of [[a, b], [b, a]]) {
    const props = byId.get(x).properties;
    props.rv = props.rv ?? {};
    props.rv[y] = river;
  }
}
topo.rivers = riverLines;

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/europe.json', JSON.stringify(topo));
const mountainous = [...regionMeta.values()].filter((m) => m.mountain);
console.log(`mountain regions ${mountainous.length}, river crossings ${crossings}, river lines ${riverLines.length}`);
console.log('mountains: ' + mountainous.map((m) => m.code + ':' + m.name).join(', '));
const perCountry = {};
for (const m of regionMeta.values()) perCountry[m.code] = (perCountry[m.code] ?? 0) + 1;
console.log(`regions ${regionMeta.size}, context ${context.size}, ${(JSON.stringify(topo).length / 1024).toFixed(0)} KB`);
console.log(Object.entries(perCountry).map(([c, n]) => c + n).join(' '));
console.log([...regionMeta].filter(([, m]) => m.cap).map(([id, m]) => `${id}:${m.name}`).join(', '));
