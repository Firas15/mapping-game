import { COUNTRIES, COUNTRY } from '../data/countries';
import { REGION, regionTitle } from '../data/regions';
import {
  DIFFICULTY, type GameState, PLAYER_SAFE_UNTIL, type Unit, WAR_STARTS, alive, armiesAt, owned, ownedBy, unitsOf,
} from './state';
import { land, neighbours, sea } from './graph';
import {
  airStrike, airTargets, atWar, canAttackRegion, cantDeclare, chance, crossing, declareWar, enemiesOf, fleetMoves,
  friends, landBattle, makePeace, moveFleet, seaBlocked,
} from './war';
import {
  armyTotal, build, canRaiseIn, draft, draftCap, maxArmies, price, reinforce, removeTroops, upkeepOf,
} from './units';
import { incomeOf, warScore } from './rules';
import { isAlly, relation } from './diplomacy';
import { power } from './blocs';
import { clamp, log } from './log';
import { affinity } from '../data/affinity';

/** How eager a government is to start a war, per turn. */
const AGGRESSION = { nat: 0.3, con: 0.16, soc: 0.12, dem: 0.06 } as const;
/** How much stronger than the victim a government wants to be before declaring war. */
const NEED = { nat: 1.25, con: 1.5, soc: 1.6, dem: 2.1 } as const;
/** Lowest win chance a government accepts when attacking a region. */
const NERVE = { nat: 50, con: 55, soc: 57, dem: 63 } as const;

/** Army a computer country is willing to keep. Grows with its land. */
export const armyCap = (s: GameState, n: string) => draftCap(s, n);

export function aiTurn(s: GameState) {
  s.events = [];
  const nations = COUNTRIES.map((c) => c.code).filter((c) => c !== s.player && alive(s, c));
  for (let i = nations.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nations[i], nations[j]] = [nations[j], nations[i]];
  }
  for (const n of nations) economy(s, n);
  for (const n of nations) production(s, n);
  if (s.turn >= WAR_STARTS) for (const n of nations) if (alive(s, n)) maybeDeclare(s, n);
  for (const n of nations) {
    if (!alive(s, n)) continue;
    actArmies(s, n);
    actFleets(s, n);
    actAir(s, n);
  }
  aiPeace(s);
  offerPeace(s);
}

// ---------- money and forces ----------

function economy(s: GameState, n: string) {
  const m = s.ai[n];
  m.money += incomeOf(s, n) - upkeepOf(s, n);
  if (m.money < 0) {
    removeTroops(s, n, Math.ceil(-m.money / 5));
    m.money = 0;
  }
  const total = armyTotal(s, n);
  const cap = armyCap(s, n);
  if (total < cap) reinforce(s, n, Math.min(draft(s, n), cap - total));
}

/** Own regions that most need troops: enemy armies next door minus what already stands there. */
function frontier(s: GameState, n: string) {
  const enemies = new Set(enemiesOf(s, n));
  return ownedBy(s, n).map((r) => {
    let threat = 0;
    let enemyLand = false;
    for (const m of neighbours(r)) {
      const o = s.owner[m];
      if (o === n || friends(s, n, o)) continue;
      const weight = enemies.has(o) ? 1 : 0.3;
      if (enemies.has(o)) enemyLand = true;
      threat += armiesAt(s, m, o).reduce((sum, u) => sum + u.str, 0) * weight + (enemies.has(o) ? 4 : 1);
    }
    const here = armiesAt(s, r, n).reduce((sum, u) => sum + u.str, 0);
    return { r, threat, need: threat - here, enemyLand };
  }).filter((x) => x.threat > 0).sort((a, b) => b.need - a.need);
}

function production(s: GameState, n: string) {
  const m = s.ai[n];
  const reserve = Math.max(30, incomeOf(s, n) * 0.5);
  const cap = armyCap(s, n);
  const front = frontier(s, n);
  const spot = front.find((x) => canRaiseIn(s, n, x.r))?.r ?? (s.capital[n] && canRaiseIn(s, n, s.capital[n]!) ? s.capital[n]! : null);
  const armies = unitsOf(s, n, 'army');

  if (spot && armies.length < maxArmies(s, n) && !armiesAt(s, spot, n).length && m.money >= price(s, n, 'army') + reserve && armyTotal(s, n) < cap) {
    build(s, n, 'army', spot);
  }
  // top up the armies on the most threatened ground
  for (let guard = 0; guard < 8; guard++) {
    if (m.money < price(s, n, 'reinforce') + reserve || armyTotal(s, n) >= cap) break;
    const onFront = unitsOf(s, n, 'army').filter((u) => s.owner[u.at] === n);
    if (!onFront.length) break;
    const needOf = (u: Unit) => front.find((x) => x.r === u.at)?.need ?? -99;
    const pick = onFront.sort((a, b) => needOf(b) - needOf(a) || a.str - b.str)[0];
    m.money -= price(s, n, 'reinforce');
    pick.str += 10;
  }
  // ships for coastal countries with enemies across the water, planes once rich enough
  const coastal = ownedBy(s, n).filter((r) => REGION[r].coast.length && canRaiseIn(s, n, r));
  const enemyAtSea = enemiesOf(s, n).some((e) => ownedBy(s, e).some((r) => REGION[r].coast.length));
  if (coastal.length && unitsOf(s, n, 'fleet').length < 2 && (enemyAtSea || Math.random() < 0.05)
    && m.money >= price(s, n, 'fleet') + reserve) build(s, n, 'fleet', coastal[0]);
  if (s.turn >= 8 && unitsOf(s, n, 'air').length < 2 && Math.random() < 0.3 && m.money >= price(s, n, 'air') + reserve * 2) {
    const base = spot ?? coastal[0];
    if (base) build(s, n, 'air', base);
  }
}

// ---------- going to war ----------

/** Strength a country can count on: its own plus a share of its friends'. */
function backedPower(s: GameState, n: string) {
  let p = power(s, n);
  for (const c of COUNTRIES) if (c.code !== n && alive(s, c.code) && friends(s, n, c.code)) p += power(s, c.code) * 0.5;
  return p;
}

function maybeDeclare(s: GameState, n: string) {
  const wars = enemiesOf(s, n).length;
  if (wars >= 2 || (wars === 1 && Math.random() > 0.15) || s.turn < s.ai[n].calmUntil) return;
  const ruling = s.ruling[n];
  if (Math.random() > AGGRESSION[ruling] * DIFFICULTY[s.settings.difficulty].aggression) return;
  const neighbourOwners = new Set<string>();
  for (const r of ownedBy(s, n)) for (const m of neighbours(r)) if (s.owner[m] !== n) neighbourOwners.add(s.owner[m]);

  let best: string | null = null;
  let bestScore = 0;
  const mine = power(s, n) + 1;
  for (const o of neighbourOwners) {
    if (cantDeclare(s, n, o)) continue;
    const aff = affinity(n, o);
    // close friends don't fight; old rivals need less of a reason
    if (aff >= 45) continue;
    let need: number = NEED[ruling] * clamp(1 + aff / 120, 0.7, 1.4);
    if (o === s.player) {
      if (s.turn < PLAYER_SAFE_UNTIL || isAlly(s, n) || relation(s, n) >= 40) continue;
      // a sprawling player looks like a threat worth stopping
      need -= Math.min(0.4, Math.max(0, owned(s).length - 10) * 0.02);
      need += clamp(relation(s, n) / 100, -0.15, 0.4);
      need *= DIFFICULTY[s.settings.difficulty].caution;
    }
    const ratio = mine / (backedPower(s, o) + 1);
    if (ratio < need) continue;
    const score = ratio + ownedBy(s, o).reduce((sum, r) => sum + REGION[r].eco, 0) / 200 - aff / 60;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  if (best) declareWar(s, n, best);
}

// ---------- moving and fighting ----------

/** One step from `from` toward `goal` through own land (and safe sea crossings). */
function stepToward(s: GameState, n: string, from: string, goal: string): string | null {
  if (from === goal) return null;
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const r = queue.shift()!;
    if (r === goal) break;
    for (const m of neighbours(r)) {
      if (prev.has(m) || s.owner[m] !== n) continue;
      const z = sea.get(r)?.get(m);
      if (z && !land.get(r)?.has(m) && seaBlocked(s, n, z)) continue;
      prev.set(m, r);
      queue.push(m);
    }
  }
  if (!prev.has(goal)) return null;
  let step = goal;
  while (prev.get(step) !== from) step = prev.get(step)!;
  return step;
}

/** Steps from every region to the country's own home land (cores it still holds). */
function homeDistance(s: GameState, n: string) {
  const out = new Map<string, number>();
  let frontierSet = ownedBy(s, n).filter((r) => REGION[r].c === n);
  if (!frontierSet.length) frontierSet = ownedBy(s, n);
  for (const r of frontierSet) out.set(r, 0);
  for (let d = 1; d <= 6 && frontierSet.length; d++) {
    const next: string[] = [];
    for (const r of frontierSet) for (const m of neighbours(r)) if (!out.has(m)) { out.set(m, d); next.push(m); }
    frontierSet = next;
  }
  return out;
}

/** How likely the enemy is to take each of our regions next turn, and how much it matters. */
function dangerMap(s: GameState, n: string, enemies: Set<string>) {
  const out: { r: string; danger: number; weight: number }[] = [];
  for (const r of ownedBy(s, n)) {
    let danger = 0;
    for (const m of neighbours(r)) {
      for (const e of armiesAt(s, m)) {
        if (!enemies.has(e.owner)) continue;
        if (e.owner === s.player && s.turn < PLAYER_SAFE_UNTIL) continue;
        danger = Math.max(danger, chance(s, e, r));
      }
    }
    if (!danger) continue;
    const reg = REGION[r];
    const weight = (s.capital[n] === r ? 3 : 1) * (reg.c === n ? 1.6 : 1) * (1 + reg.eco / 30 + reg.men / 4);
    out.push({ r, danger, weight });
  }
  return out.sort((a, b) => b.danger * b.weight - a.danger * a.weight);
}

/** Within this many steps the army can reach a region over own land. */
function stepsTo(s: GameState, n: string, from: string, goal: string, limit = 4): number {
  if (from === goal) return 0;
  const seen = new Set([from]);
  let wave = [from];
  for (let d = 1; d <= limit; d++) {
    const next: string[] = [];
    for (const r of wave) for (const m of neighbours(r)) {
      if (seen.has(m) || s.owner[m] !== n) continue;
      if (m === goal) return d;
      seen.add(m);
      next.push(m);
    }
    wave = next;
  }
  return Infinity;
}

function actArmies(s: GameState, n: string) {
  const ruling = s.ruling[n];
  const enemies = new Set(enemiesOf(s, n));
  const busy = new Set<number>();
  const armies = () => unitsOf(s, n, 'army').filter((u) => !u.acted && !busy.has(u.id) && s.units.includes(u));

  // 1. defence first: cover our regions the enemy could take, home land and the capital above all
  if (enemies.size) {
    for (const d of dangerMap(s, n, enemies)) {
      if (d.danger < 45) continue;
      const here = armiesAt(s, d.r, n);
      // whoever already stands there holds the line
      for (const u of here) busy.add(u.id);
      if (here.length && d.danger < 65) continue;
      // bring the closest free army one step nearer
      const helper = armies()
        .map((u) => ({ u, steps: stepsTo(s, n, u.at, d.r) }))
        .filter((x) => x.steps <= 3)
        .sort((a, b) => a.steps - b.steps || b.u.str - a.u.str)[0];
      if (!helper) continue;
      busy.add(helper.u.id);
      const step = stepToward(s, n, helper.u.at, d.r);
      if (step && crossing(helper.u.at, step)) { helper.u.at = step; helper.u.acted = true; }
    }
  }

  // 2. free armies attack, preferring targets close to home over deep raids
  const home = homeDistance(s, n);
  if (enemies.size) {
    for (const u of armies().sort((a, b) => b.str - a.str)) {
      if (u.acted || !s.units.includes(u)) continue;
      let best: string | null = null;
      let bestScore = -Infinity;
      for (const r of neighbours(u.at)) {
        const o = s.owner[r];
        if (!enemies.has(o) || !canAttackRegion(s, u, r)) continue;
        if (o === s.player && s.turn < PLAYER_SAFE_UNTIL) continue;
        const ch = chance(s, u, r);
        if (ch < NERVE[ruling]) continue;
        const reg = REGION[r];
        const far = Math.max(0, (home.get(r) ?? 6) - 2);
        const score = ch + reg.eco * 0.5 + reg.men * 3 + (s.capital[o] === r ? 25 : 0) + (reg.c === n ? 30 : 0)
          - far * 18 + Math.random() * 8;
        if (score > bestScore) { bestScore = score; best = r; }
      }
      if (!best || bestScore < 40) continue;
      const defender = s.owner[best];
      const res = landBattle(s, u, best);
      s.events.push({ attacker: n, defender, target: best, won: res.won, eliminated: res.eliminated });
      if (defender === s.player) {
        if (res.won) log(s, `${COUNTRY[n].name} взяла ${regionTitle(best)}`, 'bad');
        else log(s, `Отбили атаку: ${regionTitle(best)}`, 'good');
      }
      if (res.eliminated) log(s, `${COUNTRY[defender].name} больше не существует`, defender === s.player ? 'bad' : 'info');
    }
  }

  // 3. the rest walk to the front, the part of it nearest home first
  const front = frontier(s, n);
  const assigned = new Map<string, number>();
  for (const u of armies().sort((a, b) => b.str - a.str)) {
    const target = front
      .map((x) => ({ ...x, left: x.need - (assigned.get(x.r) ?? 0), far: home.get(x.r) ?? 6 }))
      .sort((a, b) => Number(b.enemyLand) - Number(a.enemyLand) || a.far - b.far || b.left - a.left)
      .find((x) => x.left > 0);
    if (!target || target.r === u.at) {
      assigned.set(u.at, (assigned.get(u.at) ?? 0) + u.str);
      continue;
    }
    assigned.set(target.r, (assigned.get(target.r) ?? 0) + u.str);
    const step = stepToward(s, n, u.at, target.r);
    if (step && crossing(u.at, step)) { u.at = step; u.acted = true; }
  }
}

function actFleets(s: GameState, n: string) {
  const enemies = enemiesOf(s, n);
  if (!enemies.length) return;
  const enemyPower = (z: string) => s.units.filter((x) => x.type === 'fleet' && x.at === z && enemies.includes(x.owner))
    .reduce((sum, x) => sum + x.str, 0);
  for (const f of unitsOf(s, n, 'fleet')) {
    if (f.acted) continue;
    const opts = fleetMoves(f);
    // hunt a weaker enemy fleet next door
    const prey = opts.find((z) => { const p = enemyPower(z); return p > 0 && f.str > p * 1.2; });
    if (prey) { moveFleet(s, f, prey); continue; }
    // flee from a stronger one here
    if (enemyPower(f.at) > f.str) {
      const safe = opts.find((z) => enemyPower(z) === 0);
      if (safe) moveFleet(s, f, safe);
      continue;
    }
    // stand guard off an enemy coast
    const coastHere = (z: string) => enemies.some((e) => ownedBy(s, e).some((r) => REGION[r].coast.includes(z)));
    if (!coastHere(f.at)) {
      const go = opts.find((z) => coastHere(z) && enemyPower(z) <= f.str);
      if (go) moveFleet(s, f, go);
    }
  }
}

function actAir(s: GameState, n: string) {
  for (const a of unitsOf(s, n, 'air')) {
    if (a.acted) continue;
    const t = airTargets(s, a);
    const score = (target: string) => s.units.filter((u) => u.at === target && atWar(s, n, u.owner))
      .reduce((sum, u) => sum + u.str, 0);
    const best = [...t.regions, ...t.zones].sort((x, y) => score(y) - score(x))[0];
    if (best && score(best) >= 5) airStrike(s, a, best);
  }
}

// ---------- peace ----------

/** Computer wars burn out after a while; whoever holds land keeps it. */
function aiPeace(s: GameState) {
  for (const w of [...s.wars]) {
    if (w.a === s.player || w.b === s.player) continue;
    const age = s.turn - w.since;
    const beaten = [w.a, w.b].some((x) => alive(s, x) && armyTotal(s, x) < 4);
    if ((age >= 6 && Math.random() < 0.08 + (age - 6) * 0.02) || (beaten && age >= 3)) makePeace(s, w.a, w.b, 'keep');
  }
}

/** A computer country losing to the player may ask for peace. */
function offerPeace(s: GameState) {
  if (s.peaceOffer) return;
  for (const w of s.wars) {
    if (w.a !== s.player && w.b !== s.player) continue;
    const n = w.a === s.player ? w.b : w.a;
    if (s.turn - w.since < 4 || !alive(s, n)) continue;
    if (warScore(s, n).score >= 25 && Math.random() < 0.35) {
      s.peaceOffer = n;
      return;
    }
  }
}


/** Lets the computer play a turn for any country, the player's included (balance tests, autoplay). */
export function autoPlay(s: GameState, n: string) {
  const own = n === s.player;
  if (own) s.ai[n].money = s.money;
  production(s, n);
  if (s.turn >= WAR_STARTS) maybeDeclare(s, n);
  actArmies(s, n);
  actFleets(s, n);
  actAir(s, n);
  if (own) s.money = s.ai[n].money;
}
