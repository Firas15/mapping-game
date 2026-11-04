// How countries feel about each other at the start, roughly as in today's Europe:
// shared alliances pull them together, open disputes push them apart.
// −100 hostile … +100 close friends. Used for the player's starting relations,
// for whom the computer picks fights with and for who forms blocs together.

/** Members of the EU and/or NATO. */
const WEST = new Set([
  'PT', 'ES', 'FR', 'GB', 'IE', 'BE', 'NL', 'LU', 'DE', 'AT', 'IT', 'DK', 'NO', 'SE', 'FI', 'IS', 'PL', 'CZ',
  'SK', 'HU', 'SI', 'HR', 'RO', 'BG', 'GR', 'EE', 'LV', 'LT', 'AL', 'MK', 'ME', 'CY', 'TR',
]);
const EAST = new Set(['RU', 'BY']);
/** Not in those alliances but leaning west. */
const WEST_LEANING = new Set(['UA', 'MD', 'XK', 'BA', 'CH']);

/** Pairs that stand out either way. Order inside a pair doesn't matter. */
const SPECIAL: [string, string, number][] = [
  ['RU', 'BY', 85],
  ['RU', 'UA', -90], ['BY', 'UA', -55],
  ['RU', 'PL', -60], ['RU', 'LT', -65], ['RU', 'LV', -60], ['RU', 'EE', -60], ['RU', 'FI', -50],
  ['RU', 'GB', -50], ['RU', 'MD', -35], ['RU', 'RS', 45], ['RU', 'HU', -10], ['RU', 'TR', -5],
  ['BY', 'PL', -50], ['BY', 'LT', -50],
  ['RS', 'XK', -75], ['RS', 'HR', -15], ['RS', 'BA', 10], ['RS', 'ME', 15], ['RS', 'HU', 30],
  ['GR', 'TR', -35], ['CY', 'TR', -70], ['GR', 'CY', 70], ['GR', 'MK', 10],
  ['UA', 'PL', 45], ['UA', 'MD', 40], ['UA', 'HU', -10],
  ['RO', 'MD', 70], ['HU', 'SK', 15], ['CZ', 'SK', 75],
  ['DK', 'SE', 60], ['DK', 'NO', 60], ['NO', 'SE', 60], ['FI', 'SE', 60], ['EE', 'FI', 55],
  ['LT', 'LV', 60], ['LV', 'EE', 60], ['LT', 'PL', 45],
  ['FR', 'DE', 55], ['BE', 'NL', 60], ['BE', 'LU', 60], ['NL', 'LU', 55], ['ES', 'PT', 60],
  ['GB', 'IE', 25], ['AT', 'DE', 55], ['AT', 'CH', 45], ['DE', 'CH', 40], ['IT', 'SI', 30],
  ['AL', 'XK', 70], ['AL', 'MK', 15], ['BG', 'MK', -10],
];

const special = new Map<string, number>();
for (const [a, b, v] of SPECIAL) { special.set(`${a}|${b}`, v); special.set(`${b}|${a}`, v); }

export function affinity(a: string, b: string): number {
  if (a === b) return 100;
  const s = special.get(`${a}|${b}`);
  if (s !== undefined) return s;
  const west = (c: string) => WEST.has(c);
  const lean = (c: string) => WEST_LEANING.has(c);
  const east = (c: string) => EAST.has(c);
  if (west(a) && west(b)) return 30;
  if ((west(a) && lean(b)) || (lean(a) && west(b))) return 20;
  if (lean(a) && lean(b)) return 15;
  if ((east(a) && (west(b) || lean(b))) || (east(b) && (west(a) || lean(a)))) return -35;
  return 0;
}
