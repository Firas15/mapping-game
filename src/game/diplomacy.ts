import { COUNTRIES, COUNTRY } from '../data/countries';
import { type GameState, alive, armyOf } from './state';
import { frontOf, log } from './rules';

export const ALLY_MIN = 50;
export const IMPROVE_STEP = 15;
export const ALLIANCE_COST = 10;
/** Share of an ally's army sent to a battle next to its border. */
export const ALLY_HELP = 0.25;

export const relation = (s: GameState, nation: string) => s.relations?.[nation] ?? 0;
export const isAlly = (s: GameState, nation: string) => !!s.allies?.includes(nation);

export function relationLabel(s: GameState, nation: string): { text: string; tone: 'good' | 'mid' | 'bad' } {
  if (isAlly(s, nation)) return { text: 'Союзник', tone: 'good' };
  const r = relation(s, nation);
  if (r <= -40) return { text: 'Враждебные', tone: 'bad' };
  if (r < -10) return { text: 'Холодные', tone: 'bad' };
  if (r < 20) return { text: 'Нейтральные', tone: 'mid' };
  return { text: 'Дружеские', tone: 'good' };
}

export function changeRelation(s: GameState, nation: string, delta: number) {
  s.relations ??= {};
  s.relations[nation] = Math.max(-100, Math.min(100, Math.round(relation(s, nation) + delta)));
  // an ally pushed too far walks away
  if (isAlly(s, nation) && s.relations[nation] < 20) {
    s.allies = s.allies!.filter((a) => a !== nation);
    log(s, `${COUNTRY[nation].name} разрывает союз с вами`, 'bad');
  }
}

/** Better relations cost more when they are bad to begin with. */
export const improveCost = (s: GameState, nation: string) => 5 + Math.round(Math.max(0, -relation(s, nation)) / 10);

export function improveRelations(s: GameState, nation: string) {
  const cost = improveCost(s, nation);
  if (s.influence < cost || isAlly(s, nation) || relation(s, nation) >= 100) return false;
  s.influence -= cost;
  changeRelation(s, nation, IMPROVE_STEP);
  return true;
}

export function canAlly(s: GameState, nation: string) {
  return alive(s, nation) && !isAlly(s, nation) && relation(s, nation) >= ALLY_MIN && s.influence >= ALLIANCE_COST;
}

export function proposeAlliance(s: GameState, nation: string) {
  if (!canAlly(s, nation)) return false;
  s.influence -= ALLIANCE_COST;
  (s.allies ??= []).push(nation);
  log(s, `Заключён союз: ${COUNTRY[nation].name}`, 'good');
  return true;
}

export function breakAlliance(s: GameState, nation: string) {
  if (!isAlly(s, nation)) return false;
  s.allies = s.allies!.filter((a) => a !== nation);
  s.relations![nation] = Math.min(relation(s, nation), 0) - 20;
  log(s, `Вы разорвали союз: ${COUNTRY[nation].name}`, 'bad');
  return true;
}

/** Allies that border the battlefield send part of their army. */
export function allyHelp(s: GameState, target: string) {
  let sum = 0;
  for (const a of s.allies ?? []) {
    if (!alive(s, a) || s.owner[target] === a) continue;
    if (frontOf(s, a, target)) sum += armyOf(s, a) * ALLY_HELP;
  }
  return sum;
}

/** Everyone remembers who started the war. */
export function onPlayerAttack(s: GameState, victim: string) {
  for (const c of COUNTRIES) {
    if (c.code === s.player || !alive(s, c.code)) continue;
    changeRelation(s, c.code, c.code === victim ? -40 : -3);
  }
}

export function driftRelations(s: GameState) {
  s.allies = (s.allies ?? []).filter((a) => alive(s, a));
  for (const c of COUNTRIES) {
    const n = c.code;
    if (n === s.player || !alive(s, n) || isAlly(s, n)) continue;
    const r = relation(s, n);
    if (s.ruling[n] === s.ruling[s.player] && r < 40) changeRelation(s, n, 1);
    else if (r > 0) changeRelation(s, n, -1);
    else if (r < 0) changeRelation(s, n, 1);
  }
}
