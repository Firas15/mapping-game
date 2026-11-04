import { SEA_LINKS } from '../data/countries';
import { REGION, REGIONS } from '../data/regions';
import { SEA, SEAS } from '../data/seas';

/** Which regions border which. Filled once from the map topology. */
export const land = new Map<string, Set<string>>();
/** Sea crossings: region -> (region -> sea zone it passes through). */
export const sea = new Map<string, Map<string, string>>();
/** Sea crossings for drawing. */
export const seaPairs: { a: string; b: string; zone: string }[] = [];

const linkLand = (a: string, b: string) => {
  if (!land.has(a)) land.set(a, new Set());
  if (!land.has(b)) land.set(b, new Set());
  land.get(a)!.add(b);
  land.get(b)!.add(a);
};
const linkSea = (a: string, b: string, zone: string) => {
  if (!sea.has(a)) sea.set(a, new Map());
  if (!sea.has(b)) sea.set(b, new Map());
  sea.get(a)!.set(b, zone);
  sea.get(b)!.set(a, zone);
};

const dist = (p: [number, number], q: [number, number]) =>
  Math.hypot((p[0] - q[0]) * Math.cos(((p[1] + q[1]) / 2) * Math.PI / 180), p[1] - q[1]);

/**
 * Land borders come from the map. Each sea link between two countries joins
 * their two closest coastal regions through the sea zone they share.
 */
export function buildGraph(pairs: [string, string][], centroid: (id: string) => [number, number]) {
  land.clear();
  sea.clear();
  seaPairs.length = 0;
  for (const [a, b] of pairs) linkLand(a, b);
  for (const [ca, cb] of SEA_LINKS) {
    let best: [string, string] | null = null;
    let bestD = Infinity;
    const coastal = (c: string) => REGIONS.filter((r) => r.c === c && r.coast.length);
    for (const ra of coastal(ca)) {
      for (const rb of coastal(cb)) {
        const d = dist(centroid(ra.id), centroid(rb.id)) - (ra.coast.some((z) => rb.coast.includes(z)) ? 3 : 0);
        if (d < bestD) { bestD = d; best = [ra.id, rb.id]; }
      }
    }
    if (!best || land.get(best[0])?.has(best[1])) continue;
    const [a, b] = best;
    const shared = REGION[a].coast.filter((z) => REGION[b].coast.includes(z));
    const mid: [number, number] = [(centroid(a)[0] + centroid(b)[0]) / 2, (centroid(a)[1] + centroid(b)[1]) / 2];
    const pool = shared.length ? shared.map((z) => SEA[z]) : SEAS;
    const zone = [...pool].sort((x, y) => dist(x.center, mid) - dist(y.center, mid))[0].id;
    linkSea(a, b, zone);
    seaPairs.push({ a, b, zone });
  }
  autoCrossings(centroid);
}

/** Crossings between close shores of one sea, so islands and straits can be landed on. */
const NEAR = 3.4;
const MAX_AUTO = 4;
function autoCrossings(centroid: (id: string) => [number, number]) {
  const coastal = REGIONS.filter((r) => r.coast.length);
  const added = new Map<string, number>();
  const tryLink = (a: string, b: string, zone: string) => {
    if (a === b || land.get(a)?.has(b) || sea.get(a)?.has(b)) return false;
    linkSea(a, b, zone);
    seaPairs.push({ a, b, zone });
    added.set(a, (added.get(a) ?? 0) + 1);
    added.set(b, (added.get(b) ?? 0) + 1);
    return true;
  };
  // every pair of close shores facing the same sea
  const pairs: { a: string; b: string; zone: string; d: number }[] = [];
  for (let i = 0; i < coastal.length; i++) {
    for (let j = i + 1; j < coastal.length; j++) {
      const ra = coastal[i];
      const rb = coastal[j];
      const zone = ra.coast.find((z) => rb.coast.includes(z));
      if (!zone) continue;
      const d = dist(centroid(ra.id), centroid(rb.id));
      pairs.push({ a: ra.id, b: rb.id, zone, d });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  for (const p of pairs) {
    if (p.d > NEAR) break;
    if ((added.get(p.a) ?? 0) >= MAX_AUTO || (added.get(p.b) ?? 0) >= MAX_AUTO) continue;
    tryLink(p.a, p.b, p.zone);
  }
  // islands and exclaves cut off from their own country get a crossing to its nearest shore
  for (const r of coastal) {
    if ([...(land.get(r.id) ?? [])].some((n) => REGION[n].c === r.c)) continue;
    if ([...(sea.get(r.id)?.keys() ?? [])].some((n) => REGION[n].c === r.c)) continue;
    const here = centroid(r.id);
    const mates = coastal.filter((x) => x.c === r.c && x.id !== r.id)
      .sort((x, y) => dist(centroid(x.id), here) - dist(centroid(y.id), here));
    if (!mates.length) continue;
    const zone = r.coast.find((z) => mates[0].coast.includes(z)) ?? r.coast[0];
    tryLink(r.id, mates[0].id, zone);
  }
  // an island with no way in or out gets its nearest shore, however far
  for (const r of coastal) {
    if ((land.get(r.id)?.size ?? 0) > 0 || (sea.get(r.id)?.size ?? 0) > 0) continue;
    const near = pairs.filter((p) => p.a === r.id || p.b === r.id).slice(0, 2);
    for (const p of near) tryLink(p.a, p.b, p.zone);
  }
}

/** All regions one step away, by land or by sea. */
export const neighbours = (r: string) => [...(land.get(r) ?? []), ...(sea.get(r)?.keys() ?? [])];
