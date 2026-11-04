import { COUNTRIES } from '../data/countries';
import { REGIONS } from '../data/regions';
import { type GameState, alive, ownedBy, strOf } from './state';
import { power } from './blocs';
import { incomeOf } from './rules';
import { log } from './log';

export type Metric = 'power' | 'army' | 'fleet' | 'air' | 'economy' | 'land';
export const METRICS: { id: Metric; name: string; icon: string }[] = [
  { id: 'power', name: 'Общая сила', icon: 'trophy' },
  { id: 'army', name: 'Армия', icon: 'swords' },
  { id: 'fleet', name: 'Флот', icon: 'dove' },
  { id: 'air', name: 'Авиация', icon: 'target' },
  { id: 'economy', name: 'Экономика', icon: 'coins' },
  { id: 'land', name: 'Территория', icon: 'flag' },
];

export function metric(s: GameState, n: string, m: Metric): number {
  switch (m) {
    case 'power': return Math.round(power(s, n) + incomeOf(s, n) * 0.5);
    case 'army': return strOf(s, n, 'army');
    case 'fleet': return strOf(s, n, 'fleet');
    case 'air': return strOf(s, n, 'air');
    case 'economy': return incomeOf(s, n);
    case 'land': return ownedBy(s, n).length;
  }
}

export function ranking(s: GameState, m: Metric) {
  return COUNTRIES.map((c) => c.code).filter((n) => alive(s, n))
    .map((n) => ({ n, v: metric(s, n, m) }))
    .sort((a, b) => b.v - a.v);
}
export const rankOf = (s: GameState, m: Metric) => ranking(s, m).findIndex((x) => x.n === s.player) + 1;

export function recordHistory(s: GameState) {
  const land = ranking(s, 'land');
  const top = land.find((x) => x.n !== s.player) ?? land[0];
  s.history.push({
    t: s.turn, me: ownedBy(s, s.player).length, army: strOf(s, s.player, 'army'),
    eco: incomeOf(s, s.player), top: top.n, topN: top.v,
  });
  s.stats.maxRegions = Math.max(s.stats.maxRegions, ownedBy(s, s.player).length);
}

export interface Achievement { id: string; name: string; text: string; icon: string; check: (s: GameState) => boolean }

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'blitz', name: 'Блицкриг', text: 'Взять вражескую столицу до 12-го хода', icon: 'swords', check: (s) => s.stats.capitalsTaken > 0 && s.turn <= 12 },
  { id: 'five', name: 'Пять столиц', text: 'Взять 5 вражеских столиц', icon: 'star', check: (s) => s.stats.capitalsTaken >= 5 },
  { id: 'peace', name: 'Мирный путь', text: 'Мирно присоединить 3 страны', icon: 'handshake', check: (s) => s.stats.annexed >= 3 },
  { id: 'sea', name: 'Владыка морей', text: 'Потопить 5 флотов', icon: 'dove', check: (s) => s.stats.fleetsSunk >= 5 },
  { id: 'sky', name: 'Небо наше', text: 'Нанести 20 авиаударов', icon: 'target', check: (s) => s.stats.airStrikes >= 20 },
  { id: 'phoenix', name: 'Феникс', text: 'Вернуть потерянную столицу', icon: 'restart', check: (s) => s.stats.capitalRetaken > 0 },
  { id: 'third', name: 'Треть Европы', text: `Владеть ${Math.ceil(REGIONS.length / 3)} областями`, icon: 'flag', check: (s) => ownedBy(s, s.player).length >= Math.ceil(REGIONS.length / 3) },
  { id: 'iron', name: 'Несокрушимый', text: '30 ходов подряд не терять ни одной своей области', icon: 'shield', check: (s) => s.turn - (s.stats.lastLoss ?? 1) >= 30 },
  { id: 'unify', name: 'Объединитель', text: 'Объединить всю Европу', icon: 'trophy', check: (s) => ownedBy(s, s.player).length === REGIONS.length },
];

export function checkAchievements(s: GameState) {
  for (const a of ACHIEVEMENTS) {
    if (s.achievements.includes(a.id) || !a.check(s)) continue;
    s.achievements.push(a.id);
    s.fresh.push(a.id);
    log(s, `Достижение: ${a.name}`, 'good');
  }
}
