// Builds src/data/europe.json from Natural Earth (world-atlas, 1:50m).
// Keeps everything inside the game window, clips the rest (Siberia, overseas
// territories) and tags playable countries with a short code.
// Run: npm run build:map
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import { topology } from 'topojson-server';
import pc from 'polygon-clipping';

const require = createRequire(import.meta.url);
const world = require('world-atlas/countries-50m.json');

// Natural Earth name -> game code
const PLAYABLE = {
  Portugal: 'PT', Spain: 'ES', France: 'FR', 'United Kingdom': 'GB', Ireland: 'IE',
  Belgium: 'BE', Netherlands: 'NL', Luxembourg: 'LU', Germany: 'DE', Switzerland: 'CH',
  Austria: 'AT', Italy: 'IT', Denmark: 'DK', Norway: 'NO', Sweden: 'SE', Finland: 'FI',
  Iceland: 'IS', Poland: 'PL', Czechia: 'CZ', Slovakia: 'SK', Hungary: 'HU',
  Slovenia: 'SI', Croatia: 'HR', 'Bosnia and Herz.': 'BA', Serbia: 'RS', Montenegro: 'ME',
  Kosovo: 'XK', Macedonia: 'MK', Albania: 'AL', Greece: 'GR', Bulgaria: 'BG',
  Romania: 'RO', Moldova: 'MD', Ukraine: 'UA', Belarus: 'BY', Lithuania: 'LT',
  Latvia: 'LV', Estonia: 'EE', Russia: 'RU', Turkey: 'TR', Cyprus: 'CY',
  'N. Cyprus': 'CY', // the island is one cell
};

// Data window in lon/lat. A bit wider than the view so cut edges stay off-screen.
const W = -32, E = 72, S = 26, N = 82;
const BOX = [[[W, S], [E, S], [E, N], [W, N], [W, S]]];

const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[i][0] - r[j][0]) * (r[i][1] + r[j][1]);
  return a / 2; // > 0 means clockwise with lat pointing up
};
// d3-geo wants clockwise outer rings and counter-clockwise holes.
const rewind = (mp) =>
  mp.map((poly) =>
    poly.map((ring, k) => {
      const cw = ringArea(ring) > 0;
      return (k === 0) === cw ? ring : [...ring].reverse();
    }),
  );

// Rings that run past the date line (mainland Russia through Chukotka) jump from
// +180 to −180. On a flat plane that turns into a band across the whole map, so
// move their western-hemisphere points past +180; the clip box then cuts them off.
const wrapsDateLine = (poly) => {
  const lons = poly[0].map((p) => p[0]);
  return Math.max(...lons) - Math.min(...lons) > 180;
};
const unwrap = (poly) => poly.map((ring) => ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]));
const asMulti = (g) =>
  (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => (wrapsDateLine(p) ? unwrap(p) : p));

const byCode = new Map();
const context = [];
for (const f of feature(world, world.objects.countries).features) {
  if (!f.geometry) continue;
  const name = f.properties.name;
  const clipped = pc.intersection(asMulti(f.geometry), BOX);
  if (!clipped.length) continue;
  const coords = rewind(clipped);
  const code = PLAYABLE[name];
  if (code) {
    const prev = byCode.get(code);
    if (prev) {
      // merge pieces that belong to one cell (Cyprus), then fix winding again
      prev.coordinates = rewind(pc.union(prev.coordinates, coords));
    } else byCode.set(code, { type: 'MultiPolygon', coordinates: coords });
  } else {
    context.push({ type: 'Feature', id: 'x' + context.length, properties: { name }, geometry: { type: 'MultiPolygon', coordinates: coords } });
  }
}

const missing = [...new Set(Object.values(PLAYABLE))].filter((c) => !byCode.has(c));
if (missing.length) throw new Error('Missing countries: ' + missing.join(', '));

const playable = [...byCode].map(([code, geometry]) => ({ type: 'Feature', id: code, properties: {}, geometry }));
const topo = topology({ land: { type: 'FeatureCollection', features: [...playable, ...context] } }, 1e5);

fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync('src/data/europe.json', JSON.stringify(topo));
console.log(`playable ${playable.length}, context ${context.length}, ${(JSON.stringify(topo).length / 1024).toFixed(0)} KB`);
