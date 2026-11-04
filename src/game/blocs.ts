import { COUNTRIES, COUNTRY, PARTIES, type PartyId } from '../data/countries';
import { REGION } from '../data/regions';
import { DIFFICULTY, type GameState, alive, ownedBy, strOf } from './state';
import { land } from './graph';
import { atWar, blocOf, declareWar, friends, inTruce } from './war';
import { relation } from './diplomacy';
import { log } from './log';
import { affinity } from '../data/affinity';

const BLOC_NAMES: Record<PartyId, string> = {
  dem: 'Демократический союз',
  con: 'Консервативный пакт',
  soc: 'Социалистический блок',
  nat: 'Националистический фронт',
};

/** Countries whose land touches. */
export function bordering(s: GameState, a: string, b: string) {
  return ownedBy(s, a).some((r) => [...(land.get(r) ?? [])].some((n) => s.owner[n] === b));
}
export const power = (s: GameState, n: string) =>
  strOf(s, n, 'army') + strOf(s, n, 'fleet') * 1.3 + strOf(s, n, 'air') * 1.5;

/** Every few turns like-minded computer countries band together. Members defend each other. */
export function updateBlocs(s: GameState) {
  // members whose government changed leave
  for (const b of s.blocs) {
    b.members = b.members.filter((m) => alive(s, m) && (m === s.player ? s.ruling[m] === b.party : s.ruling[m] === b.party));
  }
  s.blocs = s.blocs.filter((b) => b.members.length >= 2);
  if (s.turn < 5 || s.turn % 4 !== 0 || s.blocs.length >= 3) return;

  const free = COUNTRIES.map((c) => c.code)
    .filter((n) => n !== s.player && alive(s, n) && !blocOf(s, n))
    .sort((a, b) => power(s, b) - power(s, a));
  for (const leader of free) {
    if (s.blocs.some((b) => b.party === s.ruling[leader])) continue;
    if (ownedBy(s, leader).length < 3) continue;
    const party = s.ruling[leader];
    const members = [leader];
    for (const n of free) {
      if (members.length >= 5 || members.includes(n)) continue;
      // like-minded governments on good terms, or close friends whatever their politics
      const aff = Math.min(...members.map((m) => affinity(m, n)));
      if (!((s.ruling[n] === party && aff >= 0) || aff >= 45)) continue;
      if (members.some((m) => atWar(s, m, n))) continue;
      if (!members.some((m) => bordering(s, m, n))) continue;
      members.push(n);
    }
    if (members.length < 2) continue;
    s.blocs.push({ id: `b${s.turn}-${leader}`, name: BLOC_NAMES[party], party, members });
    log(s, `Создан ${BLOC_NAMES[party]}: ${members.map((m) => COUNTRY[m].name).join(', ')}`, 'info');
    return;
  }
}

/** The player can join a bloc of the same politics if its leader likes them. */
export function cantJoin(s: GameState, blocId: string): string | null {
  const b = s.blocs.find((x) => x.id === blocId);
  if (!b) return 'Блока больше нет';
  if (b.members.includes(s.player)) return 'Вы уже в блоке';
  if (blocOf(s, s.player)) return 'Сначала выйдите из своего блока';
  if (s.ruling[s.player] !== b.party) return `Нужно, чтобы у власти были ${PARTIES[b.party].name.toLowerCase()}`;
  if (relation(s, b.members[0]) < 30) return `Нужны отношения с ${COUNTRY[b.members[0]].name} от +30`;
  if (b.members.some((m) => atWar(s, s.player, m))) return 'Вы воюете с участником блока';
  return null;
}

export function joinBloc(s: GameState, blocId: string) {
  if (cantJoin(s, blocId)) return false;
  const b = s.blocs.find((x) => x.id === blocId)!;
  b.members.push(s.player);
  for (const m of b.members) if (m !== s.player && !s.allies.includes(m)) s.allies.push(m);
  log(s, `Мы вступили: ${b.name}`, 'good');
  return true;
}

export function leaveBloc(s: GameState) {
  const b = blocOf(s, s.player);
  if (!b) return false;
  b.members = b.members.filter((m) => m !== s.player);
  s.allies = s.allies.filter((a) => !b.members.includes(a));
  log(s, `Мы вышли из блока: ${b.name}`, 'bad');
  return true;
}

/** When the player grows too big, wary neighbours gang up on them. */
export function checkCoalition(s: GameState) {
  if (s.coalitionFormed) return;
  const share = ownedBy(s, s.player).length / Object.keys(REGION).length;
  if (share < DIFFICULTY[s.settings.difficulty].coalition) return;
  const members = COUNTRIES.map((c) => c.code)
    .filter((n) => n !== s.player && alive(s, n) && !friends(s, n, s.player) && relation(s, n) < 20 && !inTruce(s, n, s.player))
    .filter((n) => bordering(s, n, s.player) || power(s, n) > 80)
    .sort((a, b) => power(s, b) - power(s, a))
    .slice(0, 6);
  if (members.length < 2) return;
  s.coalitionFormed = true;
  s.coalition = members;
  for (const m of members) if (!atWar(s, m, s.player)) declareWar(s, m, s.player);
  s.notice = {
    title: 'Против вас коалиция',
    text: `Вы стали слишком сильны. ${members.map((m) => COUNTRY[m].name).join(', ')} объединились и объявили вам войну. Их армии на 10% сильнее в боях с вами.`,
    tone: 'bad',
  };
}
