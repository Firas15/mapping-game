import { SEA_LINKS } from '../data/countries';
import { REGIONS } from '../data/regions';

/** Which regions border which. Filled once from the map topology. */
export const land = new Map<string, Set<string>>();
export const sea = new Map<string, Set<string>>();
/** Region pairs joined by sea, for drawing. */
export const seaPairs: [string, string][] = [];

const link = (m: Map<string, Set<string>>, a: string, b: string) => {
  if (!m.has(a)) m.set(a, new Set());
  if (!m.has(b)) m.set(b, new Set());
  m.get(a)!.add(b);
  m.get(b)!.add(a);
};

/**
 * Land borders come from the map. Each sea link between two countries joins
 * their two closest regions.
 */
export function buildGraph(pairs: [string, string][], centroid: (id: string) => [number, number]) {
  for (const [a, b] of pairs) link(land, a, b);
  const d = (p: [number, number], q: [number, number]) =>
    Math.hypot((p[0] - q[0]) * Math.cos(((p[1] + q[1]) / 2) * Math.PI / 180), p[1] - q[1]);
  for (const [ca, cb] of SEA_LINKS) {
    let best: [string, string] | null = null;
    let bestD = Infinity;
    for (const ra of REGIONS.filter((r) => r.c === ca)) {
      for (const rb of REGIONS.filter((r) => r.c === cb)) {
        const dist = d(centroid(ra.id), centroid(rb.id));
        if (dist < bestD) { bestD = dist; best = [ra.id, rb.id]; }
      }
    }
    if (best && !land.get(best[0])?.has(best[1])) {
      link(sea, best[0], best[1]);
      seaPairs.push(best);
    }
  }
}
