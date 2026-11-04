import { COUNTRIES, COUNTRY, type PartyId, PARTY_ORDER } from '../data/countries';
import { TRAITS, type TraitEffect } from '../data/traits';
import { CAPITAL, REGION, REGIONS, regionsOf } from '../data/regions';
import { affinity } from '../data/affinity';

export type Parties = [number, number, number, number];

// ---------- units ----------

export type UnitType = 'army' | 'fleet' | 'air';
export interface Unit {
  id: number;
  owner: string;
  type: UnitType;
  /** soldiers / ships / planes, as one number */
  str: number;
  /** region id for armies and air wings, sea zone id for fleets */
  at: string;
  /** already moved, attacked or struck this turn */
  acted: boolean;
}

/** Bonuses a country collects from decisions, events and national goals. */
export interface Bonus {
  incomeMul: number;
  attackMul: number;
  defenseMul: number;
  draftMul: number;
  armyCostMul: number;
  fleetMul: number;
  airMul: number;
  influence: number;
  stability: number;
  /** declaring war costs no stability */
  casusBelli: number;
}
export const emptyBonus = (): Bonus => ({
  incomeMul: 0, attackMul: 0, defenseMul: 0, draftMul: 0, armyCostMul: 0, fleetMul: 0, airMul: 0,
  influence: 0, stability: 0, casusBelli: 0,
});

/** A computer-run country's purse. */
export interface Nation {
  money: number;
  /** won't start a new war before this turn */
  calmUntil: number;
}

export interface War {
  a: string;
  b: string;
  since: number;
  /** region -> owner before this war, for white peace */
  taken: Record<string, string>;
}

/** One battle of the computer turn, for the report and the capture cutscene. */
export interface WarEvent {
  attacker: string;
  defender: string;
  target: string;
  won: boolean;
  eliminated: boolean;
}

export interface Bloc { id: string; name: string; party: PartyId; members: string[] }
export interface FocusState {
  done: string[]; cur: string | null; left: number;
  /** permanent course chosen once every goal is done */
  course?: string | null;
}
export interface TurnStat { t: number; me: number; army: number; eco: number; top: string; topN: number }
export interface Stats {
  battlesWon: number; battlesLost: number; regionsTaken: number; regionsLost: number;
  capitalsTaken: number; annexed: number; peaces: number; fleetsSunk: number; airStrikes: number;
  maxRegions: number; capitalRetaken: number;
  /** turn the player last lost a region */
  lastLoss?: number;
}

export type Difficulty = 'easy' | 'normal' | 'hard';
export interface Settings { difficulty: Difficulty; short: boolean }
/** caution: how much stronger than the player a computer country wants to be before attacking them */
export const DIFFICULTY: Record<Difficulty, { name: string; aiIncome: number; aggression: number; playerMoney: number; coalition: number; caution: number; guard: number }> = {
  easy: { name: 'Лёгкая', aiIncome: 0.85, aggression: 0.7, playerMoney: 1.6, coalition: 0.4, caution: 1.4, guard: 0.15 },
  normal: { name: 'Обычная', aiIncome: 1, aggression: 1, playerMoney: 1, coalition: 0.3, caution: 1.15, guard: 0.35 },
  hard: { name: 'Тяжёлая', aiIncome: 1.15, aggression: 1.3, playerMoney: 0.8, coalition: 0.22, caution: 0.95, guard: 0.55 },
};

export type Tone = 'good' | 'bad' | 'info';
export interface LogEntry { turn: number; text: string; tone: Tone }

export interface GameState {
  version: 6;
  settings: Settings;
  player: string;
  turn: number;
  /** region -> owner country */
  owner: Record<string, string>;
  /** region -> turn its current owner took it (cores: 0) */
  heldSince: Record<string, number>;
  /** occupied region -> unrest 0..100 */
  unrest: Record<string, number>;
  /** current capital of each country (it moves when the old one falls) */
  capital: Record<string, string | null>;
  /** turns a country has spent without any key region */
  keyless: Record<string, number>;
  units: Unit[];
  nextUnit: number;
  ai: Record<string, Nation>;
  nb: Record<string, Bonus>;
  money: number;
  stability: number;
  influence: number;
  parties: Record<string, Parties>;
  ruling: Record<string, PartyId>;
  nextElection: number;
  hand: string[];
  played: string | null;
  turnIncomeMul: number;
  log: LogEntry[];
  events: WarEvent[];
  pendingEvent: string | null;
  eventSeen: Record<string, number>;
  relations: Record<string, number>;
  allies: string[];
  upgrades: string[];
  wars: War[];
  /** "A|B" -> turn the truce ends */
  truces: Record<string, number>;
  focus: Record<string, FocusState>;
  blocs: Bloc[];
  coalition: string[];
  coalitionFormed: boolean;
  /** peace a computer country offers the player */
  peaceOffer: string | null;
  /** big news the UI should show in a window */
  notice: { title: string; text: string; tone: Tone } | null;
  history: TurnStat[];
  stats: Stats;
  achievements: string[];
  /** achievements unlocked since the UI last looked */
  fresh: string[];
  won: boolean;
  lost: boolean;
  endReason: string;
}

export const ELECTION_EVERY = 8;
export const WAR_STARTS = 3;
/** Computer countries may attack the player from this turn. */
export const PLAYER_SAFE_UNTIL = 6;
export const HOME_BONUS = 0.25;
export const CAPITAL_BONUS = 0.5;
/** Turns without any key region before a country capitulates. */
export const CAPITULATE_AFTER = 3;
/** Turns an occupied region needs to become fully yours. */
export const INTEGRATE_AFTER = 12;
export const SHORT_TURNS = 30;
export const TRUCE_TURNS = 10;
export const SEASONS = ['весна', 'лето', 'осень', 'зима'] as const;
export const season = (turn: number) => SEASONS[(turn - 1) % 4];
export const isWinter = (turn: number) => season(turn) === 'зима';

export const topParty = (p: Parties): PartyId => PARTY_ORDER[p.indexOf(Math.max(...p))];
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Who starts with ships and planes.
const NAVAL = new Set(['GB', 'FR', 'IT', 'ES', 'TR', 'RU', 'NO', 'SE', 'GR', 'NL', 'DK', 'PT', 'DE', 'UA', 'FI', 'HR']);
const AIR = new Set(['DE', 'FR', 'GB', 'IT', 'RU', 'TR', 'PL', 'ES', 'UA', 'SE']);

export function newGame(player: string, hand: string[], settings: Settings = { difficulty: 'normal', short: false }): GameState {
  const def = COUNTRY[player];
  const owner: Record<string, string> = {};
  const heldSince: Record<string, number> = {};
  for (const r of REGIONS) { owner[r.id] = r.c; heldSince[r.id] = 0; }

  const s: GameState = {
    version: 6, settings, player, turn: 1, owner, heldSince, unrest: {},
    capital: { ...CAPITAL }, keyless: {}, units: [], nextUnit: 1, ai: {}, nb: {},
    money: Math.round(Math.max(150, def.eco * 3) * DIFFICULTY[settings.difficulty].playerMoney),
    stability: 70, influence: 10, parties: {}, ruling: {}, nextElection: ELECTION_EVERY + 1,
    hand, played: null, turnIncomeMul: 1, log: [], events: [], pendingEvent: null, eventSeen: {},
    relations: {}, allies: [], upgrades: [], wars: [], truces: {}, focus: {}, blocs: [], coalition: [],
    coalitionFormed: false, peaceOffer: null, notice: null, history: [],
    stats: {
      battlesWon: 0, battlesLost: 0, regionsTaken: 0, regionsLost: 0, capitalsTaken: 0, annexed: 0, peaces: 0,
      fleetsSunk: 0, airStrikes: 0, maxRegions: regionsOf(player).length, capitalRetaken: 0, lastLoss: 1,
    },
    achievements: [], fresh: [], won: false, lost: false, endReason: '',
  };

  for (const x of COUNTRIES) {
    s.ai[x.code] = { money: x.eco * 2, calmUntil: 0 };
    s.nb[x.code] = emptyBonus();
    s.parties[x.code] = [...x.parties];
    s.ruling[x.code] = topParty(x.parties);
    s.focus[x.code] = { done: [], cur: null, left: 0 };
    placeStartingForces(s, x.code);
  }
  for (const x of COUNTRIES) {
    if (x.code !== player) s.relations[x.code] = Math.max(-100, Math.min(100, affinity(player, x.code) + (s.ruling[x.code] === s.ruling[player] ? 10 : 0)));
  }
  return s;
}

/** The starting army is split into up to three armies: capital first, then the biggest regions. */
function placeStartingForces(s: GameState, c: string) {
  const def = COUNTRY[c];
  const regions = regionsOf(c).sort((a, b) => Number(b.capital) - Number(a.capital) || b.area - a.area);
  const n = Math.max(1, Math.min(3, regions.length, Math.round(def.army / 28)));
  for (let i = 0; i < n; i++) {
    addUnit(s, c, 'army', Math.round(def.army / n), regions[i].id);
  }
  const coastal = regions.find((r) => r.coast.length);
  if (NAVAL.has(c) && coastal) addUnit(s, c, 'fleet', Math.max(6, Math.round(def.army * 0.2)), coastal.coast[0]);
  if (AIR.has(c)) addUnit(s, c, 'air', Math.max(6, Math.round(def.army * 0.15)), regions[0].id);
}

export function addUnit(s: GameState, owner: string, type: UnitType, str: number, at: string): Unit {
  const u: Unit = { id: s.nextUnit++, owner, type, str: Math.max(1, Math.round(str)), at, acted: false };
  s.units.push(u);
  return u;
}

export const trait = (code: string) => TRAITS[COUNTRY[code].trait];
export const fx = (code: string): TraitEffect => trait(code).effect;
export const ownedBy = (s: GameState, nation: string) => REGIONS.filter((r) => s.owner[r.id] === nation).map((r) => r.id);
export const owned = (s: GameState) => ownedBy(s, s.player);
export const alive = (s: GameState, nation: string) => REGIONS.some((r) => s.owner[r.id] === nation);
export const playerRuling = (s: GameState) => s.ruling[s.player];

export const unitsOf = (s: GameState, nation: string, type?: UnitType) =>
  s.units.filter((u) => u.owner === nation && (!type || u.type === type));
export const strOf = (s: GameState, nation: string, type: UnitType) =>
  unitsOf(s, nation, type).reduce((sum, u) => sum + u.str, 0);
export const armiesAt = (s: GameState, region: string, owner?: string) =>
  s.units.filter((u) => u.type === 'army' && u.at === region && (!owner || u.owner === owner));

/** A region gives everything once it's the owner's own land or held long enough. */
export const integrated = (s: GameState, region: string) =>
  s.owner[region] === REGION[region].c || s.turn - (s.heldSince[region] ?? 0) >= INTEGRATE_AFTER;

const SAVE_KEY = 'mapping-save-v6';
export function save(s: GameState) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* storage may be blocked */ }
}
export function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const s = raw ? (JSON.parse(raw) as GameState) : null;
    if (!s || s.version !== 6 || !COUNTRY[s.player] || s.lost || s.won) return null;
    return s;
  } catch {
    return null;
  }
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
