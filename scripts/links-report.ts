// Lists sea crossings and regions nobody can reach. Run: npx tsx scripts/links-report.ts
import { feature, neighbors } from 'topojson-client';
import { geoArea, geoCentroid } from 'd3-geo';
import europe from '../src/data/europe.json';
import { REGION, REGIONS } from '../src/data/regions';
import { buildGraph, land, sea, seaPairs } from '../src/game/graph';

type Topo = { objects: { land: { geometries: { id: string }[] } } };
const geoms = (europe as unknown as Topo).objects.land.geometries;
const nb = neighbors(geoms as never);
const pairs: [string, string][] = [];
geoms.forEach((g, i) => {
  if (!REGION[g.id]) return;
  for (const j of nb[i]) if (REGION[geoms[j].id] && g.id < geoms[j].id) pairs.push([g.id, geoms[j].id]);
});
const centre = new Map<string, [number, number]>();
for (const f of (feature(europe as never, (europe as never as Topo).objects.land as never) as unknown as { features: { id: string; geometry: { type: string; coordinates: never } }[] }).features) {
  if (!REGION[f.id]) continue;
  const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
  const best = polys.reduce((a, p) => (geoArea({ type: 'Polygon', coordinates: p } as never) > geoArea({ type: 'Polygon', coordinates: a } as never) ? p : a));
  centre.set(f.id, geoCentroid({ type: 'Polygon', coordinates: best } as never) as [number, number]);
}
buildGraph(pairs, (id) => centre.get(id)!);
console.log('sea crossings', seaPairs.length);
const name = (id: string) => `${REGION[id].c}:${REGION[id].name}`;
for (const id of (process.argv[2] ?? '').split(',').filter(Boolean)) {
  console.log(name(id), '→', [...(sea.get(id)?.keys() ?? [])].map(name).join(', '));
}
const stuck = REGIONS.filter((r) => !(land.get(r.id)?.size) && !(sea.get(r.id)?.size));
console.log('unreachable', stuck.map((r) => name(r.id)).join(', ') || 'none');
// islands of interest
for (const want of ['Корсика', 'Кальяри', 'Балеар', 'Копенгаген', 'Крит', 'Палермо', 'Кипр', 'Рейкьявик', 'Никосия']) {
  const r = REGIONS.find((x) => x.name.includes(want));
  if (r) console.log(name(r.id), 'by sea →', [...(sea.get(r.id)?.keys() ?? [])].map(name).join(', '), '| by land:', land.get(r.id)?.size ?? 0);
}
// groups of regions cut off from the rest of the map
const seen = new Set<string>();
const groups: string[][] = [];
for (const r of REGIONS) {
  if (seen.has(r.id)) continue;
  const group: string[] = [];
  const queue = [r.id];
  seen.add(r.id);
  while (queue.length) {
    const id = queue.pop()!;
    group.push(id);
    for (const n of [...(land.get(id) ?? []), ...(sea.get(id)?.keys() ?? [])]) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  groups.push(group);
}
groups.sort((a, b) => b.length - a.length);
console.log('main group', groups[0].length, '| cut off:', groups.slice(1).map((g) => g.map(name).join('+')).join('; ') || 'none');
