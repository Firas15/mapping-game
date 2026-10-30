import { SEA_LINKS } from '../data/countries';

/** Who borders whom. Filled once from the map topology. */
export const land = new Map<string, Set<string>>();
export const sea = new Map<string, Set<string>>();

const link = (m: Map<string, Set<string>>, a: string, b: string) => {
  if (!m.has(a)) m.set(a, new Set());
  if (!m.has(b)) m.set(b, new Set());
  m.get(a)!.add(b);
  m.get(b)!.add(a);
};

export function buildGraph(pairs: [string, string][]) {
  for (const [a, b] of pairs) link(land, a, b);
  for (const [a, b] of SEA_LINKS) if (!land.get(a)?.has(b)) link(sea, a, b);
}
