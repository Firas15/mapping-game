import { COUNTRIES, COUNTRY, type PartyId, PARTY_ORDER } from '../data/countries';
import { TRAITS, type TraitEffect } from '../data/traits';

export type Parties = [number, number, number, number];

/** A computer-run country. */
export interface Nation {
  army: number;
  money: number;
  /** can't start another war before this turn */
  calmUntil: number;
}

/** One battle fought during the computer's turn. */
export interface WarEvent {
  attacker: string;
  defender: string;
  target: string;
  won: boolean;
  /** defender lost its last territory */
  eliminated: boolean;
}

export interface GameState {
  version: 2;
  player: string;
  turn: number;
  /** territory -> owner country code */
  owner: Record<string, string>;
  /** computer countries; the player's own entry is unused */
  ai: Record<string, Nation>;
  money: number;
  army: number;
  stability: number;
  influence: number;
  /** permanent bonuses from decisions */
  bonus: { incomeMul: number; attackMul: number; defenseMul: number };
  parties: Record<string, Parties>;
  ruling: Record<string, PartyId>;
  nextElection: number;
  attacksLeft: number;
  hand: string[];
  played: string | null;
  /** one-turn income multiplier set by a decision */
  turnIncomeMul: number;
  log: { turn: number; text: string; tone: 'good' | 'bad' | 'info' }[];
  /** battles of the last computer turn */
  events: WarEvent[];
  won: boolean;
  lost: boolean;
}

export const MAX_ATTACKS = 2;
export const ELECTION_EVERY = 8;
/** Computer countries start fighting each other from this turn. */
export const WAR_STARTS = 3;
/** ...and may attack the player from this turn. */
export const PLAYER_SAFE_UNTIL = 6;
/** Defence bonus of a country fighting on its own land. */
export const HOME_BONUS = 0.4;
export const SEASONS = ['весна', 'лето', 'осень', 'зима'] as const;
export const season = (turn: number) => SEASONS[(turn - 1) % 4];
export const isWinter = (turn: number) => season(turn) === 'зима';

export const topParty = (p: Parties): PartyId => PARTY_ORDER[p.indexOf(Math.max(...p))];

export function newGame(player: string, hand: string[]): GameState {
  const def = COUNTRY[player];
  const owner: Record<string, string> = {};
  const ai: Record<string, Nation> = {};
  const parties: Record<string, Parties> = {};
  const ruling: Record<string, PartyId> = {};
  for (const x of COUNTRIES) {
    owner[x.code] = x.code;
    ai[x.code] = { army: x.army, money: x.eco * 2, calmUntil: 0 };
    parties[x.code] = [...x.parties];
    ruling[x.code] = topParty(x.parties);
  }
  return {
    version: 2,
    player,
    turn: 1,
    owner,
    ai,
    money: Math.max(150, def.eco * 3),
    army: def.army,
    stability: 70,
    influence: 10,
    bonus: { incomeMul: 0, attackMul: 0, defenseMul: 0 },
    parties,
    ruling,
    nextElection: ELECTION_EVERY + 1,
    attacksLeft: MAX_ATTACKS,
    hand,
    played: null,
    turnIncomeMul: 1,
    log: [
      { turn: 1, text: `Вы правите страной ${def.name}. Объедините Европу!`, tone: 'info' },
      { turn: 1, text: `Пока в Европе мир. С ${PLAYER_SAFE_UNTIL}-го хода соседи могут напасть и на вас`, tone: 'info' },
    ],
    events: [],
    won: false,
    lost: false,
  };
}

export const trait = (code: string) => TRAITS[COUNTRY[code].trait];
export const fx = (code: string): TraitEffect => trait(code).effect;
export const ownedBy = (s: GameState, nation: string) => COUNTRIES.filter((x) => s.owner[x.code] === nation).map((x) => x.code);
export const owned = (s: GameState) => ownedBy(s, s.player);
export const alive = (s: GameState, nation: string) => COUNTRIES.some((x) => s.owner[x.code] === nation);
export const playerRuling = (s: GameState) => s.ruling[s.player];

export const armyOf = (s: GameState, nation: string) => (nation === s.player ? s.army : s.ai[nation].army);
export function addArmy(s: GameState, nation: string, delta: number) {
  if (nation === s.player) s.army = Math.max(0, Math.round(s.army + delta));
  else s.ai[nation].army = Math.max(0, Math.round(s.ai[nation].army + delta));
}

const SAVE_KEY = 'mapping-save-v2';
export function save(s: GameState) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* storage may be blocked */ }
}
export function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const s = raw ? (JSON.parse(raw) as GameState) : null;
    return s && s.version === 2 && COUNTRY[s.player] && !s.lost ? s : null;
  } catch {
    return null;
  }
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
