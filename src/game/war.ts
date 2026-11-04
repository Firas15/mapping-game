import { COUNTRIES, COUNTRY } from '../data/countries';
import { CAPITAL, REGION, regionTitle } from '../data/regions';
import { SEA } from '../data/seas';
import { land, neighbours, sea } from './graph';
import {
  type GameState, type Unit, CAPITAL_BONUS, CAPITULATE_AFTER, HOME_BONUS, TRUCE_TURNS, addUnit, alive, armiesAt,
  fx, integrated, isWinter, ownedBy, pairKey, playerRuling, unitsOf,
} from './state';
import { upg, upgSeaMaster } from './upgrades';
import { changeRelation } from './diplomacy';
import { clamp, log } from './log';
import { shiftParty } from './rules';

const name = (n: string) => COUNTRY[n].name;

// ---------- wars ----------

export const warOf = (s: GameState, a: string, b: string) =>
  s.wars.find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
export const atWar = (s: GameState, a: string, b: string) => !!warOf(s, a, b);
export const enemiesOf = (s: GameState, n: string) =>
  s.wars.flatMap((w) => (w.a === n ? [w.b] : w.b === n ? [w.a] : []));
export const truceUntil = (s: GameState, a: string, b: string) => s.truces[pairKey(a, b)] ?? 0;
export const inTruce = (s: GameState, a: string, b: string) => truceUntil(s, a, b) > s.turn;
export const blocOf = (s: GameState, n: string) => s.blocs.find((b) => b.members.includes(n));

/** Allies of the player and members of one bloc never fight each other. */
export function friends(s: GameState, a: string, b: string) {
  if (a === b) return true;
  if (a === s.player && s.allies.includes(b)) return true;
  if (b === s.player && s.allies.includes(a)) return true;
  const ba = blocOf(s, a);
  return !!ba && ba === blocOf(s, b);
}

/** Who stands by a country when it is attacked. */
function defendersOf(s: GameState, n: string) {
  const out = new Set<string>(blocOf(s, n)?.members ?? []);
  if (n === s.player) for (const a of s.allies) out.add(a);
  if (s.allies.includes(n)) out.add(s.player);
  out.delete(n);
  return [...out].filter((m) => alive(s, m));
}

/** Why `a` can't declare war on `b` right now, or null. */
export function cantDeclare(s: GameState, a: string, b: string): string | null {
  if (a === b || !alive(s, b)) return 'Нельзя';
  if (atWar(s, a, b)) return 'Вы уже воюете';
  if (inTruce(s, a, b)) return `Перемирие до хода ${truceUntil(s, a, b)}`;
  if (friends(s, a, b)) return 'Это ваш союзник';
  return null;
}

export const warPenalty = (s: GameState) =>
  s.nb[s.player].casusBelli ? 0 : playerRuling(s) === 'dem' ? 10 : 5;

export function declareWar(s: GameState, a: string, b: string): boolean {
  if (cantDeclare(s, a, b)) return false;
  s.wars.push({ a, b, since: s.turn, taken: {} });
  if (a === s.player) {
    s.stability = clamp(s.stability - warPenalty(s), 0, 100);
    for (const c of COUNTRIES) {
      if (c.code !== s.player && alive(s, c.code)) changeRelation(s, c.code, c.code === b ? -50 : -2);
    }
  }
  if (b === s.player) changeRelation(s, a, -30);
  const mine = a === s.player || b === s.player;
  log(s, `${name(a)} объявляет войну: ${name(b)}`, b === s.player ? 'bad' : mine ? 'info' : 'info');

  // the victim's bloc and allies join in
  const joined: string[] = [];
  for (const m of defendersOf(s, b)) {
    if (m === a || atWar(s, m, a) || inTruce(s, m, a) || friends(s, m, a)) continue;
    s.wars.push({ a: m, b: a, since: s.turn, taken: {} });
    joined.push(m);
  }
  if (joined.length) {
    const tone = joined.includes(s.player) || b === s.player ? 'good' : a === s.player ? 'bad' : 'info';
    log(s, `На стороне ${name(b)} в войну вступают: ${joined.map(name).join(', ')}`, tone);
  }
  return true;
}

export type PeaceTerms = 'white' | 'keep' | 'reparations';
export const reparationsOf = (s: GameState, payer: string) =>
  Math.round(payer === s.player ? Math.min(s.money, 300) : Math.min(s.ai[payer].money, 60 + ownedBy(s, payer).length * 25));

/** Ends a war. White peace hands back what changed hands in it. */
export function makePeace(s: GameState, a: string, b: string, terms: PeaceTerms, payer?: string) {
  const w = warOf(s, a, b);
  if (!w) return;
  if (terms === 'white') {
    for (const [r, prev] of Object.entries(w.taken)) {
      const now = s.owner[r];
      if ((now === a || now === b) && now !== prev && alive(s, prev) && (prev === a || prev === b)) {
        transfer(s, r, prev);
        evacuate(s, r, now);
      }
    }
  }
  if (terms === 'reparations' && payer) {
    const amount = reparationsOf(s, payer);
    const taker = payer === a ? b : a;
    if (payer === s.player) s.money -= amount; else s.ai[payer].money -= amount;
    if (taker === s.player) s.money += amount; else s.ai[taker].money += amount;
  }
  s.wars = s.wars.filter((x) => x !== w);
  s.truces[pairKey(a, b)] = s.turn + TRUCE_TURNS;
  for (const n of [a, b]) if (n !== s.player) s.ai[n].calmUntil = s.turn + 5;
  if (a === s.player || b === s.player) s.stats.peaces++;
  const how = { white: 'белый мир', keep: 'занятые области остаются за победителем', reparations: 'с репарациями' }[terms];
  log(s, `Мир: ${name(a)} и ${name(b)} (${how})`, a === s.player || b === s.player ? 'good' : 'info');
}

// ---------- movement ----------

/** How to get from one region to a neighbouring one: overland, or by sea through a zone. */
export function crossing(from: string, to: string): { sea?: string } | null {
  if (land.get(from)?.has(to)) return {};
  const z = sea.get(from)?.get(to);
  return z ? { sea: z } : null;
}

export const fleetMul = (s: GameState, n: string) =>
  1 + s.nb[n].fleetMul + (n === s.player ? upg(s, 'fleetMul') : 0) + (fx(n).seaMaster ? 0.15 : 0);
export const airMul = (s: GameState, n: string) => 1 + s.nb[n].airMul + (n === s.player ? upg(s, 'airMul') : 0);

const fleetPower = (s: GameState, zone: string, who: (owner: string) => boolean) =>
  s.units.filter((u) => u.type === 'fleet' && u.at === zone && who(u.owner))
    .reduce((sum, u) => sum + u.str * fleetMul(s, u.owner), 0);

/** Enemy ships in the zone outgun ours: no landing through it. */
export function seaBlocked(s: GameState, nation: string, zone: string) {
  const enemy = fleetPower(s, zone, (o) => atWar(s, nation, o));
  return enemy > 0 && enemy > fleetPower(s, zone, (o) => friends(s, nation, o));
}

export function canMoveArmy(s: GameState, u: Unit, to: string) {
  if (u.type !== 'army' || u.acted || s.owner[to] !== u.owner) return false;
  const c = crossing(u.at, to);
  return !!c && !(c.sea && seaBlocked(s, u.owner, c.sea));
}

/** Can this army strike that region (war still has to be declared)? */
export function canAttackRegion(s: GameState, u: Unit, to: string) {
  if (u.type !== 'army' || u.acted || u.str < 3) return false;
  const target = s.owner[to];
  if (target === u.owner || friends(s, u.owner, target)) return false;
  const c = crossing(u.at, to);
  return !!c && !(c.sea && seaBlocked(s, u.owner, c.sea));
}

/** Moves an army; meeting another of ours there, the two become one. Returns the army now standing there. */
export function moveArmy(s: GameState, u: Unit, to: string): Unit | null {
  if (!canMoveArmy(s, u, to)) return null;
  u.at = to;
  u.acted = true;
  return mergeAt(s, to, u.owner) ?? u;
}

/** Takes `n` soldiers out of an army as a new army standing in the same place. */
export function splitArmy(s: GameState, u: Unit, n: number): Unit {
  const take = Math.round(n);
  if (u.type !== 'army' || take >= u.str || take < 1) return u;
  u.str -= take;
  return addUnit(s, u.owner, 'army', take, u.at);
}

/** Runs `fn` as if the army had `n` soldiers (for forecasts), then puts it back. */
export function asIfStrength<T>(u: Unit, n: number, fn: () => T): T {
  const real = u.str;
  u.str = Math.max(1, Math.min(real, Math.round(n)));
  try { return fn(); } finally { u.str = real; }
}

/** Folds all armies of one owner in one region into a single army. */
export function mergeAt(s: GameState, r: string, owner: string): Unit | null {
  const here = armiesAt(s, r, owner);
  if (here.length < 2) return here[0] ?? null;
  const [first, ...rest] = here;
  for (const x of rest) { first.str += x.str; first.acted = first.acted || x.acted; }
  s.units = s.units.filter((x) => !rest.includes(x));
  return first;
}

/** Merges every stack on the map (after the computer has moved). */
export function mergeAll(s: GameState) {
  const seen = new Set<string>();
  for (const u of [...s.units]) {
    const key = u.owner + '@' + u.at;
    if (u.type !== 'army' || seen.has(key)) continue;
    seen.add(key);
    mergeAt(s, u.at, u.owner);
  }
}

// ---------- strength ----------

/** Local defenders every region has even with no army in it. */
export function militia(s: GameState, r: string) {
  const o = s.owner[r];
  const reg = REGION[r];
  return o === reg.c ? 2 + reg.men * 1.5 + (s.capital[o] === r ? 6 : 0) : 1;
}

export function attackMul(s: GameState, n: string, target?: string) {
  const vsPlayer = target && s.owner[target] === s.player && s.coalition.includes(n) ? 0.1 : 0;
  return 1 + (fx(n).attackMul ?? 0) + s.nb[n].attackMul + (n === s.player ? upg(s, 'attackMul') : 0)
    + (s.ruling[n] === 'nat' ? 0.15 : 0) + vsPlayer;
}

export function defenseMul(s: GameState, r: string) {
  const o = s.owner[r];
  const e = fx(REGION[r].c);
  const home = o === REGION[r].c ? HOME_BONUS + (s.capital[o] === r ? CAPITAL_BONUS : 0) : 0;
  return 1 + (e.defenseMul ?? 0) + (isWinter(s.turn) ? e.winterDefenseMul ?? 0 : 0) + s.nb[o].defenseMul
    + (o === s.player ? upg(s, 'defenseMul') : 0) + home;
}

/** Friends' armies next to the battlefield chip in. */
export function helpOf(s: GameState, side: string, r: string) {
  let sum = 0;
  for (const u of s.units) {
    if (u.type !== 'army' || u.owner === side || !friends(s, side, u.owner)) continue;
    if (u.at === r || land.get(r)?.has(u.at)) sum += u.str * 0.25;
  }
  return sum;
}

/** Armies in neighbouring regions of the same owner back up the defence. */
export function supportOf(s: GameState, r: string) {
  const o = s.owner[r];
  let sum = 0;
  for (const n of land.get(r) ?? []) {
    if (s.owner[n] !== o) continue;
    for (const u of armiesAt(s, n, o)) sum += u.str * 0.25;
  }
  return sum;
}

export function defensePower(s: GameState, r: string) {
  const o = s.owner[r];
  const local = armiesAt(s, r, o).reduce((sum, u) => sum + u.str, 0) + militia(s, r);
  return Math.max(1, local * defenseMul(s, r) + supportOf(s, r) + helpOf(s, o, r));
}

/** Our other armies that could join an attack on `to` (from any neighbouring region). */
export const joinCandidates = (s: GameState, u: Unit, to: string) =>
  s.units.filter((x) => x.type === 'army' && x.owner === u.owner && !x.acted && x.str >= 3 && x !== u && canAttackRegion(s, x, to));

/**
 * Who attacks: the chosen army plus the ones picked to join.
 * Without a list (computer players) every army that can reach joins.
 */
export function attackers(s: GameState, u: Unit, to: string, join?: number[]) {
  const extra = joinCandidates(s, u, to).filter((x) => !join || join.includes(x.id));
  return [u, ...extra];
}

export function attackPower(s: GameState, u: Unit, to: string, join?: number[]) {
  const master = fx(u.owner).seaMaster || (u.owner === s.player && upgSeaMaster(s));
  const mul = attackMul(s, u.owner, to);
  const own = attackers(s, u, to, join).reduce((sum, x) => sum + x.str * mul * (crossing(x.at, to)?.sea && !master ? 0.75 : 1), 0);
  return own + helpOf(s, u.owner, to);
}

export function chance(s: GameState, u: Unit, to: string, join?: number[]) {
  const a = attackPower(s, u, to, join) ** 2;
  const d = defensePower(s, to) ** 2;
  return clamp(Math.round((a / (a + d)) * 100), 3, 97);
}

// ---------- losses ----------

/** Spreads losses over units by their size; empty units disappear. */
function hurt(s: GameState, units: Unit[], amount: number) {
  const total = units.reduce((sum, u) => sum + u.str, 0);
  if (!total || amount <= 0) return;
  for (const u of units) u.str = Math.max(0, Math.round(u.str - (amount * u.str) / total));
  cleanup(s);
}
const cleanup = (s: GameState) => { s.units = s.units.filter((u) => u.str > 0); };

/** Armies of `owner` standing in `r` fall back to a neighbouring own region, or are lost. */
function evacuate(s: GameState, r: string, owner: string) {
  for (const u of s.units.filter((x) => x.owner === owner && x.at === r && x.type !== 'fleet')) {
    const back = [...(land.get(r) ?? [])].find((n) => s.owner[n] === owner);
    if (back) u.at = back;
    else u.str = 0;
  }
  cleanup(s);
}

export const trophies = (r: string) => ({ money: REGION[r].eco * 2, army: REGION[r].men * 3 });

/** Hands a region over and keeps the bookkeeping straight. */
export function transfer(s: GameState, r: string, to: string) {
  const prev = s.owner[r];
  if (prev === to) return;
  const w = warOf(s, prev, to);
  if (w && !(r in w.taken)) w.taken[r] = prev;
  s.owner[r] = to;
  s.heldSince[r] = REGION[r].c === to ? 0 : s.turn;
  if (REGION[r].c === to) delete s.unrest[r];
  else s.unrest[r] = 15;
  if (to === s.player) s.stats.regionsTaken++;
  if (prev === s.player) { s.stats.regionsLost++; s.stats.lastLoss = s.turn; }
  // air wings based there fly home
  for (const u of s.units.filter((x) => x.type === 'air' && x.at === r && x.owner === prev)) {
    const home = s.capital[prev] && s.owner[s.capital[prev]!] === prev ? s.capital[prev]! : ownedBy(s, prev)[0];
    if (home) u.at = home; else u.str = 0;
  }
  cleanup(s);
}

/** A country with no land left: its units vanish and its wars end. */
function wipe(s: GameState, n: string) {
  s.units = s.units.filter((u) => u.owner !== n);
  s.wars = s.wars.filter((w) => w.a !== n && w.b !== n);
  s.allies = s.allies.filter((a) => a !== n);
  s.capital[n] = null;
  delete s.keyless[n];
  for (const b of s.blocs) b.members = b.members.filter((m) => m !== n);
}

// ---------- land battle ----------

export interface BattleResult {
  won: boolean;
  defender: string;
  eliminated: boolean;
  loot: { money: number; army: number };
  capital: boolean;
}

export function landBattle(s: GameState, u: Unit, to: string, roll = Math.random(), join?: number[]): BattleResult {
  const defender = s.owner[to];
  const att = attackPower(s, u, to, join);
  const def = defensePower(s, to);
  const won = roll * 100 < chance(s, u, to, join);
  const local = armiesAt(s, to, defender);
  const group = attackers(s, u, to, join);
  for (const x of group) x.acted = true;
  let loot = { money: 0, army: 0 };
  const capital = s.capital[defender] === to;

  if (won) {
    hurt(s, group, def * 0.3);
    if (u.str < 1) u.str = 1;
    hurt(s, local, att * 0.3);
    for (const n of land.get(to) ?? []) {
      if (s.owner[n] === defender) for (const x of armiesAt(s, n, defender)) x.str = Math.round(x.str * 0.92);
    }
    evacuate(s, to, defender);
    transfer(s, to, u.owner);
    u.at = to;
    loot = trophies(to);
    u.str += loot.army;
    if (u.owner === s.player) s.money += loot.money; else s.ai[u.owner].money += loot.money;
    if (capital && u.owner === s.player) s.stats.capitalsTaken++;
  } else {
    hurt(s, group, def * 0.45);
    hurt(s, local, att * 0.15);
  }
  if (u.owner === s.player) { if (won) s.stats.battlesWon++; else s.stats.battlesLost++; }
  cleanup(s);

  const eliminated = won && !alive(s, defender);
  if (eliminated) wipe(s, defender);
  return { won, defender, eliminated, loot, capital };
}

// ---------- air ----------

/** Own regions an air wing can fly to in one turn. */
export const airMoves = (s: GameState, a: Unit) =>
  [...airReach(a.at)].filter((r) => r !== a.at && s.owner[r] === a.owner);

export function moveAir(s: GameState, a: Unit, to: string) {
  if (a.type !== 'air' || a.acted || !airMoves(s, a).includes(to)) return false;
  a.at = to;
  a.acted = true;
  return true;
}

/** Regions a wing based in `base` can reach: two steps by land or sea. */
export function airReach(base: string) {
  const out = new Set<string>([base]);
  let frontier = [base];
  for (let step = 0; step < 2; step++) {
    const next: string[] = [];
    for (const r of frontier) for (const n of neighbours(r)) if (!out.has(n)) { out.add(n); next.push(n); }
    frontier = next;
  }
  return out;
}

export function airTargets(s: GameState, a: Unit) {
  const reach = airReach(a.at);
  const enemy = (o: string) => atWar(s, a.owner, o);
  const regions = [...reach].filter((r) => enemy(s.owner[r]) && armiesAt(s, r).some((u) => enemy(u.owner)));
  const zones = new Set<string>();
  for (const r of reach) for (const z of REGION[r].coast) zones.add(z);
  const seaTargets = [...zones].filter((z) => s.units.some((u) => u.type === 'fleet' && u.at === z && enemy(u.owner)));
  return { regions, zones: seaTargets };
}

/** Bombs enemy armies in a region or ships in a sea zone. Planes can't take land. */
export function airStrike(s: GameState, a: Unit, target: string): { dmg: number; lost: number } | null {
  if (a.type !== 'air' || a.acted) return null;
  const enemy = (o: string) => atWar(s, a.owner, o);
  const zone = !!SEA[target];
  const victims = s.units.filter((u) => u.at === target && enemy(u.owner) && u.type === (zone ? 'fleet' : 'army'));
  if (!victims.length) return null;
  const power = a.str * airMul(s, a.owner);
  // enemy fighters near the target intercept
  const interceptors = s.units.filter((u) => u.type === 'air' && enemy(u.owner) && airReach(u.at).has(zone ? a.at : target));
  const intercept = interceptors.reduce((sum, u) => sum + u.str * airMul(s, u.owner), 0);
  const victimOwner = victims[0].owner;
  const aa = victimOwner === s.player ? upg(s, 'aa') : 0;
  const dmg = Math.round(Math.max(0, power * 1.1 - intercept * 0.6) * (1 - aa));
  const before = victims.filter((v) => v.type === 'fleet').length;
  hurt(s, victims, dmg);
  const lost = Math.round(1 + intercept * 0.15 + power * 0.05);
  a.str = Math.max(0, a.str - lost);
  hurt(s, interceptors, power * 0.1);
  a.acted = true;
  if (a.owner === s.player) {
    s.stats.airStrikes++;
    s.stats.fleetsSunk += before - victims.filter((v) => v.str > 0 && v.type === 'fleet').length;
  }
  cleanup(s);
  return { dmg, lost };
}

// ---------- fleets ----------

export const fleetMoves = (f: Unit) => SEA[f.at]?.nb ?? [];

/** Sails to a neighbouring zone; meeting an enemy fleet there means a battle. */
export function moveFleet(s: GameState, f: Unit, zone: string): { battle: boolean; won: boolean } {
  if (f.type !== 'fleet' || f.acted || !fleetMoves(f).includes(zone)) return { battle: false, won: false };
  f.at = zone;
  f.acted = true;
  const hostile = s.units.some((u) => u.type === 'fleet' && u.at === zone && atWar(s, f.owner, u.owner));
  if (!hostile) return { battle: false, won: false };
  return { battle: true, won: navalBattle(s, zone, f.owner) };
}

export function navalBattle(s: GameState, zone: string, side: string): boolean {
  const mine = s.units.filter((u) => u.type === 'fleet' && u.at === zone && friends(s, side, u.owner));
  const theirs = s.units.filter((u) => u.type === 'fleet' && u.at === zone && atWar(s, side, u.owner));
  const A = mine.reduce((x, u) => x + u.str * fleetMul(s, u.owner), 0);
  const B = theirs.reduce((x, u) => x + u.str * fleetMul(s, u.owner), 0);
  const won = Math.random() < A * A / (A * A + B * B || 1);
  const [winners, losers, lw] = won ? [mine, theirs, B] : [theirs, mine, A];
  for (const u of losers) u.str = Math.round(u.str * 0.4);
  hurt(s, winners, lw * 0.25);
  let sunk = 0;
  for (const u of losers) {
    if (u.str < 3) { u.str = 0; sunk++; continue; }
    const safe = (SEA[zone]?.nb ?? []).find((z) => !s.units.some((x) => x.type === 'fleet' && x.at === z && atWar(s, u.owner, x.owner)));
    if (safe) u.at = safe; else { u.str = 0; sunk++; }
  }
  const playerWon = won ? friends(s, side, s.player) : theirs.some((u) => u.owner === s.player);
  if (playerWon) s.stats.fleetsSunk += sunk;
  cleanup(s);
  return won;
}

// ---------- capitals ----------

/** Capitals (own or captured) and the country's own big centres keep it standing. */
export const keyRegions = (s: GameState, n: string) =>
  ownedBy(s, n).filter((r) => REGION[r].capital || (REGION[r].c === n && REGION[r].kind === 'hub'));

export function updateCapitals(s: GameState) {
  for (const c of COUNTRIES) {
    const n = c.code;
    if (!alive(s, n)) { delete s.keyless[n]; continue; }
    const cur = s.capital[n];
    const original = CAPITAL[n];
    if (cur && s.owner[cur] === n && (cur === original || s.owner[original] !== n)) { s.keyless[n] = 0; continue; }
    const keys = keyRegions(s, n);
    if (keys.length) {
      const pick = keys.includes(original) ? original
        : [...keys].sort((x, y) => Number(REGION[y].c === n) - Number(REGION[x].c === n) || REGION[y].eco - REGION[x].eco)[0];
      if (pick !== cur) {
        s.capital[n] = pick;
        if (n === s.player) {
          if (pick === original && cur) { s.stats.capitalRetaken++; log(s, `Столица снова в ${regionTitle(pick)}`, 'good'); }
          else log(s, `Правительство переехало: ${regionTitle(pick)}`, 'bad');
        }
      }
      s.keyless[n] = 0;
    } else {
      s.capital[n] = null;
      s.keyless[n] = (s.keyless[n] ?? 0) + 1;
      const left = CAPITULATE_AFTER - s.keyless[n];
      if (left <= 0) capitulate(s, n);
      else if (n === s.player) log(s, `Ключевых областей не осталось. Капитуляция через ${left} ход.`, 'bad');
    }
  }
}

export function capitulate(s: GameState, n: string) {
  const counts = new Map<string, number>();
  for (const r of Object.keys(s.owner)) {
    if (REGION[r].c === n && s.owner[r] !== n) counts.set(s.owner[r], (counts.get(s.owner[r]) ?? 0) + 1);
  }
  const enemies = enemiesOf(s, n);
  const winner = [...counts].sort((a, b) => Number(enemies.includes(b[0])) - Number(enemies.includes(a[0])) || b[1] - a[1])[0]?.[0]
    ?? enemies[0];
  if (winner) for (const r of ownedBy(s, n)) transfer(s, r, winner);
  wipe(s, n);
  if (n === s.player) {
    s.lost = true;
    s.endReason = 'capitulation';
    log(s, 'Мы капитулировали', 'bad');
  } else if (winner) {
    log(s, `${name(n)} капитулирует → ${name(winner)}`, winner === s.player ? 'good' : 'info');
    if (winner === s.player) shiftParty(s.parties[s.player], 'nat', 2);
  }
}

// ---------- occupation ----------

/** Occupied land grows restless; armies on the spot keep order. At 100% it rises up. */
export function updateUnrest(s: GameState) {
  for (const r of Object.keys(s.owner)) {
    const o = s.owner[r];
    const core = REGION[r].c;
    if (o === core || integrated(s, r)) { delete s.unrest[r]; continue; }
    const stab = o === s.player ? s.stability : 55;
    let grow = 4 + Math.max(0, 50 - stab) / 5;
    if (armiesAt(s, r, o).length) grow -= 10;
    if (!alive(s, core)) grow -= 1;
    s.unrest[r] = clamp(Math.round((s.unrest[r] ?? 10) + grow), 0, 100);
    if (s.unrest[r] >= 100) revolt(s, r);
  }
}

function revolt(s: GameState, r: string) {
  const o = s.owner[r];
  const core = REGION[r].c;
  const reborn = !alive(s, core);
  if (reborn) {
    s.ai[core] = { money: 60, calmUntil: s.turn };
    s.capital[core] = r;
  }
  evacuate(s, r, o);
  transfer(s, r, core);
  s.heldSince[r] = 0;
  addUnit(s, core, 'army', 6 + REGION[r].men * 3, r);
  if (!atWar(s, core, o) && !friends(s, core, o)) s.wars.push({ a: core, b: o, since: s.turn, taken: {} });
  const where = regionTitle(r);
  if (o === s.player) log(s, `Восстание: ${where} уходит к ${name(core)}`, 'bad');
  else if (core === s.player) log(s, `Восстание вернуло нам ${where}`, 'good');
  else log(s, `Восстание: ${where} ${reborn ? `— ${name(core)} снова существует` : `возвращается к ${name(core)}`}`, 'info');
}

/** What a region yields to its holder: half until it is integrated. */
export const yieldShare = (s: GameState, r: string) => (integrated(s, r) ? 1 : 0.5);

export { unitsOf };
