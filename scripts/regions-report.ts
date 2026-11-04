// Prints how regions came out: kinds, money and soldiers. Run: npx tsx scripts/regions-report.ts DE,RU
import { REGIONS } from '../src/data/regions';

const kinds: Record<string, number> = {};
for (const r of REGIONS) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
console.log(REGIONS.length, 'regions', kinds);
for (const c of (process.argv[2] ?? 'DE,RU,DK,IT').split(',')) {
  console.log(c, REGIONS.filter((r) => r.c === c).map((r) => `${r.name}[${r.kind[0]} ${r.eco}/${r.men}]`).join('  '));
}
