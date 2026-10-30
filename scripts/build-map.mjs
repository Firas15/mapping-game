// Builds src/data/europe.json: playable countries split into regions, plus
// neighbouring land for context.
//
// Sources (both Natural Earth):
//  - world-atlas 1:50m countries decide which country owns which piece of land
//    (so disputed areas follow that dataset, e.g. Crimea belongs to Russia);
//  - 1:10m admin-1 provinces give the inner borders. Provinces of one country
//    are grouped into a handful of game regions.
//
// Run: npm run build:map   (downloads the provinces file once into .cache/)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { feature, merge } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { geoArea, geoCentroid, geoContains } from 'd3-geo';
import pc from 'polygon-clipping';

const require = createRequire(import.meta.url);
const world = require('world-atlas/countries-50m.json');

const ADMIN1_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson';
const ADMIN1_FILE = '.cache/ne_10m_admin_1.geojson';
// Share of border detail kept after simplification (smaller = lighter file).
const KEEP = Number(process.env.KEEP ?? 0.09);

// Natural Earth country name -> game code
const PLAYABLE = {
  Portugal: 'PT', Spain: 'ES', France: 'FR', 'United Kingdom': 'GB', Ireland: 'IE',
  Belgium: 'BE', Netherlands: 'NL', Luxembourg: 'LU', Germany: 'DE', Switzerland: 'CH',
  Austria: 'AT', Italy: 'IT', Denmark: 'DK', Norway: 'NO', Sweden: 'SE', Finland: 'FI',
  Iceland: 'IS', Poland: 'PL', Czechia: 'CZ', Slovakia: 'SK', Hungary: 'HU',
  Slovenia: 'SI', Croatia: 'HR', 'Bosnia and Herz.': 'BA', Serbia: 'RS', Montenegro: 'ME',
  Kosovo: 'XK', Macedonia: 'MK', Albania: 'AL', Greece: 'GR', Bulgaria: 'BG',
  Romania: 'RO', Moldova: 'MD', Ukraine: 'UA', Belarus: 'BY', Lithuania: 'LT',
  Latvia: 'LV', Estonia: 'EE', Russia: 'RU', Turkey: 'TR', Cyprus: 'CY',
  'N. Cyprus': 'CY', // the island is one country
};

// How many regions each country gets. Missing = 1.
const REGION_COUNT = {
  RU: 8, DE: 6, FR: 7, GB: 5, IT: 6, ES: 6, TR: 6, PL: 5, UA: 6, SE: 4, NO: 4, FI: 4, RO: 4,
  BY: 3, GR: 3, BG: 3, HU: 3, AT: 3, CZ: 3, PT: 3, RS: 3, IE: 2, DK: 2, NL: 2, BE: 2, CH: 2,
  IS: 2, BA: 2, HR: 2, SK: 2, LT: 2, LV: 2, EE: 2, AL: 2, MK: 2, MD: 2,
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

// ---------- 1. country shapes decide ownership ----------

const countryShape = new Map();
for (const f of feature(world, world.objects.countries).features) {
  const code = PLAYABLE[f.properties.name];
  if (!code || !f.geometry) continue;
  const g = clip(f.geometry);
  if (!g) continue;
  const prev = countryShape.get(code);
  countryShape.set(code, prev ? { type: 'MultiPolygon', coordinates: rewind(pc.union(prev.coordinates, g.coordinates)) } : g);
}

// ---------- 2. provinces ----------

if (!fs.existsSync(ADMIN1_FILE)) {
  console.log('downloading provinces…');
  fs.mkdirSync('.cache', { recursive: true });
  const res = await fetch(ADMIN1_URL);
  if (!res.ok) throw new Error('download failed: ' + res.status);
  fs.writeFileSync(ADMIN1_FILE, Buffer.from(await res.arrayBuffer()));
}
const admin1 = JSON.parse(fs.readFileSync(ADMIN1_FILE, 'utf8'));

const provinces = []; // playable
const context = new Map(); // admin name -> geometries
for (const f of admin1.features) {
  const p = f.properties;
  const pt = [p.longitude, p.latitude];
  if (!f.geometry || pt[0] < W - 3 || pt[0] > E + 3 || pt[1] < S - 2) continue;
  const g = clip(f.geometry);
  if (!g) continue;
  let code = null;
  for (const [c, shape] of countryShape) if (geoContains(shape, pt)) { code = c; break; }
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
for (const code of countryShape.keys()) {
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
    const biggest = [...g].sort((a, b) => b.area - a.area)[0];
    const cap = g.some((p) => geoContains(p.geometry, CAPITALS[code]));
    regionMeta.set(id, { code, name: biggest.name, area: Math.round(g.reduce((s, p) => s + p.area, 0)), cap });
    for (const p of g) regionOf.set(p, id);
  });
  // the capital region takes its name from the province the capital is in
  let capProv = mine.find((p) => geoContains(p.geometry, CAPITALS[code]));
  if (!capProv) capProv = [...mine].sort((a, b) => dist(a.centroid, CAPITALS[code]) - dist(b.centroid, CAPITALS[code]))[0];
  for (const [id, m] of regionMeta) if (m.code === code) m.cap = id === regionOf.get(capProv);
  regionMeta.get(regionOf.get(capProv)).name = CAPITAL_NAMES[code];
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
  merged.push({ type: 'Feature', id, properties: { c: m.code, n: m.name, a: m.area, ...(m.cap ? { cap: 1, p: CAPITALS[m.code] } : {}) }, geometry });
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

fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync('src/data/europe.json', JSON.stringify(topo));
const perCountry = {};
for (const m of regionMeta.values()) perCountry[m.code] = (perCountry[m.code] ?? 0) + 1;
console.log(`regions ${regionMeta.size}, context ${context.size}, ${(JSON.stringify(topo).length / 1024).toFixed(0)} KB`);
console.log(Object.entries(perCountry).map(([c, n]) => c + n).join(' '));
console.log([...regionMeta].filter(([, m]) => m.cap).map(([id, m]) => `${id}:${m.name}`).join(', '));
