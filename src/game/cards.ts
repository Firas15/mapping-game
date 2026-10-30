import type { GameState } from './state';
import { grossIncome, shiftParty, holdElections } from './rules';

export interface Effect { text: string; good: boolean }

export interface Card {
  id: string;
  title: string;
  icon: string;
  effects: (s: GameState) => Effect[];
  /** Reason the card can't be played, or null. */
  blocked?: (s: GameState) => string | null;
  apply: (s: GameState) => void;
}

const up = (text: string): Effect => ({ text, good: true });
const down = (text: string): Effect => ({ text, good: false });
const needMoney = (n: number) => (s: GameState) => (s.money < n ? `Нужно ${n} денег` : null);
const clampStab = (s: GameState, d: number) => { s.stability = Math.max(0, Math.min(100, s.stability + d)); };

export const CARDS: Card[] = [
  {
    id: 'taxes', title: 'Поднять налоги', icon: 'coins',
    effects: () => [up('+50% дохода в этот ход'), down('−8 стабильности')],
    apply: (s) => { s.turnIncomeMul += 0.5; clampStab(s, -8); shiftParty(s.parties[s.player], 'con', 2); },
  },
  {
    id: 'draft', title: 'Всеобщий призыв', icon: 'swords',
    effects: () => [up('+15 армии'), down('−6 стабильности')],
    apply: (s) => { s.army += 15; clampStab(s, -6); shiftParty(s.parties[s.player], 'nat', 3); },
  },
  {
    id: 'propaganda', title: 'Пропаганда', icon: 'megaphone',
    effects: () => [up('+10 стабильности'), down('−60 денег')],
    blocked: needMoney(60),
    apply: (s) => { s.money -= 60; clampStab(s, 10); },
  },
  {
    id: 'factories', title: 'Новые заводы', icon: 'factory',
    effects: (s) => [up('+8% к доходу навсегда'), down(`−${factoryCost(s)} денег`)],
    blocked: (s) => needMoney(factoryCost(s))(s),
    apply: (s) => { s.money -= factoryCost(s); s.bonus.incomeMul += 0.08; shiftParty(s.parties[s.player], 'soc', 3); },
  },
  {
    id: 'reform', title: 'Военная реформа', icon: 'shield',
    effects: () => [up('+10% к атаке навсегда'), down('−150 денег')],
    blocked: needMoney(150),
    apply: (s) => { s.money -= 150; s.bonus.attackMul += 0.1; shiftParty(s.parties[s.player], 'nat', 2); },
  },
  {
    id: 'festival', title: 'Народный праздник', icon: 'party',
    effects: () => [up('+7 стабильности'), down('−40% дохода в этот ход')],
    apply: (s) => { s.turnIncomeMul -= 0.4; clampStab(s, 7); },
  },
  {
    id: 'diplomats', title: 'Дипломатический визит', icon: 'handshake',
    effects: () => [up('+5 влияния'), down('−40 денег')],
    blocked: needMoney(40),
    apply: (s) => { s.money -= 40; s.influence += 5; shiftParty(s.parties[s.player], 'dem', 3); },
  },
  {
    id: 'reserve', title: 'Мобилизация резерва', icon: 'users',
    effects: () => [up('+25 армии'), down('−30% дохода в этот ход'), down('−4 стабильности')],
    apply: (s) => { s.army += 25; s.turnIncomeMul -= 0.3; clampStab(s, -4); },
  },
  {
    id: 'amnesty', title: 'Амнистия', icon: 'dove',
    effects: () => [up('+8 стабильности'), down('−5 армии')],
    apply: (s) => { s.army = Math.max(0, s.army - 5); clampStab(s, 8); shiftParty(s.parties[s.player], 'dem', 2); },
  },
  {
    id: 'loan', title: 'Внешний займ', icon: 'bank',
    effects: (s) => [up(`+${loanSize(s)} денег сейчас`), down('−4% к доходу навсегда')],
    apply: (s) => { s.money += loanSize(s); s.bonus.incomeMul -= 0.04; },
  },
  {
    id: 'fortify', title: 'Укрепления', icon: 'castle',
    effects: () => [up('+15% к обороне навсегда'), down('−100 денег')],
    blocked: needMoney(100),
    apply: (s) => { s.money -= 100; s.bonus.defenseMul += 0.15; shiftParty(s.parties[s.player], 'con', 2); },
  },
  {
    id: 'agitation', title: 'Агитация', icon: 'flag',
    effects: () => [up('+6% популярности правящей партии'), down('−50 денег')],
    blocked: needMoney(50),
    apply: (s) => { s.money -= 50; shiftParty(s.parties[s.player], s.ruling[s.player], 6); },
  },
  {
    id: 'snap', title: 'Досрочные выборы', icon: 'ballot',
    effects: () => [up('Власть получит самая популярная партия'), down('−5 стабильности')],
    apply: (s) => { clampStab(s, -5); holdElections(s); s.nextElection = s.turn + 8; },
  },
];

const factoryCost = (s: GameState) => Math.max(80, Math.round(grossIncome(s) * 1.5));
const loanSize = (s: GameState) => Math.max(100, Math.round(grossIncome(s) * 2));

export const CARD: Record<string, Card> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export function drawHand(n = 3): string[] {
  const pool = CARDS.map((c) => c.id);
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

export function playCard(s: GameState, id: string): boolean {
  const card = CARD[id];
  if (!card || s.played || !s.hand.includes(id) || card.blocked?.(s)) return false;
  card.apply(s);
  s.played = id;
  return true;
}
