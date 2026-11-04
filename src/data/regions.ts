import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import europe from './europe.json';
import { COUNTRY } from './countries';

export interface RegionDef {
  id: string;
  /** country it belongs to from the start */
  c: string;
  name: string;
  /** km² */
  area: number;
  capital: boolean;
  /** capital city, lon/lat (capital regions only) */
  point?: [number, number];
  /** what holding it gives */
  kind: RegionKind;
  /** money per turn */
  eco: number;
  /** soldiers per turn */
  men: number;
}

/**
 * industry: money only (more of it); manpower: soldiers, little money;
 * hub: both. Capitals are always hubs.
 */
export type RegionKind = 'industry' | 'manpower' | 'hub';

export const KIND_INFO: Record<RegionKind, { name: string; text: string }> = {
  industry: { name: 'Промышленная область', text: 'Даёт много денег' },
  manpower: { name: 'Призывная область', text: 'Даёт солдат каждый ход' },
  hub: { name: 'Крупный центр', text: 'Даёт и деньги, и солдат' },
};

/** How much of the country's money and soldiers each kind attracts. */
const ECO_WEIGHT: Record<RegionKind, number> = { industry: 1.4, hub: 1, manpower: 0 };
const MEN_WEIGHT: Record<RegionKind, number> = { industry: 0, hub: 0.6, manpower: 1 };
/** Soldiers a whole country raises per turn, as a share of its starting army. */
const MEN_SHARE = 0.07;

/** Small stable hash so a region keeps its kind from game to game. */
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const CYCLE: RegionKind[] = ['industry', 'hub', 'industry', 'manpower', 'industry'];

interface Props { c?: string; n?: string; a?: number; cap?: number; p?: [number, number] }

const topo = europe as unknown as Topology<{ land: GeometryCollection<Props> }>;
const raw = (feature(topo, topo.objects.land) as unknown as { features: { id: string; properties: Props }[] }).features
  .filter((f) => f.properties.c && COUNTRY[f.properties.c]);

export const REGIONS: RegionDef[] = [];
const byCountry = new Map<string, typeof raw>();
for (const f of raw) {
  const list = byCountry.get(f.properties.c!) ?? [];
  list.push(f);
  byCountry.set(f.properties.c!, list);
}

for (const [c, list] of byCountry) {
  // Kinds: the capital is a hub, the biggest other region raises soldiers,
  // the rest follow a mix that differs from country to country.
  const kinds = new Map<string, RegionKind>();
  const others = list.filter((f) => !f.properties.cap).sort((a, b) => (b.properties.a ?? 0) - (a.properties.a ?? 0));
  const shift = hash(c) % CYCLE.length;
  others.forEach((f, i) => kinds.set(f.id, i === 0 ? 'manpower' : CYCLE[(i - 1 + shift) % CYCLE.length]));
  for (const f of list) if (f.properties.cap) kinds.set(f.id, 'hub');

  // Money and soldiers are split by size (half) and evenly (half), weighted by kind;
  // the capital counts double. Country totals stay the same as before.
  const total = list.reduce((s, f) => s + (f.properties.a ?? 0), 0) || 1;
  const size = (f: (typeof list)[number]) =>
    (0.5 * (f.properties.a ?? 0) / total + 0.5 / list.length) * (f.properties.cap ? 2 : 1);
  const split = (amount: number, w: Record<RegionKind, number>, min: number) => {
    const weights = list.map((f) => size(f) * w[kinds.get(f.id)!]);
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    return weights.map((x) => (x > 0 ? Math.max(min, Math.round((amount * x) / sum)) : 0));
  };
  const eco = split(COUNTRY[c].eco, ECO_WEIGHT, 1);
  const men = split(Math.max(1, Math.round(COUNTRY[c].army * MEN_SHARE)), MEN_WEIGHT, 1);
  list.forEach((f, i) => {
    REGIONS.push({
      id: f.id, c, name: f.properties.n ?? COUNTRY[c].name, area: f.properties.a ?? 0,
      capital: !!f.properties.cap, point: f.properties.p, kind: kinds.get(f.id)!, eco: eco[i], men: men[i],
    });
  });
}

export const REGION: Record<string, RegionDef> = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
export const regionsOf = (c: string) => REGIONS.filter((r) => r.c === c);
export const CAPITAL: Record<string, string> = Object.fromEntries(REGIONS.filter((r) => r.capital).map((r) => [r.c, r.id]));

/** "Бавария (Германия)", or just the country for one-region countries. */
export function regionTitle(id: string) {
  const r = REGION[id];
  return regionsOf(r.c).length === 1 ? COUNTRY[r.c].name : r.name;
}
