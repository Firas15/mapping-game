import type { GameState } from './state';

export interface UpgradeEffect {
  incomeMul?: number;
  armyCostMul?: number;
  attackMul?: number;
  defenseMul?: number;
  influence?: number;
  stability?: number;
  /** multiplier on peaceful annexation cost */
  annexMul?: number;
  extraAttacks?: number;
  seaMaster?: boolean;
}

export interface Upgrade {
  id: string;
  branch: Branch;
  name: string;
  text: string;
  cost: number;
  icon: string;
  requires?: string;
  effect: UpgradeEffect;
}

export type Branch = 'eco' | 'army' | 'def' | 'dip';
export const BRANCHES: { id: Branch; name: string }[] = [
  { id: 'eco', name: 'Экономика' },
  { id: 'army', name: 'Армия' },
  { id: 'def', name: 'Оборона' },
  { id: 'dip', name: 'Дипломатия' },
];

export const UPGRADES: Upgrade[] = [
  { id: 'rail', branch: 'eco', name: 'Железные дороги', text: '+10% к доходу', cost: 200, icon: 'factory', effect: { incomeMul: 0.1 } },
  { id: 'banks', branch: 'eco', name: 'Центральный банк', text: '+12% к доходу', cost: 380, icon: 'bank', requires: 'rail', effect: { incomeMul: 0.12 } },
  { id: 'conveyor', branch: 'eco', name: 'Конвейер', text: 'Войска на 20% дешевле', cost: 450, icon: 'coins', requires: 'rail', effect: { armyCostMul: -0.2 } },

  { id: 'tanks', branch: 'army', name: 'Танки', text: '+15% к атаке', cost: 280, icon: 'swords', effect: { attackMul: 0.15 } },
  { id: 'air', branch: 'army', name: 'Авиация', text: '+15% к атаке', cost: 520, icon: 'target', requires: 'tanks', effect: { attackMul: 0.15 } },
  { id: 'hq', branch: 'army', name: 'Генштаб', text: '+1 атака за ход', cost: 650, icon: 'flag', requires: 'tanks', effect: { extraAttacks: 1 } },

  { id: 'forts', branch: 'def', name: 'Линия укреплений', text: '+20% к обороне', cost: 240, icon: 'castle', effect: { defenseMul: 0.2 } },
  { id: 'aa', branch: 'def', name: 'ПВО', text: '+20% к обороне', cost: 450, icon: 'shield', requires: 'forts', effect: { defenseMul: 0.2 } },
  { id: 'navy', branch: 'def', name: 'Флот', text: 'Морские атаки без штрафа', cost: 300, icon: 'dove', effect: { seaMaster: true } },

  { id: 'embassy', branch: 'dip', name: 'Посольства', text: '+2 влияния за ход', cost: 220, icon: 'handshake', effect: { influence: 2 } },
  { id: 'radio', branch: 'dip', name: 'Радиовещание', text: '+1 стабильности за ход', cost: 300, icon: 'megaphone', effect: { stability: 1 } },
  { id: 'prestige', branch: 'dip', name: 'Мировой престиж', text: 'Мирное присоединение на 25% дешевле', cost: 480, icon: 'trophy', requires: 'embassy', effect: { annexMul: -0.25 } },
];

export const UPGRADE: Record<string, Upgrade> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

const list = (s: GameState) => s.upgrades ?? [];
export const hasUpgrade = (s: GameState, id: string) => list(s).includes(id);

/** Sum of one numeric effect over everything the player has bought. */
export function upg(s: GameState, key: Exclude<keyof UpgradeEffect, 'seaMaster'>): number {
  return list(s).reduce((sum, id) => sum + ((UPGRADE[id]?.effect[key] as number | undefined) ?? 0), 0);
}
export const upgSeaMaster = (s: GameState) => list(s).some((id) => UPGRADE[id]?.effect.seaMaster);

export function upgradeBlocked(s: GameState, u: Upgrade): string | null {
  if (hasUpgrade(s, u.id)) return 'Изучено';
  if (u.requires && !hasUpgrade(s, u.requires)) return `Сначала: ${UPGRADE[u.requires].name}`;
  if (s.money < u.cost) return `Нужно ${u.cost} денег`;
  return null;
}

export function buyUpgrade(s: GameState, id: string): boolean {
  const u = UPGRADE[id];
  if (!u || upgradeBlocked(s, u)) return false;
  s.money -= u.cost;
  (s.upgrades ??= []).push(id);
  return true;
}
