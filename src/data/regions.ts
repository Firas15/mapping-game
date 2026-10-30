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
  /** money per turn */
  eco: number;
}

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

// A country's income is split between its regions: half by size, half evenly,
// and the capital counts double.
for (const [c, list] of byCountry) {
  const total = list.reduce((s, f) => s + (f.properties.a ?? 0), 0) || 1;
  const weight = (f: (typeof list)[number]) =>
    (0.5 * (f.properties.a ?? 0) / total + 0.5 / list.length) * (f.properties.cap ? 2 : 1);
  const wsum = list.reduce((s, f) => s + weight(f), 0);
  let left = COUNTRY[c].eco;
  list.forEach((f, i) => {
    const eco = i === list.length - 1 ? left : Math.max(1, Math.round((COUNTRY[c].eco * weight(f)) / wsum));
    left -= eco;
    REGIONS.push({
      id: f.id, c, name: f.properties.n ?? COUNTRY[c].name, area: f.properties.a ?? 0,
      capital: !!f.properties.cap, point: f.properties.p, eco: Math.max(1, eco),
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
