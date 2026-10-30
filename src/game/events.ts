import { COUNTRIES, COUNTRY, PARTIES, PARTY_ORDER, type PartyId } from '../data/countries';
import type { Effect } from './cards';
import { type GameState, alive, isWinter } from './state';
import { clamp, grossIncome, log, shiftParty } from './rules';

export interface EventOption {
  label: string;
  effects: (s: GameState) => Effect[];
  apply: (s: GameState) => void;
}

export interface GameEvent {
  id: string;
  title: string;
  icon: string;
  text: (s: GameState) => string;
  /** 0 = can't happen now. Higher = more likely. */
  weight: (s: GameState) => number;
  options: EventOption[];
}

const up = (text: string): Effect => ({ text, good: true });
const down = (text: string): Effect => ({ text, good: false });
const inc = (s: GameState) => Math.max(40, grossIncome(s));
const stab = (s: GameState, d: number) => { s.stability = clamp(s.stability + d, 0, 100); };
const pay = (s: GameState, n: number) => { s.money = Math.max(0, s.money - n); };
const pct = (s: GameState, party: PartyId) => s.parties[s.player][PARTY_ORDER.indexOf(party)];
const name = (s: GameState) => COUNTRY[s.player].name;

/** Second most popular party, the one a revolution brings to power. */
function challenger(s: GameState): PartyId {
  const p = s.parties[s.player];
  const ruling = s.ruling[s.player];
  return PARTY_ORDER.filter((id) => id !== ruling).sort((a, b) => p[PARTY_ORDER.indexOf(b)] - p[PARTY_ORDER.indexOf(a)])[0];
}

export const EVENTS: GameEvent[] = [
  {
    id: 'boom', title: 'Экономический бум', icon: 'factory',
    text: () => 'Заводы работают в три смены, налоги текут рекой. Как распорядиться удачей?',
    weight: (s) => (s.stability >= 50 ? 3 : 1),
    options: [
      { label: 'Пополнить казну', effects: (s) => [up(`+${inc(s) * 2} денег`)], apply: (s) => { s.money += inc(s) * 2; } },
      { label: 'Вложить в промышленность', effects: () => [up('+6% к доходу навсегда')], apply: (s) => { s.bonus.incomeMul += 0.06; } },
    ],
  },
  {
    id: 'crisis', title: 'Финансовый кризис', icon: 'bank',
    text: () => 'Крупнейшие банки на грани краха. Вкладчики штурмуют отделения.',
    weight: (s) => (s.turn > 4 ? 2 : 0),
    options: [
      { label: 'Спасти банки', effects: (s) => [down(`−${Math.round(inc(s) * 1.5)} денег`)], apply: (s) => pay(s, Math.round(inc(s) * 1.5)) },
      {
        label: 'Пусть рынок разберётся', effects: () => [down('−12 стабильности'), down('+4% социалистам')],
        apply: (s) => { stab(s, -12); shiftParty(s.parties[s.player], 'soc', 4); },
      },
    ],
  },
  {
    id: 'protests', title: 'Массовые протесты', icon: 'megaphone',
    text: (s) => `Улицы городов страны ${name(s)} заполнены недовольными. Они требуют перемен.`,
    weight: (s) => (s.stability < 45 ? 6 : 0),
    options: [
      {
        label: 'Пойти на уступки', effects: (s) => [up('+10 стабильности'), down(`−${Math.round(inc(s) * 0.8)} денег`), up('+5% демократам')],
        apply: (s) => { pay(s, Math.round(inc(s) * 0.8)); stab(s, 10); shiftParty(s.parties[s.player], 'dem', 5); },
      },
      {
        label: 'Разогнать', effects: () => [up('+5 стабильности'), down('−8 армии'), down('+5% националистам')],
        apply: (s) => { s.army = Math.max(0, s.army - 8); stab(s, 5); shiftParty(s.parties[s.player], 'nat', 5); },
      },
    ],
  },
  {
    id: 'revolution', title: 'Революция!', icon: 'flag',
    text: (s) => `Толпа окружила правительство. ${PARTIES[challenger(s)].name} требуют власти.`,
    weight: (s) => (s.stability < 20 ? 8 : 0),
    options: [
      {
        label: 'Уступить власть', effects: (s) => [down(`К власти придут ${PARTIES[challenger(s)].name.toLowerCase()}`), up('Стабильность станет 50')],
        apply: (s) => {
          const c = challenger(s);
          shiftParty(s.parties[s.player], c, 15);
          s.ruling[s.player] = c;
          s.stability = 50;
        },
      },
      {
        label: 'Подавить силой', effects: () => [down('−30% армии'), up('+15 стабильности')],
        apply: (s) => { s.army = Math.round(s.army * 0.7); stab(s, 15); shiftParty(s.parties[s.player], 'nat', 6); },
      },
    ],
  },
  {
    id: 'oil', title: 'Найдено месторождение', icon: 'sparkles',
    text: () => 'Геологи нашли богатое месторождение. Иностранные компании уже стучатся в дверь.',
    weight: () => 2,
    options: [
      { label: 'Добывать самим', effects: () => [up('+7% к доходу навсегда'), down('−80 денег')], apply: (s) => { pay(s, 80); s.bonus.incomeMul += 0.07; } },
      { label: 'Продать права', effects: (s) => [up(`+${inc(s) * 3} денег`)], apply: (s) => { s.money += inc(s) * 3; } },
    ],
  },
  {
    id: 'harvest', title: 'Неурожай', icon: 'hourglass',
    text: () => 'Засуха погубила урожай. Цены на хлеб растут.',
    weight: (s) => (s.turn > 2 && !isWinter(s.turn) ? 2 : 0),
    options: [
      { label: 'Закупить зерно', effects: (s) => [down(`−${inc(s)} денег`)], apply: (s) => pay(s, inc(s)) },
      { label: 'Затянуть пояса', effects: () => [down('−8 стабильности')], apply: (s) => stab(s, -8) },
    ],
  },
  {
    id: 'plague', title: 'Эпидемия', icon: 'shield',
    text: () => 'В казармах вспышка болезни. Врачи просят ввести карантин.',
    weight: (s) => (s.army > 20 ? 2 : 0),
    options: [
      { label: 'Карантин', effects: () => [down('−30% дохода в этот ход')], apply: (s) => { s.turnIncomeMul -= 0.3; } },
      { label: 'Продолжать службу', effects: () => [down('−15% армии')], apply: (s) => { s.army = Math.round(s.army * 0.85); } },
    ],
  },
  {
    id: 'volunteers', title: 'Добровольцы', icon: 'users',
    text: () => 'Тысячи молодых людей выстроились у призывных пунктов.',
    weight: (s) => (pct(s, 'nat') >= 20 ? 3 : 1),
    options: [
      { label: 'Принять в армию', effects: () => [up('+12 армии'), down('+3% националистам')], apply: (s) => { s.army += 12; shiftParty(s.parties[s.player], 'nat', 3); } },
      { label: 'Отправить на стройки', effects: (s) => [up(`+${inc(s)} денег`)], apply: (s) => { s.money += inc(s); } },
    ],
  },
  {
    id: 'general', title: 'Талантливый генерал', icon: 'swords',
    text: () => 'Молодой офицер предлагает смелую реформу тактики.',
    weight: () => 1.5,
    options: [
      { label: 'Дать ему армию', effects: () => [up('+8% к атаке навсегда')], apply: (s) => { s.bonus.attackMul += 0.08; } },
      { label: 'Поручить оборону', effects: () => [up('+12% к обороне навсегда')], apply: (s) => { s.bonus.defenseMul += 0.12; } },
    ],
  },
  {
    id: 'spy', title: 'Пойман шпион', icon: 'target',
    text: () => 'Контрразведка задержала иностранного агента с секретными картами.',
    weight: () => 1.5,
    options: [
      { label: 'Обменять на уступки', effects: () => [up('+6 влияния')], apply: (s) => { s.influence += 6; } },
      { label: 'Показательный суд', effects: () => [up('+6 стабильности'), down('+3% националистам')], apply: (s) => { stab(s, 6); shiftParty(s.parties[s.player], 'nat', 3); } },
    ],
  },
  {
    id: 'winter', title: 'Суровая зима', icon: 'castle',
    text: () => 'Морозы бьют рекорды. Угля на всех не хватает.',
    weight: (s) => (isWinter(s.turn) ? 4 : 0),
    options: [
      { label: 'Закупить уголь', effects: (s) => [down(`−${Math.round(inc(s) * 0.7)} денег`)], apply: (s) => pay(s, Math.round(inc(s) * 0.7)) },
      { label: 'Солдаты потерпят', effects: () => [down('−10% армии'), down('−4 стабильности')], apply: (s) => { s.army = Math.round(s.army * 0.9); stab(s, -4); } },
    ],
  },
  {
    id: 'mercs', title: 'Наёмники', icon: 'coins',
    text: () => 'Отряд опытных наёмников предлагает свои услуги. Недёшево.',
    weight: (s) => (s.turn > 3 ? 2 : 0),
    options: [
      { label: 'Нанять', effects: () => [up('+25 армии'), down('−220 денег')], apply: (s) => { pay(s, 220); s.army += 25; } },
      { label: 'Отказать', effects: () => [], apply: () => {} },
    ],
  },
  {
    id: 'scandal', title: 'Правительственный скандал', icon: 'ballot',
    text: (s) => `Журналисты раскрыли схему взяток. Под ударом — ${PARTIES[s.ruling[s.player]].name.toLowerCase()}.`,
    weight: (s) => (s.turn > 3 ? 2 : 0),
    options: [
      {
        label: 'Отставка министров', effects: (s) => [down(`−7% популярности: ${PARTIES[s.ruling[s.player]].name}`), up('+4 стабильности')],
        apply: (s) => { const r = s.ruling[s.player]; const others = PARTY_ORDER.filter((x) => x !== r); shiftParty(s.parties[s.player], others[Math.floor(Math.random() * 3)], 7); stab(s, 4); },
      },
      { label: 'Замять дело', effects: () => [down('−120 денег'), down('−3 стабильности')], apply: (s) => { pay(s, 120); stab(s, -3); } },
    ],
  },
  {
    id: 'strike', title: 'Забастовка рабочих', icon: 'factory',
    text: () => 'Профсоюзы остановили заводы и требуют повышения зарплат.',
    weight: (s) => (pct(s, 'soc') >= 25 ? 3 : 0),
    options: [
      {
        label: 'Поднять зарплаты', effects: (s) => [down(`−${Math.round(inc(s) * 0.8)} денег`), up('+5% социалистам'), up('+4 стабильности')],
        apply: (s) => { pay(s, Math.round(inc(s) * 0.8)); shiftParty(s.parties[s.player], 'soc', 5); stab(s, 4); },
      },
      { label: 'Ждать', effects: () => [down('−40% дохода в этот ход')], apply: (s) => { s.turnIncomeMul -= 0.4; } },
    ],
  },
  {
    id: 'march', title: 'Марш националистов', icon: 'flag',
    text: () => 'По столице прошли десятки тысяч человек с флагами. Требуют «вернуть величие».',
    weight: (s) => (pct(s, 'nat') >= 22 && s.ruling[s.player] !== 'nat' ? 3 : 0),
    options: [
      { label: 'Запретить марши', effects: () => [down('−5 стабильности'), up('+4% демократам')], apply: (s) => { stab(s, -5); shiftParty(s.parties[s.player], 'dem', 4); } },
      { label: 'Поддержать', effects: () => [up('+8 армии'), down('+6% националистам')], apply: (s) => { s.army += 8; shiftParty(s.parties[s.player], 'nat', 6); } },
    ],
  },
  {
    id: 'hero', title: 'Народный герой', icon: 'trophy',
    text: (s) => `Спортсмен из страны ${name(s)} выиграл чемпионат мира. Вся страна празднует.`,
    weight: () => 1,
    options: [
      { label: 'Устроить парад', effects: () => [up('+8 стабильности'), down('−50 денег')], apply: (s) => { stab(s, 8); pay(s, 50); } },
      { label: 'Сделать послом', effects: () => [up('+5 влияния')], apply: (s) => { s.influence += 5; } },
    ],
  },
  {
    id: 'refugees', title: 'Беженцы', icon: 'handshake',
    text: () => 'Война у границ гонит к вам тысячи беженцев.',
    weight: (s) => (s.events.some((e) => e.won && e.defender !== s.player) ? 3 : 0),
    options: [
      { label: 'Принять', effects: () => [up('+6 влияния'), down('−60 денег'), up('+3% демократам')], apply: (s) => { s.influence += 6; pay(s, 60); shiftParty(s.parties[s.player], 'dem', 3); } },
      { label: 'Закрыть границы', effects: () => [up('+3 стабильности'), down('+4% националистам')], apply: (s) => { stab(s, 3); shiftParty(s.parties[s.player], 'nat', 4); } },
    ],
  },
];

export const EVENT: Record<string, GameEvent> = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

const PLAYER_EVENT_CHANCE = 0.4;
const REPEAT_AFTER = 8;

function pickWeighted<T>(items: T[], weight: (x: T) => number): T | null {
  const total = items.reduce((a, x) => a + weight(x), 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const x of items) {
    r -= weight(x);
    if (r <= 0) return x;
  }
  return null;
}

/** Rolls this turn's events: maybe one for the player, maybe one somewhere in Europe. */
export function rollEvents(s: GameState) {
  s.eventSeen ??= {};
  s.pendingEvent = null;
  const forced = s.stability < 20; // revolutions don't wait for luck
  if (s.turn >= 2 && (forced || Math.random() < PLAYER_EVENT_CHANCE)) {
    const pool = EVENTS.filter((e) => s.turn - (s.eventSeen![e.id] ?? -99) >= REPEAT_AFTER);
    const ev = pickWeighted(pool, (e) => e.weight(s));
    if (ev) {
      s.pendingEvent = ev.id;
      s.eventSeen[ev.id] = s.turn;
    }
  }
  if (Math.random() < 0.3) foreignEvent(s);
}

export function resolveEvent(s: GameState, option: number) {
  const ev = s.pendingEvent ? EVENT[s.pendingEvent] : null;
  if (!ev || !ev.options[option]) return;
  ev.options[option].apply(s);
  log(s, `${ev.title}: ${ev.options[option].label.toLowerCase()}`, 'info');
  s.pendingEvent = null;
}

/** Something happens in a computer country. Changes how it behaves later. */
function foreignEvent(s: GameState) {
  const nations = COUNTRIES.map((c) => c.code).filter((c) => c !== s.player && alive(s, c));
  if (!nations.length) return;
  const n = nations[Math.floor(Math.random() * nations.length)];
  const who = COUNTRY[n].name;
  const roll = Math.random();
  if (roll < 0.35) {
    // coup: a different party takes over, the country's appetite for war changes
    const p = s.parties[n];
    const ruling = s.ruling[n];
    const next = PARTY_ORDER.filter((x) => x !== ruling)[Math.floor(Math.random() * 3)];
    shiftParty(p, next, 18);
    s.ruling[n] = next;
    log(s, `Переворот: ${who}. К власти пришли ${PARTIES[next].name.toLowerCase()}`, 'info');
  } else if (roll < 0.6) {
    s.ai[n].army = Math.round(s.ai[n].army * 0.8);
    log(s, `Эпидемия: ${who}. Армия страны ослабла`, 'info');
  } else if (roll < 0.8) {
    s.ai[n].money += COUNTRY[n].eco * 3;
    log(s, `${who} находит нефть и богатеет`, 'info');
  } else {
    s.ai[n].army += 10;
    log(s, `Мобилизация: ${who} усиливает армию`, 'info');
  }
}
