import { REGION } from '../data/regions';
import { type Bonus, type GameState, addUnit, ownedBy } from './state';
import { changeRelation } from './diplomacy';
import { clamp, log } from './log';

/** National goals: pick one, it completes in a few turns and pays off for good. */
export interface FocusEffect {
  bonus?: Partial<Bonus>;
  money?: number;
  stability?: number;
  influence?: number;
  army?: number;
  fleet?: number;
  air?: number;
  /** better relations with these countries */
  friends?: string[];
}

export interface Focus {
  id: string;
  name: string;
  text: string;
  icon: string;
  turns: number;
  requires?: string;
  effect: FocusEffect;
}

const f = (id: string, name: string, text: string, icon: string, effect: FocusEffect, requires?: string, turns = 4): Focus =>
  ({ id, name, text, icon, turns, requires, effect });

/** Everyone can take these. */
const GENERIC: Focus[] = [
  f('g-industry', 'Индустриализация', '+10% к доходу', 'factory', { bonus: { incomeMul: 0.1 } }),
  f('g-army', 'Военная реформа', '+10% к атаке', 'swords', { bonus: { attackMul: 0.1 } }),
  f('g-forts', 'Пограничные укрепления', '+15% к обороне', 'castle', { bonus: { defenseMul: 0.15 } }),
  f('g-unity', 'Национальное единство', '+15 стабильности, +1 за ход', 'smile', { stability: 15, bonus: { stability: 1 } }),
  f('g-diplo', 'Дипломатический корпус', '+15 влияния, +1 за ход', 'handshake', { influence: 15, bonus: { influence: 1 } }),
  f('g-draft', 'Всеобщая воинская обязанность', '+30% к призыву', 'users', { bonus: { draftMul: 0.3 } }, 'g-army'),
  f('g-air', 'Военно-воздушные силы', 'Авиакрыло (15) в столице', 'target', { air: 15 }, 'g-army'),
  f('g-navy', 'Военный флот', 'Флот (15) у берега', 'dove', { fleet: 15 }),
  f('g-cb', 'Военная доктрина', 'Объявлять войну без потери стабильности', 'flag', { bonus: { casusBelli: 1 } }, 'g-army'),
];

/** Flavour for the big countries. */
const NATIONAL: Record<string, Focus[]> = {
  DE: [
    f('de-autobahn', 'Автобаны', '+15% к доходу', 'factory', { bonus: { incomeMul: 0.15 } }),
    f('de-panzer', 'Танковые дивизии', '+15% к атаке', 'swords', { bonus: { attackMul: 0.15 } }),
    f('de-luft', 'Люфтваффе', 'Два авиакрыла (15)', 'target', { air: 30 }, 'de-autobahn'),
    f('de-blitz', 'Блицкриг', 'Армия (25) в столице, войны без потери стабильности', 'flag', { army: 25, bonus: { casusBelli: 1 } }, 'de-panzer'),
  ],
  FR: [
    f('fr-maginot', 'Линия Мажино', '+25% к обороне', 'castle', { bonus: { defenseMul: 0.25 } }),
    f('fr-legion', 'Колониальные войска', 'Армия (20) в столице', 'users', { army: 20 }),
    f('fr-navy', 'Французский флот', 'Флот (20)', 'dove', { fleet: 20 }),
    f('fr-entente', 'Сердечное согласие', '+40 отношений с Британией и Бельгией, +10 влияния', 'handshake', { friends: ['GB', 'BE'], influence: 10 }),
  ],
  GB: [
    f('gb-navy', 'Королевский флот', 'Два флота (20), флоты на 20% сильнее', 'dove', { fleet: 40, bonus: { fleetMul: 0.2 } }),
    f('gb-raf', 'Королевские ВВС', 'Авиакрыло (20)', 'target', { air: 20 }),
    f('gb-city', 'Лондонский Сити', '+15% к доходу', 'bank', { bonus: { incomeMul: 0.15 } }),
    f('gb-balance', 'Баланс сил', '+2 влияния за ход', 'handshake', { bonus: { influence: 2 } }, 'gb-city'),
  ],
  IT: [
    f('it-mare', 'Средиземное море', 'Флот (20)', 'dove', { fleet: 20 }),
    f('it-north', 'Фабрики Севера', '+12% к доходу', 'factory', { bonus: { incomeMul: 0.12 } }),
    f('it-alpini', 'Альпийские стрелки', '+20% к обороне', 'castle', { bonus: { defenseMul: 0.2 } }),
    f('it-order', 'Новый порядок', '+15 стабильности, +10% к атаке', 'flag', { stability: 15, bonus: { attackMul: 0.1 } }, 'it-north'),
  ],
  RU: [
    f('ru-ural', 'Индустриализация Урала', '+15% к доходу', 'factory', { bonus: { incomeMul: 0.15 } }),
    f('ru-mass', 'Массовая армия', '+40% к призыву', 'users', { bonus: { draftMul: 0.4 } }),
    f('ru-depth', 'Глубокая оборона', '+25% к обороне', 'castle', { bonus: { defenseMul: 0.25 } }),
    f('ru-north', 'Северный флот', 'Флот (15)', 'dove', { fleet: 15 }),
    f('ru-air', 'Дальняя авиация', 'Авиакрыло (20)', 'target', { air: 20 }, 'ru-ural'),
  ],
  TR: [
    f('tr-straits', 'Контроль проливов', 'Флот (15), +15% к обороне', 'dove', { fleet: 15, bonus: { defenseMul: 0.15 } }),
    f('tr-army', 'Анатолийская армия', 'Армия (20)', 'users', { army: 20 }),
    f('tr-reform', 'Реформы', '+12% к доходу', 'factory', { bonus: { incomeMul: 0.12 } }),
    f('tr-hills', 'Горные крепости', '+20% к обороне', 'castle', { bonus: { defenseMul: 0.2 } }, 'tr-army'),
  ],
  ES: [
    f('es-armada', 'Армада', 'Флот (20)', 'dove', { fleet: 20 }),
    f('es-tourism', 'Туризм', '+15% к доходу', 'factory', { bonus: { incomeMul: 0.15 } }),
    f('es-legion', 'Иностранный легион', '+12% к атаке', 'swords', { bonus: { attackMul: 0.12 } }),
    f('es-iberia', 'Иберийский союз', '+50 отношений с Португалией', 'handshake', { friends: ['PT'], influence: 5 }),
  ],
  PL: [
    f('pl-hussars', 'Крылатые гусары', '+15% к атаке', 'swords', { bonus: { attackMul: 0.15 } }),
    f('pl-cop', 'Центральный промышленный район', '+12% к доходу', 'factory', { bonus: { incomeMul: 0.12 } }),
    f('pl-intermarium', 'Междуморье', '+40 отношений с соседями, +10 влияния', 'handshake', { friends: ['LT', 'LV', 'EE', 'CZ', 'SK', 'HU'], influence: 10 }),
    f('pl-forts', 'Укреплённые рубежи', '+20% к обороне', 'castle', { bonus: { defenseMul: 0.2 } }),
  ],
  UA: [
    f('ua-grain', 'Житница Европы', '+15% к доходу', 'factory', { bonus: { incomeMul: 0.15 } }),
    f('ua-def', 'Территориальная оборона', '+25% к обороне', 'castle', { bonus: { defenseMul: 0.25 } }),
    f('ua-volunteers', 'Добровольцы', 'Армия (20)', 'users', { army: 20 }),
    f('ua-fleet', 'Черноморский флот', 'Флот (15)', 'dove', { fleet: 15 }),
  ],
  SE: [
    f('se-steel', 'Шведская сталь', 'Войска на 15% дешевле', 'coins', { bonus: { armyCostMul: -0.15 } }),
    f('se-neutral', 'Вооружённый нейтралитет', '+20% к обороне', 'castle', { bonus: { defenseMul: 0.2 } }),
    f('se-baltic', 'Балтийский флот', 'Флот (15)', 'dove', { fleet: 15 }),
    f('se-nordic', 'Северный союз', '+40 отношений с Норвегией, Данией, Финляндией', 'handshake', { friends: ['NO', 'DK', 'FI'], influence: 5 }),
  ],
};

export const focusesOf = (c: string): Focus[] => [...(NATIONAL[c] ?? []), ...GENERIC];
export const FOCUS: Record<string, Focus> = Object.fromEntries(
  [...GENERIC, ...Object.values(NATIONAL).flat()].map((x) => [x.id, x]),
);

export function available(s: GameState, c: string) {
  const st = s.focus[c];
  return focusesOf(c).filter((x) => !st.done.includes(x.id) && (!x.requires || st.done.includes(x.requires))
    && !(x.effect.fleet && !ownedBy(s, c).some((r) => REGION[r].coast.length)));
}

export function startFocus(s: GameState, c: string, id: string) {
  const st = s.focus[c];
  const x = FOCUS[id];
  if (st.cur || !x || !available(s, c).includes(x)) return false;
  st.cur = id;
  st.left = x.turns;
  return true;
}

function apply(s: GameState, c: string, x: Focus) {
  const e = x.effect;
  const nb = s.nb[c];
  for (const [k, v] of Object.entries(e.bonus ?? {})) (nb as unknown as Record<string, number>)[k] += v as number;
  const cap = s.capital[c] && s.owner[s.capital[c]!] === c ? s.capital[c]! : ownedBy(s, c)[0];
  if (!cap) return;
  if (e.army) addUnit(s, c, 'army', e.army, cap);
  if (e.air) addUnit(s, c, 'air', e.air, cap);
  if (e.fleet) {
    const coast = ownedBy(s, c).find((r) => REGION[r].coast.length);
    if (coast) addUnit(s, c, 'fleet', e.fleet, REGION[coast].coast[0]);
  }
  if (c === s.player) {
    if (e.money) s.money += e.money;
    if (e.stability) s.stability = clamp(s.stability + e.stability, 0, 100);
    if (e.influence) s.influence += e.influence;
    for (const fr of e.friends ?? []) changeRelation(s, fr, 40);
  } else if (e.money) s.ai[c].money += e.money;
}

/** Advances everyone's goals; computer countries pick a new one at random. */
export function progressFocus(s: GameState, alive: (c: string) => boolean) {
  for (const c of Object.keys(s.focus)) {
    if (!alive(c)) continue;
    const st = s.focus[c];
    if (!st.cur) {
      if (c !== s.player) {
        const opts = available(s, c);
        if (opts.length) startFocus(s, c, opts[Math.floor(Math.random() * opts.length)].id);
      }
      continue;
    }
    st.left--;
    if (st.left > 0) continue;
    const x = FOCUS[st.cur];
    st.done.push(st.cur);
    st.cur = null;
    apply(s, c, x);
    if (c === s.player) log(s, `Цель выполнена: ${x.name}`, 'good');
  }
}
