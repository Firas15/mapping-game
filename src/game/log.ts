import type { GameState, Tone } from './state';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Adds a short line to the journal (newest first). */
export function log(s: GameState, text: string, tone: Tone = 'info') {
  s.log.unshift({ turn: s.turn, text, tone });
  s.log.length = Math.min(s.log.length, 80);
}
