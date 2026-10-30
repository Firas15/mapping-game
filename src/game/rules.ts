import { COUNTRIES, COUNTRY, PARTIES, PARTY_ORDER, type PartyId } from '../data/countries';
import { land, sea } from './graph';
import { drawHand } from './cards';
import { aiTurn } from './ai';
import {
  type GameState, type Parties, ELECTION_EVERY, HOME_BONUS, MAX_ATTACKS, addArmy, alive, armyOf, fx, isWinter, owned,
  ownedBy, playerRuling, topParty,
} from './state';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const log = (s: GameState, text: string, tone: 'good' | 'bad' | 'info' = 'info') => {
  s.log.unshift({ turn: s.turn, text, tone });
  s.log.length = Math.min(s.log.length, 40);
};

// ---------- economy ----------

export const RECRUIT_SIZE = 10;
export const recruitCostOf = (nation: string) => Math.round(100 * (1 + (fx(nation).armyCostMul ?? 0)));
export const recruitCost = (s: GameState) => recruitCostOf(s.player);
export const upkeepOf = (army: number) => Math.round(army * 0.25);
export const upkeep = (s: GameState) => upkeepOf(s.army);
export const stabilityFactor = (s: GameState) => 0.5 + s.stability / 200;

export function incomeMul(s: GameState) {
  return 1 + (fx(s.player).incomeMul ?? 0) + s.bonus.incomeMul + (playerRuling(s) === 'soc' ? 0.1 : 0);
}

/** Money a nation's land brings before modifiers. */
export const baseIncome = (s: GameState, nation: string) =>
  ownedBy(s, nation).reduce((sum, c) => sum + COUNTRY[c].eco, 0) + (fx(nation).flatIncome ?? 0);

/** Player income before upkeep and one-turn modifiers. */
export const grossIncome = (s: GameState) => Math.round(baseIncome(s, s.player) * incomeMul(s) * stabilityFactor(s));
export const netIncome = (s: GameState) => Math.round(grossIncome(s) * s.turnIncomeMul) - upkeep(s);

export function influenceGain(s: GameState) {
  const r = playerRuling(s);
  return 1 + (fx(s.player).influence ?? 0) + (r === 'dem' ? 2 : 0) - (r === 'nat' ? 1 : 0);
}

export function recruit(s: GameState): boolean {
  const cost = recruitCost(s);
  if (s.money < cost) return false;
  s.money -= cost;
  s.army += RECRUIT_SIZE;
  return true;
}

// ---------- war ----------

export type Front = 'land' | 'sea' | null;

/** How a nation can reach a territory, if at all. */
export function frontOf(s: GameState, attacker: string, target: string): Front {
  if (s.owner[target] === attacker) return null;
  const mine = ownedBy(s, attacker);
  if (mine.some((c) => land.get(c)?.has(target))) return 'land';
  if (mine.some((c) => sea.get(c)?.has(target))) return 'sea';
  return null;
}
export const front = (s: GameState, target: string) => frontOf(s, s.player, target);

export function attackPowerOf(s: GameState, attacker: string, f: Front) {
  const seaPenalty = f === 'sea' && !fx(attacker).seaMaster ? 0.75 : 1;
  const bonus = attacker === s.player ? s.bonus.attackMul : 0;
  const mul = 1 + (fx(attacker).attackMul ?? 0) + bonus + (s.ruling[attacker] === 'nat' ? 0.15 : 0);
  return armyOf(s, attacker) * mul * seaPenalty;
}
export const attackPower = (s: GameState, f: Front) => attackPowerOf(s, s.player, f);

/** The owner's whole army defends; the land itself (its trait, winter) helps. */
export function defensePower(s: GameState, target: string) {
  const owner = s.owner[target];
  const e = fx(target);
  const bonus = owner === s.player ? s.bonus.defenseMul : 0;
  const home = owner === target ? HOME_BONUS : 0;
  const mul = 1 + (e.defenseMul ?? 0) + (isWinter(s.turn) ? e.winterDefenseMul ?? 0 : 0) + bonus + home;
  return Math.max(1, armyOf(s, owner) * mul);
}

export function chanceOf(s: GameState, attacker: string, target: string) {
  const f = frontOf(s, attacker, target);
  if (!f) return 0;
  const a = attackPowerOf(s, attacker, f) ** 2;
  const d = defensePower(s, target) ** 2;
  return clamp(Math.round((a / (a + d)) * 100), 3, 97);
}
export const winChance = (s: GameState, target: string) => chanceOf(s, s.player, target);

/** Fights one battle and applies losses and the change of owner. */
export function battle(s: GameState, attacker: string, target: string, roll = Math.random()) {
  const defender = s.owner[target];
  const f = frontOf(s, attacker, target);
  const chance = chanceOf(s, attacker, target);
  const att = attackPowerOf(s, attacker, f);
  const def = defensePower(s, target);
  const won = roll * 100 < chance;
  if (won) {
    s.owner[target] = attacker;
    addArmy(s, attacker, -def * 0.3);
    addArmy(s, defender, -att * 0.25);
  } else {
    addArmy(s, attacker, -Math.min(armyOf(s, attacker), def * 0.5));
    addArmy(s, defender, -att * 0.15);
  }
  const eliminated = won && !alive(s, defender);
  if (eliminated && defender !== s.player) s.ai[defender].army = 0;
  return { won, defender, eliminated };
}

export function attack(s: GameState, target: string, roll = Math.random()): 'win' | 'loss' | null {
  if (!front(s, target) || s.attacksLeft <= 0 || s.army < 5) return null;
  const name = COUNTRY[target].name;
  s.attacksLeft--;
  const warWeariness = (playerRuling(s) === 'dem' ? 3 : 0) + (fx(target).aggressorStability ?? 0);
  const r = battle(s, s.player, target, roll);
  if (r.won) {
    s.stability = clamp(s.stability - 4 - warWeariness, 0, 100);
    shiftParty(s.parties[s.player], 'nat', 3);
    log(s, `Захвачено: ${name}`, 'good');
    if (r.eliminated && r.defender !== target) log(s, `${COUNTRY[r.defender].name} больше не существует`, 'good');
    checkWin(s);
    return 'win';
  }
  s.stability = clamp(s.stability - 2 - warWeariness, 0, 100);
  log(s, `Атака отбита: ${name}`, 'bad');
  return 'loss';
}

function checkWin(s: GameState) {
  if (owned(s).length === COUNTRIES.length) {
    s.won = true;
    log(s, 'Вся Европа под вашим контролем!', 'good');
  }
}

/** Peaceful annexation for influence: works on a country that still holds its own capital. */
export const annexCost = (s: GameState, target: string) => {
  const nation = s.owner[target];
  const eco = ownedBy(s, nation).reduce((sum, c) => sum + COUNTRY[c].eco, 0);
  return Math.round(12 + armyOf(s, nation) * 0.8 + eco * 0.4);
};

export function canAnnex(s: GameState, target: string) {
  return front(s, target) !== null && s.owner[target] === target && s.influence >= annexCost(s, target);
}

export function annex(s: GameState, target: string) {
  if (!canAnnex(s, target)) return false;
  s.influence -= annexCost(s, target);
  const lands = ownedBy(s, target);
  for (const c of lands) s.owner[c] = s.player;
  s.army += Math.round(s.ai[target].army * 0.5); // half their soldiers join
  s.ai[target].army = 0;
  s.stability = clamp(s.stability - 2, 0, 100);
  shiftParty(s.parties[s.player], 'dem', 2);
  log(s, `Мирно присоединено: ${lands.map((c) => COUNTRY[c].name).join(', ')}`, 'good');
  checkWin(s);
  return true;
}

// ---------- politics ----------

/** Adds points to one party and takes them evenly from the others. Keeps the sum at 100. */
export function shiftParty(p: Parties, party: PartyId, amount: number) {
  const i = PARTY_ORDER.indexOf(party);
  const add = Math.min(amount, 100 - p[i]);
  p[i] += add;
  let left = add;
  for (let guard = 0; left > 0.001 && guard < 10; guard++) {
    const others = p.map((v, k) => (k !== i && v > 0 ? k : -1)).filter((k) => k >= 0);
    const share = left / others.length;
    for (const k of others) {
      const take = Math.min(p[k], share);
      p[k] -= take;
      left -= take;
    }
  }
  normalize(p);
}

function normalize(p: Parties) {
  for (let k = 0; k < 4; k++) p[k] = Math.max(0, Math.round(p[k]));
  const diff = 100 - p.reduce((a, b) => a + b, 0);
  p[p.indexOf(Math.max(...p))] += diff;
}

export function holdElections(s: GameState) {
  for (const code of Object.keys(s.parties)) {
    const before = s.ruling[code];
    s.ruling[code] = topParty(s.parties[code]);
    if (code !== s.player) continue;
    if (before !== s.ruling[code]) log(s, `Выборы: к власти пришли ${PARTIES[s.ruling[code]].name.toLowerCase()}`, 'info');
    else log(s, `Выборы: ${PARTIES[before].name.toLowerCase()} сохранили власть`, 'info');
  }
  s.nextElection += ELECTION_EVERY;
}

// ---------- turn ----------

export function endTurn(s: GameState) {
  const income = netIncome(s);
  s.money += income;
  if (s.money < 0) {
    // unpaid soldiers desert
    const lost = Math.min(s.army, Math.ceil(-s.money / 5));
    s.army -= lost;
    s.money = 0;
    s.stability = clamp(s.stability - 5, 0, 100);
    log(s, `Нечем платить армии: дезертировало ${lost}`, 'bad');
  }

  const e = fx(s.player);
  let stab = (e.stability ?? 0) + (playerRuling(s) === 'con' ? 1 : 0);
  if (s.stability < 50) stab += 1;
  else if (s.stability > 80) stab -= 1;
  s.stability = clamp(s.stability + stab, 0, 100);
  s.influence = Math.max(0, s.influence + influenceGain(s));

  for (const x of COUNTRIES) {
    // quiet drift of public opinion
    shiftParty(s.parties[x.code], PARTY_ORDER[Math.floor(Math.random() * 4)], Math.random() * 2);
  }
  // unrest pushes people to the extremes
  if (s.stability < 35) shiftParty(s.parties[s.player], Math.random() < 0.5 ? 'nat' : 'soc', 2);

  s.turn++;
  aiTurn(s);
  if (owned(s).length === 0) {
    s.lost = true;
    log(s, 'Ваша страна пала', 'bad');
  }
  if (s.turn >= s.nextElection) holdElections(s);
  s.attacksLeft = MAX_ATTACKS;
  s.turnIncomeMul = 1;
  s.played = null;
  s.hand = drawHand();
  return income;
}
