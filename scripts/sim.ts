// Balance check: the computer plays whole games for a few countries.
// Run: npm run sim [-- COUNTRY,COUNTRY turns games difficulty]
import { feature, neighbors } from 'topojson-client';
import { geoArea, geoCentroid } from 'd3-geo';
import europe from '../src/data/europe.json';
import { COUNTRIES } from '../src/data/countries';
import { REGION } from '../src/data/regions';
import { buildGraph } from '../src/game/graph';
import { newGame, alive, owned, ownedBy, type Difficulty } from '../src/game/state';
import { endTurn } from '../src/game/rules';
import { autoPlay } from '../src/game/ai';
import { CARD, drawHand, playCard } from '../src/game/cards';
import { resolveEvent } from '../src/game/events';
import { armyTotal } from '../src/game/units';

type Topo = { objects: { land: { geometries: { id: string }[] } } };
const topo = europe as unknown as Topo;
const geoms = topo.objects.land.geometries;
const nb = neighbors(geoms as never);
const pairs: [string, string][] = [];
geoms.forEach((g, i) => {
  if (!REGION[g.id]) return;
  for (const j of nb[i]) if (REGION[geoms[j].id] && g.id < geoms[j].id) pairs.push([g.id, geoms[j].id]);
});
const centre = new Map<string, [number, number]>();
for (const f of (feature(europe as never, (europe as never as Topo).objects.land as never) as unknown as { features: { id: string; geometry: { type: string; coordinates: number[][][][] | number[][][] } }[] }).features) {
  if (!REGION[f.id]) continue;
  const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
  const best = polys.reduce((a, p) => (geoArea({ type: 'Polygon', coordinates: p } as never) > geoArea({ type: 'Polygon', coordinates: a } as never) ? p : a));
  centre.set(f.id, geoCentroid({ type: 'Polygon', coordinates: best } as never) as [number, number]);
}
buildGraph(pairs, (id) => centre.get(id)!);

const [list = 'DE,FR,RU,PL,RO,CZ,LU', turnsArg = '80', gamesArg = '8', diff = 'normal'] = process.argv.slice(2);
const turns = Number(turnsArg);
const games = Number(gamesArg);

function play(player: string) {
  const s = newGame(player, drawHand(), { difficulty: diff as Difficulty, short: false });
  for (let t = 0; t < turns && !s.lost && !s.won; t++) {
    if (s.pendingEvent) resolveEvent(s, Math.random() < 0.5 ? 0 : 1);
    s.peaceOffer = null;
    s.notice = null;
    for (const id of ['factories', 'reform', 'draft', 'propaganda']) {
      if (s.hand.includes(id) && !CARD[id].blocked?.(s)) { playCard(s, id); break; }
    }
    autoPlay(s, player);
    endTurn(s);
  }
  return {
    res: s.won ? 'WON' : s.lost ? 'LOST' : 'ok', turn: s.turn, mine: owned(s).length, army: armyTotal(s, player),
    alive: COUNTRIES.filter((c) => alive(s, c.code)).length,
    top: COUNTRIES.map((c) => c.code).filter((c) => alive(s, c)).map((c) => [c, ownedBy(s, c).length] as const)
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x.join(':')).join(' '),
    coalition: s.coalitionFormed, revolts: s.log.filter((l) => l.text.startsWith('Восстание')).length,
  };
}

const t0 = Date.now();
for (const p of list.split(',')) {
  const rs = Array.from({ length: games }, () => play(p));
  const c = (k: string) => rs.filter((r) => r.res === k).length;
  const avg = (f: (r: (typeof rs)[number]) => number) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(1);
  console.log(`${p}: won ${c('WON')} lost ${c('LOST')} ok ${c('ok')} | end t${avg((r) => r.turn)} regions ${avg((r) => r.mine)} army ${avg((r) => r.army)} nations ${avg((r) => r.alive)} coalition ${rs.filter((r) => r.coalition).length} | e.g. ${rs[0].top}`);
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
