import { COUNTRIES, COUNTRY } from '../data/countries';
import { type GameState, PLAYER_SAFE_UNTIL, WAR_STARTS, alive, fx, owned } from './state';
import {
  RECRUIT_SIZE, baseIncome, battle, chanceOf, clamp, frontOf, log, recruitCostOf, shiftParty, upkeepOf,
} from './rules';
import { changeRelation, isAlly, relation } from './diplomacy';

/** How eager a government is to start a war, per turn. */
const AGGRESSION = { nat: 0.35, con: 0.18, soc: 0.14, dem: 0.07 } as const;
/** Lowest win chance a government accepts before attacking. */
const NERVE = { nat: 62, con: 68, soc: 70, dem: 78 } as const;

/** Army a computer country is willing to keep. Grows with its land. */
export const armyCap = (s: GameState, nation: string) =>
  Math.round(COUNTRY[nation].army * 1.3 + baseIncome(s, nation) * 0.4);

function economy(s: GameState, nation: string) {
  const n = s.ai[nation];
  // 0.85 matches a player with average stability
  const income = Math.round(baseIncome(s, nation) * (1 + (fx(nation).incomeMul ?? 0)) * 0.85);
  n.money += income - upkeepOf(n.army);
  if (n.money < 0) {
    n.army = Math.max(0, n.army + Math.floor(n.money / 5));
    n.money = 0;
  }
  const cost = recruitCostOf(nation);
  // keep a small reserve, spend the rest on soldiers up to the cap
  while (n.money - cost >= income * 0.5 && n.army + RECRUIT_SIZE <= armyCap(s, nation)) {
    n.money -= cost;
    n.army += RECRUIT_SIZE;
  }
}

/** Picks the most attractive territory this country can probably take, if any. */
function pickTarget(s: GameState, nation: string): string | null {
  const ruling = s.ruling[nation];
  const playerSize = owned(s).length;
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const x of COUNTRIES) {
    const target = x.code;
    const defender = s.owner[target];
    if (defender === nation || !frontOf(s, nation, target)) continue;
    if (defender === s.player && s.turn < PLAYER_SAFE_UNTIL) continue;
    // friends and allies of the player leave it alone
    const rel = relation(s, nation);
    if (defender === s.player && (isAlly(s, nation) || rel >= 40)) continue;
    const chance = chanceOf(s, nation, target);
    if (chance < NERVE[ruling]) continue;
    // a growing player looks like a threat worth stopping
    const threat = defender === s.player ? Math.min(12, Math.max(0, playerSize - 3) * 2) - rel * 0.3 : 0;
    const score = chance + x.eco * 0.3 + threat + Math.random() * 10;
    if (score > bestScore) {
      bestScore = score;
      best = target;
    }
  }
  return best;
}

export function aiTurn(s: GameState) {
  s.events = [];
  const nations = COUNTRIES.map((c) => c.code).filter((c) => c !== s.player && alive(s, c));
  for (const n of nations) economy(s, n);
  if (s.turn < WAR_STARTS) return;

  // random order so the same country doesn't always move first
  for (let i = nations.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nations[i], nations[j]] = [nations[j], nations[i]];
  }

  for (const nation of nations) {
    if (!alive(s, nation) || s.ai[nation].army < 12 || s.turn < s.ai[nation].calmUntil) continue;
    const ruling = s.ruling[nation];
    const ready = s.ai[nation].army >= armyCap(s, nation) * 0.85 ? 1.5 : 1;
    if (Math.random() > AGGRESSION[ruling] * ready) continue;
    const target = pickTarget(s, nation);
    if (!target) continue;

    const r = battle(s, nation, target);
    s.ai[nation].calmUntil = s.turn + 3; // rests two turns after a battle
    s.events.push({ attacker: nation, defender: r.defender, target, won: r.won, eliminated: r.eliminated });
    shiftParty(s.parties[nation], 'nat', r.won ? 2 : -1);

    const a = COUNTRY[nation].name;
    const t = COUNTRY[target].name;
    if (r.defender === s.player) {
      changeRelation(s, nation, -30);
      if (r.won) {
        s.stability = clamp(s.stability - 6, 0, 100);
        log(s, `${a} захватывает вашу территорию: ${t}`, 'bad');
      } else {
        log(s, `Вы отбили нападение: ${a} → ${t}`, 'good');
      }
      shiftParty(s.parties[s.player], 'nat', 2); // being attacked rallies the nation
    } else if (r.won) {
      log(s, `${a} захватывает: ${t}`, 'info');
      if (r.eliminated && r.defender !== target) log(s, `${COUNTRY[r.defender].name} больше не существует`, 'info');
    }
  }
}
