import { feature } from 'topojson-client';
import { type RegionProps, europe } from './map';
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
  /** people, thousands */
  pop: number;
  /** sea zones it touches; empty for inland regions */
  coast: string[];
  /** mountains: defenders fight better */
  mountain: boolean;
  /** neighbour -> big river between them */
  rivers: Record<string, string>;
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

const raw = (feature(europe, europe.objects.land) as unknown as { features: { id: string; properties: RegionProps }[] }).features
  .filter((f) => f.properties.c && COUNTRY[f.properties.c]);

export const REGIONS: RegionDef[] = [];
const byCountry = new Map<string, typeof raw>();
for (const f of raw) {
  const list = byCountry.get(f.properties.c!) ?? [];
  list.push(f);
  byCountry.set(f.properties.c!, list);
}

for (const [c, list] of byCountry) {
  // Kinds follow where people live: the capital and the most populous regions are
  // hubs, dense regions are industrial, thinly peopled ones send soldiers.
  const pop = (f: (typeof list)[number]) => Math.max(1, f.properties.pop ?? 1);
  const density = (f: (typeof list)[number]) => pop(f) / Math.max(1, f.properties.a ?? 1);
  const kinds = new Map<string, RegionKind>();
  const others = list.filter((f) => !f.properties.cap).sort((a, b) => pop(b) - pop(a));
  const hubs = Math.floor(others.length / 4);
  const dens = others.slice(hubs).map(density).sort((a, b) => a - b);
  const median = dens[Math.floor(dens.length / 2)] ?? 0;
  others.forEach((f, i) => kinds.set(f.id, i < hubs ? 'hub' : density(f) >= median ? 'industry' : 'manpower'));
  for (const f of list) if (f.properties.cap) kinds.set(f.id, 'hub');
  // bigger countries always get at least one of each
  if (others.length >= 2) {
    const rest = others.slice(hubs);
    if (!rest.some((f) => kinds.get(f.id) === 'manpower') && rest.length) kinds.set([...rest].sort((a, b) => density(a) - density(b))[0].id, 'manpower');
    if (!rest.some((f) => kinds.get(f.id) === 'industry') && rest.length > 1) kinds.set([...rest].sort((a, b) => density(b) - density(a))[0].id, 'industry');
  }

  // Money and soldiers are split mostly by population, a little evenly, weighted by kind.
  // Country totals stay as set in countries.ts.
  const total = list.reduce((s, f) => s + pop(f), 0) || 1;
  const size = (f: (typeof list)[number]) => (0.75 * pop(f) / total + 0.25 / list.length) * (f.properties.cap ? 1.3 : 1);
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
      pop: f.properties.pop ?? 0,
      coast: f.properties.z ?? [],
      mountain: !!f.properties.m,
      rivers: f.properties.rv ?? {},
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
