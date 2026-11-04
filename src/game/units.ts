import { COUNTRY } from '../data/countries';
import { REGION } from '../data/regions';
import { type GameState, type Unit, type UnitType, addUnit, armiesAt, fx, integrated, ownedBy, unitsOf } from './state';
import { upg } from './upgrades';
import { yieldShare } from './war';

export const UNIT_INFO: Record<UnitType, { name: string; one: string; text: string }> = {
  army: { name: 'Армия', one: 'армия', text: 'Захватывает и защищает области' },
  fleet: { name: 'Флот', one: 'флот', text: 'Стоит в море и не пускает вражеский десант' },
  air: { name: 'Авиация', one: 'авиакрыло', text: 'Бомбит армии и флоты врага, землю не берёт' },
};

const costMul = (s: GameState, n: string) =>
  1 + (fx(n).armyCostMul ?? 0) + s.nb[n].armyCostMul + (n === s.player ? upg(s, 'armyCostMul') : 0);

/** Prices in money. Reinforcing adds 10 to an army. */
export const PRICES = { reinforce: 100, army: 150, fleet: 250, air: 200 } as const;
export const price = (s: GameState, n: string, what: keyof typeof PRICES) => Math.round(PRICES[what] * costMul(s, n));
export const REINFORCE = 10;
export const NEW_UNIT = 10;

/** How many armies a country may field: grows with its land. */
export const maxArmies = (s: GameState, n: string) =>
  Math.min(9, 1 + Math.floor(ownedBy(s, n).length / 3) + (n === s.player ? upg(s, 'extraArmies') : 0));

/** Money spent each turn on keeping forces. */
export const upkeepOf = (s: GameState, n: string) => Math.round(unitsOf(s, n).reduce((sum, u) =>
  sum + u.str * (u.type === 'army' ? 0.25 : u.type === 'fleet' ? 0.5 : 0.4), 0));

/** Soldiers a country's regions raise each turn. */
export const draft = (s: GameState, n: string) =>
  Math.round(ownedBy(s, n).reduce((sum, r) => sum + REGION[r].men * yieldShare(s, r), 0) * (1 + s.nb[n].draftMul));

/** Free conscription tops armies up to this total; at war the ceiling is higher. */
export const draftCap = (s: GameState, n: string) =>
  Math.round((s.wars.some((w) => w.a === n || w.b === n) ? 1.4 : 1) * (COUNTRY[n].army * 1.3 + regionIncome(s, n) * 0.4 + draft(s, n) * 4));
const regionIncome = (s: GameState, n: string) => ownedBy(s, n).reduce((sum, r) => sum + REGION[r].eco * yieldShare(s, r), 0);
export const armyTotal = (s: GameState, n: string) => unitsOf(s, n, 'army').reduce((sum, u) => sum + u.str, 0);

/** Where a country can raise new forces: its own or integrated land. */
export const canRaiseIn = (s: GameState, n: string, r: string) => s.owner[r] === n && integrated(s, r);

/** Fresh soldiers go to the weakest armies on own land; with none, a new army forms in the capital. */
export function reinforce(s: GameState, n: string, amount: number) {
  let left = Math.round(amount);
  if (left <= 0) return;
  const armies = unitsOf(s, n, 'army').filter((u) => s.owner[u.at] === n);
  if (!armies.length) {
    const home = s.capital[n] && s.owner[s.capital[n]!] === n ? s.capital[n]! : ownedBy(s, n)[0];
    if (home) addUnit(s, n, 'army', left, home);
    return;
  }
  while (left > 0) {
    const weakest = armies.reduce((a, b) => (b.str < a.str ? b : a));
    const add = Math.min(left, 5);
    weakest.str += add;
    left -= add;
  }
}

/** Takes soldiers away, biggest armies first. */
export function removeTroops(s: GameState, n: string, amount: number) {
  let left = Math.round(amount);
  const armies = unitsOf(s, n, 'army').sort((a, b) => b.str - a.str);
  for (const u of armies) {
    if (left <= 0) break;
    const take = Math.min(left, u.str - 1);
    u.str -= take;
    left -= take;
  }
}

/** Shrinks every army by a share (epidemics, crackdowns). */
export function scaleArmies(s: GameState, n: string, mul: number) {
  for (const u of unitsOf(s, n, 'army')) u.str = Math.max(1, Math.round(u.str * mul));
}

// ---------- player orders ----------

export function cantReinforce(s: GameState, u: Unit): string | null {
  if (u.type !== 'army') return 'Только для армий';
  if (s.owner[u.at] !== s.player) return 'Армия должна стоять на своей земле';
  if (s.money < price(s, s.player, 'reinforce')) return 'Не хватает денег';
  return null;
}
export function reinforceUnit(s: GameState, u: Unit) {
  if (cantReinforce(s, u)) return false;
  s.money -= price(s, s.player, 'reinforce');
  u.str += REINFORCE;
  return true;
}

export function cantBuild(s: GameState, n: string, type: UnitType, r: string): string | null {
  if (!canRaiseIn(s, n, r)) return 'Нужна своя или освоенная область';
  const joins = type === 'army' && armiesAt(s, r, n).length > 0;
  if (type === 'army' && !joins && unitsOf(s, n, 'army').length >= maxArmies(s, n)) return `Лимит армий: ${maxArmies(s, n)}`;
  if (type === 'fleet' && !REGION[r].coast.length) return 'Нужна область у моря';
  const money = n === s.player ? s.money : s.ai[n].money;
  if (money < price(s, n, type)) return 'Не хватает денег';
  return null;
}

export function build(s: GameState, n: string, type: UnitType, r: string): Unit | null {
  if (cantBuild(s, n, type, r)) return null;
  const cost = price(s, n, type);
  if (n === s.player) s.money -= cost; else s.ai[n].money -= cost;
  const at = type === 'fleet' ? REGION[r].coast[0] : r;
  // a new army merges into one already standing there
  if (type === 'army') {
    const here = armiesAt(s, r, n)[0];
    if (here) { here.str += NEW_UNIT; return here; }
  }
  return addUnit(s, n, type, NEW_UNIT, at);
}

export function disband(s: GameState, u: Unit) {
  s.units = s.units.filter((x) => x !== u);
}

/** Two armies of one owner in one region become one. */
export function mergeArmies(s: GameState, region: string, owner: string) {
  const here = armiesAt(s, region, owner);
  if (here.length < 2) return false;
  const [first, ...rest] = here;
  for (const u of rest) first.str += u.str;
  first.acted = rest.every((u) => u.acted) && first.acted;
  s.units = s.units.filter((u) => !rest.includes(u));
  return true;
}
