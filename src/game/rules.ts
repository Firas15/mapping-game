import { COUNTRIES, COUNTRY, PARTIES, PARTY_ORDER, type PartyId } from '../data/countries';
import { land, sea } from './graph';
import { drawHand } from './cards';
import {
  type GameState, type Parties, ELECTION_EVERY, MAX_ATTACKS, fx, isWinter, owned, playerRuling, topParty,
} from './state';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const log = (s: GameState, text: string, tone: 'good' | 'bad' | 'info' = 'info') => {
  s.log.unshift({ turn: s.turn, text, tone });
  s.log.length = Math.min(s.log.length, 40);
};

// ---------- economy ----------

export const RECRUIT_SIZE = 10;
export const recruitCost = (s: GameState) => Math.round(100 * (1 + (fx(s.player).armyCostMul ?? 0)));
export const upkeep = (s: GameState) => Math.round(s.army * 0.25);
export const stabilityFactor = (s: GameState) => 0.5 + s.stability / 200;

export function incomeMul(s: GameState) {
  return 1 + (fx(s.player).incomeMul ?? 0) + s.bonus.incomeMul + (playerRuling(s) === 'soc' ? 0.1 : 0);
}

/** Income before upkeep and one-turn modifiers. */
export function grossIncome(s: GameState) {
  const base = owned(s).reduce((sum, c) => sum + COUNTRY[c].eco, 0) + (fx(s.player).flatIncome ?? 0);
  return Math.round(base * incomeMul(s) * stabilityFactor(s));
}
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

/** How the player can reach a territory, if at all. */
export function front(s: GameState, target: string): Front {
  if (s.owner[target] === s.player) return null;
  const mine = owned(s);
  if (mine.some((c) => land.get(c)?.has(target))) return 'land';
  if (mine.some((c) => sea.get(c)?.has(target))) return 'sea';
  return null;
}

export function attackPower(s: GameState, f: Front) {
  const seaPenalty = f === 'sea' && !fx(s.player).seaMaster ? 0.75 : 1;
  const mul = 1 + (fx(s.player).attackMul ?? 0) + s.bonus.attackMul + (playerRuling(s) === 'nat' ? 0.15 : 0);
  return s.army * mul * seaPenalty;
}

export function defensePower(s: GameState, target: string) {
  const e = fx(target);
  const mul = 1 + (e.defenseMul ?? 0) + (isWinter(s.turn) ? e.winterDefenseMul ?? 0 : 0);
  return Math.max(1, s.garrison[target] * mul);
}

export function winChance(s: GameState, target: string) {
  const f = front(s, target);
  if (!f) return 0;
  const a = attackPower(s, f) ** 2;
  const d = defensePower(s, target) ** 2;
  return clamp(Math.round((a / (a + d)) * 100), 3, 97);
}

export function attack(s: GameState, target: string, roll = Math.random()): 'win' | 'loss' | null {
  if (!front(s, target) || s.attacksLeft <= 0 || s.army < 5) return null;
  const name = COUNTRY[target].name;
  const chance = winChance(s, target);
  const def = defensePower(s, target);
  s.attacksLeft--;
  const warWeariness = (playerRuling(s) === 'dem' ? 3 : 0) + (fx(target).aggressorStability ?? 0);
  if (roll * 100 < chance) {
    s.owner[target] = s.player;
    s.garrison[target] = 0;
    s.army = Math.max(0, s.army - Math.round(def * 0.35));
    s.stability = clamp(s.stability - 4 - warWeariness, 0, 100);
    shiftParty(s.parties[s.player], 'nat', 3);
    log(s, `Захвачено: ${name}`, 'good');
    if (owned(s).length === COUNTRIES.length) {
      s.won = true;
      log(s, 'Вся Европа под вашим контролем!', 'good');
    }
    return 'win';
  }
  s.army = Math.max(0, s.army - Math.round(Math.min(s.army, def * 0.5)));
  s.garrison[target] = Math.max(1, Math.round(s.garrison[target] - s.army * 0.15));
  s.stability = clamp(s.stability - 2 - warWeariness, 0, 100);
  log(s, `Атака отбита: ${name}`, 'bad');
  return 'loss';
}

/** Peaceful annexation for influence. Works only on independent countries. */
export const annexCost = (s: GameState, target: string) =>
  Math.round(12 + s.garrison[target] * 0.8 + COUNTRY[target].eco * 0.4);

export function canAnnex(s: GameState, target: string) {
  return front(s, target) !== null && s.owner[target] === target && s.influence >= annexCost(s, target);
}

export function annex(s: GameState, target: string) {
  if (!canAnnex(s, target)) return false;
  s.influence -= annexCost(s, target);
  s.owner[target] = s.player;
  s.garrison[target] = 0;
  s.stability = clamp(s.stability - 2, 0, 100);
  shiftParty(s.parties[s.player], 'dem', 2);
  log(s, `Мирно присоединено: ${COUNTRY[target].name}`, 'good');
  if (owned(s).length === COUNTRIES.length) s.won = true;
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

function holdElections(s: GameState) {
  for (const code of Object.keys(s.parties)) {
    const before = s.ruling[code];
    s.ruling[code] = topParty(s.parties[code]);
    if (code === s.player && before !== s.ruling[code]) {
      log(s, `Выборы: к власти пришли ${PARTIES[s.ruling[code]].name.toLowerCase()}`, 'info');
    } else if (code === s.player) {
      log(s, `Выборы: ${PARTIES[before].name.toLowerCase()} сохранили власть`, 'info');
    }
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
    if (s.owner[x.code] !== s.player) s.garrison[x.code] = Math.min(Math.round(x.army * 1.4), s.garrison[x.code] + 1);
    // quiet drift of public opinion
    const p = s.parties[x.code];
    shiftParty(p, PARTY_ORDER[Math.floor(Math.random() * 4)], Math.random() * 2);
  }
  // unrest pushes people to the extremes
  if (s.stability < 35) shiftParty(s.parties[s.player], Math.random() < 0.5 ? 'nat' : 'soc', 2);

  s.turn++;
  if (s.turn >= s.nextElection) holdElections(s);
  s.attacksLeft = MAX_ATTACKS;
  s.turnIncomeMul = 1;
  s.played = null;
  s.hand = drawHand();
  return income;
}

export { holdElections };
