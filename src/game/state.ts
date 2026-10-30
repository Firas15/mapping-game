import { COUNTRIES, COUNTRY, type PartyId, PARTY_ORDER } from '../data/countries';
import { TRAITS, type TraitEffect } from '../data/traits';

export type Parties = [number, number, number, number];

export interface GameState {
  version: 1;
  player: string;
  turn: number;
  /** territory -> owner country code */
  owner: Record<string, string>;
  /** defending army of territories the player does not hold */
  garrison: Record<string, number>;
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
  won: boolean;
}

export const MAX_ATTACKS = 2;
export const ELECTION_EVERY = 8;
export const SEASONS = ['весна', 'лето', 'осень', 'зима'] as const;
export const season = (turn: number) => SEASONS[(turn - 1) % 4];
export const isWinter = (turn: number) => season(turn) === 'зима';

export const topParty = (p: Parties): PartyId => PARTY_ORDER[p.indexOf(Math.max(...p))];

export function newGame(player: string, hand: string[]): GameState {
  const def = COUNTRY[player];
  const owner: Record<string, string> = {};
  const garrison: Record<string, number> = {};
  const parties: Record<string, Parties> = {};
  const ruling: Record<string, PartyId> = {};
  for (const x of COUNTRIES) {
    owner[x.code] = x.code;
    garrison[x.code] = x.army;
    parties[x.code] = [...x.parties];
    ruling[x.code] = topParty(x.parties);
  }
  return {
    version: 1,
    player,
    turn: 1,
    owner,
    garrison,
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
    log: [{ turn: 1, text: `Вы правите страной ${def.name}. Захватите Европу!`, tone: 'info' }],
    won: false,
  };
}

export const trait = (code: string) => TRAITS[COUNTRY[code].trait];
export const fx = (code: string): TraitEffect => trait(code).effect;
export const owned = (s: GameState) => COUNTRIES.filter((x) => s.owner[x.code] === s.player).map((x) => x.code);
export const playerRuling = (s: GameState) => s.ruling[s.player];

const SAVE_KEY = 'mapping-save-v1';
export function save(s: GameState) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* storage may be blocked */ }
}
export function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const s = raw ? (JSON.parse(raw) as GameState) : null;
    return s && s.version === 1 && COUNTRY[s.player] ? s : null;
  } catch {
    return null;
  }
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
