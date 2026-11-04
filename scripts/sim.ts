// Balance check: the computer plays whole games for a few countries.
// Run: npm run sim [-- COUNTRY,COUNTRY turns games difficulty]
import { feature, neighbors } from 'topojson-client';
import { geoArea, geoCentroid } from 'd3-geo';
import { europe } from '../src/data/map';
import { COUNTRIES } from '../src/data/countries';
import { REGION } from '../src/data/regions';
import { buildGraph } from '../src/game/graph';
import { newGame, alive, owned, ownedBy, type Difficulty } from '../src/game/state';
import { endTurn, playerAttack } from '../src/game/rules';
import { land, neighbours } from '../src/game/graph';
import { atWar, canAttackRegion, cantDeclare, chance, declareWar, enemiesOf, joinCandidates, moveArmy } from '../src/game/war';
import { power } from '../src/game/blocs';
import { autoPlay } from '../src/game/ai';
import { CARD, drawHand, playCard } from '../src/game/cards';
import { resolveEvent } from '../src/game/events';
import { armyTotal, reinforceUnit } from '../src/game/units';

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

// BOT=human plays the player like an aggressive person would: one big army,
// all money into it, always attacking the weakest neighbour.
const HUMAN = process.env.BOT === 'human';
function humanTurn(s: ReturnType<typeof newGame>, n: string) {
  const armies = () => s.units.filter((u) => u.owner === n && u.type === 'army');
  const biggest = () => armies().sort((a, b) => b.str - a.str)[0];
  // most money into the main army, some into the weakest garrison
  for (let i = 0; i < 40; i++) {
    const weak = armies().sort((a, b) => a.str - b.str)[0];
    const pick = i % 3 === 2 && weak ? weak : biggest();
    if (!pick || !reinforceUnit(s, pick)) break;
  }
  if (!enemiesOf(s, n).length && s.turn >= 4) {
    const near = new Set<string>();
    for (const r of ownedBy(s, n)) for (const m of neighbours(r)) if (s.owner[m] !== n) near.add(s.owner[m]);
    const prey = [...near].filter((o) => !cantDeclare(s, n, o)).sort((a, b) => power(s, a) - power(s, b))[0];
    if (prey) declareWar(s, n, prey);
  }
  for (let round = 0; round < 6; round++) {
    let acted = false;
    for (const u of armies().filter((x) => !x.acted).sort((a, b) => b.str - a.str)) {
      if (!s.units.includes(u) || u.acted) continue;
      const targets = neighbours(u.at).filter((r) => atWar(s, n, s.owner[r]) && canAttackRegion(s, u, r));
      const join = (r: string) => joinCandidates(s, u, r).map((x) => x.id);
      const best = targets.map((r) => ({ r, ch: chance(s, u, r, join(r)) })).sort((a, b) => b.ch - a.ch)[0];
      const main = u === biggest();
      if (best && best.ch >= (main ? 55 : 75)) { playerAttack(s, u, best.r, join(best.r)); acted = true; }
    }
    if (!acted) break;
  }
  // the others stay home as garrisons unless BOT_STACK is set
  const main = biggest();
  if (!main || !process.env.BOT_STACK) return;
  for (const u of armies().filter((x) => !x.acted && x !== main)) {
    const prev = new Map<string, string>([[u.at, u.at]]);
    const queue = [u.at];
    while (queue.length) {
      const r = queue.shift()!;
      for (const m of land.get(r) ?? []) if (!prev.has(m) && s.owner[m] === n) { prev.set(m, r); queue.push(m); }
    }
    if (!prev.has(main.at) || main.at === u.at) continue;
    let step = main.at;
    while (prev.get(step) !== u.at) step = prev.get(step)!;
    moveArmy(s, u, step);
  }
}

function play(player: string) {
  const s = newGame(player, drawHand(), { difficulty: diff as Difficulty, short: false });
  for (let t = 0; t < turns && !s.lost && !s.won; t++) {
    if (s.pendingEvent) resolveEvent(s, Math.random() < 0.5 ? 0 : 1);
    s.peaceOffer = null;
    s.notice = null;
    for (const id of ['factories', 'reform', 'draft', 'propaganda']) {
      if (s.hand.includes(id) && !CARD[id].blocked?.(s)) { playCard(s, id); break; }
    }
    if (HUMAN) humanTurn(s, player); else autoPlay(s, player);
    endTurn(s);
  }
  return {
    res: s.won ? 'WON' : s.lost ? 'LOST' : 'ok', turn: s.turn, mine: owned(s).length, army: armyTotal(s, player),
    alive: COUNTRIES.filter((c) => alive(s, c.code)).length,
    top: COUNTRIES.map((c) => c.code).filter((c) => alive(s, c)).map((c) => [c, ownedBy(s, c).length] as const)
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x.join(':')).join(' '),
    coalition: s.coalitionFormed, revolts: s.log.filter((l) => l.text.startsWith('Восстание')).length,
    lost: s.stats.regionsLost, won: s.stats.battlesWon, beaten: s.stats.battlesLost,
    at20: s.history.find((h) => h.t === 20)?.me ?? 0, at40: s.history.find((h) => h.t === 40)?.me ?? 0,
  };
}

const t0 = Date.now();
for (const p of list.split(',')) {
  const rs = Array.from({ length: games }, () => play(p));
  const c = (k: string) => rs.filter((r) => r.res === k).length;
  const avg = (f: (r: (typeof rs)[number]) => number) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(1);
  console.log(`${p}: won ${c('WON')} lost ${c('LOST')} ok ${c('ok')} | end t${avg((r) => r.turn)} regions ${avg((r) => r.mine)} army ${avg((r) => r.army)} nations ${avg((r) => r.alive)} coalition ${rs.filter((r) => r.coalition).length} | t20 ${avg((r) => r.at20)} t40 ${avg((r) => r.at40)} | battles won ${avg((r) => r.won)} lost ${avg((r) => r.beaten)}, regions lost ${avg((r) => r.lost)} | e.g. ${rs[0].top}`);
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
