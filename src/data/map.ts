// The map is the heaviest file, so it loads apart from the code while the
// splash screen shows a progress bar. Built by scripts/build-map.mjs.
import type { GeometryCollection, Topology } from 'topojson-specification';

export interface RegionProps {
  /** country */
  c?: string;
  /** name */
  n?: string;
  /** km² */
  a?: number;
  /** people, thousands */
  pop?: number;
  cap?: number;
  /** capital city, lon/lat */
  p?: [number, number];
  /** sea zones on the coast */
  z?: string[];
  /** mountainous */
  m?: number;
  /** neighbour -> river between them */
  rv?: Record<string, string>;
  /** context land: country name */
  name?: string;
}
export type MapTopology = Topology<{ land: GeometryCollection<RegionProps> }> & {
  rivers: { name: string; line: [number, number][] }[];
};

/** Rough size of the file before compression, for the progress bar when the server compresses it. */
const EXPECTED_BYTES = 720_000;

async function fetchMap(): Promise<MapTopology> {
  const bar = document.getElementById('splash-bar');
  const res = await fetch(`${import.meta.env.BASE_URL}europe.json`);
  if (!res.ok || !res.body) throw new Error('map ' + res.status);
  const total = res.headers.get('content-encoding') ? EXPECTED_BYTES : Number(res.headers.get('content-length')) || EXPECTED_BYTES;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (bar) bar.style.transform = `scaleX(${Math.min(0.96, got / total)})`;
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  if (bar) bar.style.transform = 'scaleX(1)';
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function readMapFile(): Promise<MapTopology> {
  // Node (balance sims): read straight from disk. Kept out of the browser bundle.
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(p: URL, enc: string): string };
  return JSON.parse(fs.readFileSync(new URL('../../public/europe.json', import.meta.url), 'utf8'));
}

export const europe: MapTopology = typeof window === 'undefined' ? await readMapFile() : await fetchMap();
