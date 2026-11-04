import { COUNTRIES, COUNTRY, PARTIES, PARTY_ORDER, type PartyId } from '../data/countries';
import { REGION, REGIONS, regionTitle } from '../data/regions';
import { drawHand } from './cards';
import { aiTurn } from './ai';
import { rollEvents } from './events';
import { upg } from './upgrades';
import { driftRelations, isAlly } from './diplomacy';
import {
  DIFFICULTY, ELECTION_EVERY, SHORT_TURNS, type GameState, type Parties, type Unit, alive, fx, owned, ownedBy,
  playerRuling, topParty, unitsOf,
} from './state';
import { clamp, log } from './log';
import {
  type BattleResult, type PeaceTerms, atWar, canAttackRegion, landBattle, mergeAll, transfer, updateCapitals, updateUnrest, warOf, yieldShare,
} from './war';
import { armyTotal, draft, draftCap, reinforce, removeTroops, upkeepOf } from './units';
import { progressFocus } from './focus';
import { bordering, checkCoalition, updateBlocs } from './blocs';
import { checkAchievements, rankOf, recordHistory } from './stats';

export { clamp, log };

// ---------- economy ----------

export const stabilityFactor = (s: GameState) => 0.5 + s.stability / 200;

export function incomeMul(s: GameState) {
  return 1 + (fx(s.player).incomeMul ?? 0) + s.nb[s.player].incomeMul + upg(s, 'incomeMul') + (playerRuling(s) === 'soc' ? 0.1 : 0);
}

/** Money a country's land brings before modifiers. Occupied land gives half until integrated. */
export const baseIncome = (s: GameState, n: string) =>
  ownedBy(s, n).reduce((sum, r) => sum + REGION[r].eco * yieldShare(s, r), 0) + (fx(n).flatIncome ?? 0);

/** Player income before upkeep and one-turn modifiers. */
export const grossIncome = (s: GameState) => Math.round(baseIncome(s, s.player) * incomeMul(s) * stabilityFactor(s));
export const netIncome = (s: GameState) => Math.round(grossIncome(s) * s.turnIncomeMul) - upkeepOf(s, s.player);

/** Income of any country, comparable between player and computer. */
export function incomeOf(s: GameState, n: string) {
  if (n === s.player) return grossIncome(s);
  const mul = (1 + (fx(n).incomeMul ?? 0) + s.nb[n].incomeMul) * 0.85 * DIFFICULTY[s.settings.difficulty].aiIncome;
  return Math.round(baseIncome(s, n) * mul);
}

export function influenceGain(s: GameState) {
  const r = playerRuling(s);
  return 1 + (fx(s.player).influence ?? 0) + upg(s, 'influence') + s.nb[s.player].influence
    + (r === 'dem' ? 2 : 0) - (r === 'nat' ? 1 : 0);
}

// ---------- player's war ----------

/** Player army attacks a region of a country already at war with us. */
export function playerAttack(s: GameState, u: Unit, to: string, join: number[] = []): BattleResult | null {
  const target = s.owner[to];
  if (!atWar(s, s.player, target) || !canAttackRegion(s, u, to)) return null;
  const title = regionTitle(to);
  const r = landBattle(s, u, to, Math.random(), join);
  if (r.won) {
    s.stability = clamp(s.stability - 1 - (playerRuling(s) === 'dem' ? 1 : 0) - (fx(REGION[to].c).aggressorStability ? 5 : 0), 0, 100);
    shiftParty(s.parties[s.player], 'nat', 2);
    log(s, `Взято: ${title}`, 'good');
    if (r.eliminated) log(s, `${COUNTRY[r.defender].name} больше не существует`, 'good');
    else if (r.capital) log(s, `Пала столица: ${COUNTRY[r.defender].name}`, 'good');
  } else {
    s.stability = clamp(s.stability - 1, 0, 100);
    log(s, `Атака отбита: ${title}`, 'bad');
  }
  checkWin(s);
  checkAchievements(s);
  return r;
}

// ---------- peace ----------

/** How the war with `n` is going for the player: positive means winning. */
export function warScore(s: GameState, n: string) {
  const w = warOf(s, s.player, n);
  if (!w) return { score: 0, taken: 0, lost: 0 };
  const taken = Object.keys(s.owner).filter((r) => s.owner[r] === s.player && (REGION[r].c === n || w.taken[r] === n)).length;
  const lost = Object.keys(s.owner).filter((r) => s.owner[r] === n && (REGION[r].c === s.player || w.taken[r] === s.player)).length;
  const theirs = REGIONS.filter((r) => r.c === n).length;
  const mine = REGIONS.filter((r) => r.c === s.player).length;
  const ratio = armyTotal(s, s.player) / (armyTotal(s, n) + 1);
  const score = (taken / Math.max(1, theirs)) * 100 - (lost / Math.max(1, mine)) * 100
    + clamp((ratio - 1) * 15, -20, 20) + Math.min(20, (s.turn - w.since) * 2);
  return { score: Math.round(score), taken, lost };
}

/** Will the enemy sign these terms? */
export function peaceAnswer(s: GameState, n: string, terms: PeaceTerms): { ok: boolean; why: string } {
  const { score, taken, lost } = warScore(s, n);
  if (terms === 'white') {
    return score >= 0 || (taken === 0 && lost === 0)
      ? { ok: true, why: 'Согласятся вернуть всё как было' }
      : { ok: false, why: 'Откажутся: они побеждают' };
  }
  if (terms === 'keep') {
    if (taken <= lost) return { ok: true, why: 'Согласятся: им это выгодно' };
    return score >= 20 ? { ok: true, why: 'Согласятся отдать занятое' } : { ok: false, why: 'Откажутся: вы взяли слишком мало' };
  }
  return score >= 40 ? { ok: true, why: 'Согласятся заплатить' } : { ok: false, why: 'Откажутся: нужен перевес побольше' };
}

// ---------- peaceful annexation ----------

export const annexCost = (s: GameState, nation: string) => {
  const eco = ownedBy(s, nation).reduce((sum, r) => sum + REGION[r].eco, 0);
  const base = 12 + armyTotal(s, nation) * 0.6 + eco * 0.4;
  const mood = 1 - (s.relations[nation] ?? 0) / 200;
  const ally = isAlly(s, nation) ? 0.5 : 1;
  return Math.round(base * mood * ally * (1 + upg(s, 'annexMul')));
};

/** A country at peace with us that still has its capital: allies anywhere, others if they border us. */
export function cantAnnex(s: GameState, nation: string): string | null {
  if (nation === s.player || !alive(s, nation)) return 'Нельзя';
  if (atWar(s, s.player, nation)) return 'Сначала заключите мир';
  const cap = s.capital[nation];
  if (!cap || s.owner[cap] !== nation) return 'У страны нет столицы';
  if (!isAlly(s, nation) && !bordering(s, s.player, nation)) return 'Нужна общая граница или союз';
  if (s.influence < annexCost(s, nation)) return `Нужно ${annexCost(s, nation)} влияния`;
  return null;
}

export function annex(s: GameState, nation: string) {
  if (cantAnnex(s, nation)) return false;
  s.influence -= annexCost(s, nation);
  s.allies = s.allies.filter((a) => a !== nation);
  const lands = ownedBy(s, nation);
  for (const r of lands) transfer(s, r, s.player);
  for (const r of lands) { s.heldSince[r] = s.turn - 6; delete s.unrest[r]; } // a peaceful union settles faster
  // half their forces join ours
  for (const u of unitsOf(s, nation)) { u.owner = s.player; u.str = Math.max(1, Math.round(u.str * 0.5)); }
  s.capital[nation] = null;
  for (const b of s.blocs) b.members = b.members.filter((m) => m !== nation);
  s.stability = clamp(s.stability - 2, 0, 100);
  shiftParty(s.parties[s.player], 'dem', 2);
  s.stats.annexed++;
  log(s, `Мирно присоединена: ${COUNTRY[nation].name}`, 'good');
  checkWin(s);
  checkAchievements(s);
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

// ---------- end of game ----------

export function checkWin(s: GameState) {
  if (s.won || s.lost) return;
  if (owned(s).length === REGIONS.length) {
    s.won = true;
    s.endReason = 'unified';
    return;
  }
  if (s.settings.short && s.turn > SHORT_TURNS) {
    if (rankOf(s, 'land') === 1) { s.won = true; s.endReason = 'short-win'; }
    else { s.lost = true; s.endReason = 'short-lose'; }
  }
}

// ---------- turn ----------

export function endTurn(s: GameState) {
  const income = netIncome(s);
  s.money += income;
  if (s.money < 0) {
    // unpaid soldiers desert
    const lost = Math.ceil(-s.money / 5);
    removeTroops(s, s.player, lost);
    s.money = 0;
    s.stability = clamp(s.stability - 5, 0, 100);
    log(s, `Нечем платить армии: дезертировали ${lost}`, 'bad');
  }
  const total = armyTotal(s, s.player);
  const cap = draftCap(s, s.player);
  if (total < cap) reinforce(s, s.player, Math.min(draft(s, s.player), cap - total));

  const e = fx(s.player);
  let stab = (e.stability ?? 0) + upg(s, 'stability') + s.nb[s.player].stability + (playerRuling(s) === 'con' ? 1 : 0);
  if (s.stability < 50) stab += 1;
  else if (s.stability > 80) stab -= 1;
  // long wars tire a democracy
  if (playerRuling(s) === 'dem' && s.wars.some((w) => w.a === s.player || w.b === s.player)) stab -= 1;
  s.stability = clamp(s.stability + stab, 0, 100);
  s.influence = Math.max(0, s.influence + influenceGain(s));

  for (const x of COUNTRIES) shiftParty(s.parties[x.code], PARTY_ORDER[Math.floor(Math.random() * 4)], Math.random() * 2);
  if (s.stability < 35) shiftParty(s.parties[s.player], Math.random() < 0.5 ? 'nat' : 'soc', 2);

  s.turn++;
  for (const u of s.units) u.acted = false;
  aiTurn(s);
  mergeAll(s);
  updateUnrest(s);
  updateCapitals(s);
  if (!s.lost && owned(s).length === 0) {
    s.lost = true;
    s.endReason = 'conquered';
    log(s, 'Наша страна пала', 'bad');
  }
  progressFocus(s, (c) => alive(s, c));
  if (s.turn >= s.nextElection) holdElections(s);
  driftRelations(s);
  updateBlocs(s);
  checkCoalition(s);

  for (const u of s.units) u.acted = false;
  s.turnIncomeMul = 1;
  s.played = null;
  s.hand = drawHand();
  if (!s.lost) rollEvents(s);
  recordHistory(s);
  checkWin(s);
  checkAchievements(s);
  return income;
}
