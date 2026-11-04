// "Как играть": short animated lessons on a tiny map drawn with the game's own markers.
import { icon } from './icons';
import { play } from './sound';

// ---------- the tiny map ----------

/** Six regions in two rows, 400×260. Shared corners keep borders clean. */
const R: Record<string, { d: string; c: [number, number] }> = {
  r1: { d: '18,34 70,20 128,26 142,62 134,104 88,116 30,120 14,78', c: [78, 70] },
  r2: { d: '128,26 190,16 252,30 246,72 254,116 198,104 134,104 142,62', c: [194, 64] },
  r3: { d: '252,30 318,22 382,40 388,88 372,128 312,116 254,116 246,72', c: [318, 74] },
  r4: { d: '30,120 88,116 134,104 128,170 140,236 74,240 20,226 14,172', c: [76, 176] },
  r5: { d: '134,104 198,104 254,116 266,176 258,232 196,244 140,236 128,170', c: [198, 174] },
  r6: { d: '254,116 312,116 372,128 386,180 376,224 318,234 258,232 266,176', c: [322, 176] },
};
const ME = '#4f7fd9';
const FOE = '#b5534b';
const NEU = '#5d8a4e';
const OTHER = '#c08a3e';
const FRIEND = '#8a6cc8';

const GLYPH: Record<string, string> = {
  army: 'M-3.6,-3.9 A3.6,2.9 0 0 1 3.6,-3.9 L4.4,-3.9 L4.4,-3.1 L-4.4,-3.1 L-4.4,-3.9 Z M-2.1,-2.9 L2.1,-2.9 L2.1,-1.9 A2.1,1.9 0 0 1 -2.1,-1.9 Z M-3.2,0 Q0,-1 3.2,0 L3.6,3.2 L2,3.2 L1.6,6.4 L0.4,6.4 L0,3.8 L-0.4,6.4 L-1.6,6.4 L-2,3.2 L-3.6,3.2 Z M3.9,-6.4 L4.9,-6.4 L4.9,2.6 L3.9,2.6 Z',
  air: 'M0,-6 L1.3,-1.5 L6,1 L6,2.4 L1.3,1.2 L1,4.2 L2.6,5.4 L2.6,6.3 L0,5.6 L-2.6,6.3 L-2.6,5.4 L-1,4.2 L-1.3,1.2 L-6,2.4 L-6,1 L-1.3,-1.5 Z',
  fleet: 'M-7,1 L7,1 L5,4.5 L-5,4.5 Z M-1,-5 L-1,1 M-1,-5 L4,-1 L-1,-1',
};

const region = (id: string, fill: string, a = id, extra = '') =>
  `<polygon class="hw-reg ${extra}" data-a="${a}" points="${R[id].d}" style="fill:${fill}"/>`;
const flash = (id: string, a = 'f' + id) => `<polygon class="hw-flash" data-a="${a}" points="${R[id].d}"/>`;

/** A unit counter like on the real map. `n2` crossfades in when the strength changes. */
function counter(x: number, y: number, n: number, color: string, opts: { type?: string; a?: string; n2?: number; n3?: number; mine?: boolean } = {}) {
  const a = opts.a ?? '';
  const nums = [n, opts.n2, opts.n3].filter((v) => v !== undefined)
    .map((v, i) => `<text class="hw-num" x="6" dy="0.36em" ${a ? `data-a="${a}-n${i + 1}"` : ''} ${i ? 'opacity="0"' : ''}>${v}</text>`).join('');
  return `<g transform="translate(${x},${y})"><g ${a ? `data-a="${a}"` : ''} class="hw-unit ${opts.type ?? 'army'} ${opts.mine === false ? '' : 'mine'}">
    <rect class="hw-halo" ${a ? `data-a="${a}-halo"` : ''} x="-21" y="-13" width="42" height="26" rx="8"/>
    <rect class="hw-plate" x="-17" y="-10" width="34" height="20" rx="5" style="fill:${color}"/>
    <path class="hw-glyph" d="${GLYPH[opts.type ?? 'army']}" transform="translate(-8,0)"/>${nums}</g></g>`;
}

/** Attack chip with the win chance. */
const chip = (x: number, y: number, text: string, tone: 'good' | 'mid' | 'bad', a: string) =>
  `<g transform="translate(${x},${y})"><g data-a="${a}" class="hw-chip ${tone}" opacity="0"><rect x="-20" y="-10" width="40" height="20" rx="10"/><text text-anchor="middle" dy="0.35em">${text}</text></g></g>`;
const move = (x: number, y: number, a: string) =>
  `<g transform="translate(${x},${y})"><g data-a="${a}" class="hw-move" opacity="0"><circle r="9"/><path d="M-3,-4 L2,0 L-3,4"/></g></g>`;
const cursor = (a = 'cur') =>
  `<g data-a="${a}" class="hw-cursor"><path d="M0,0 L0,16 L4.2,11.8 L7.4,18.6 L10,17.4 L6.9,10.7 L12.6,10.7 Z"/></g>`;
const tag = (x: number, y: number, text: string, tone: string, a: string, w = 0) => {
  const width = w || text.length * 6.6 + 18;
  return `<g transform="translate(${x},${y})"><g data-a="${a}" class="hw-tag ${tone}" opacity="0"><rect x="${-width / 2}" y="-11" width="${width}" height="22" rx="6"/><text text-anchor="middle" dy="0.35em">${text}</text></g></g>`;
};
const arrow = (from: [number, number], to: [number, number], a: string, bend = 0.18) => {
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return `<path class="hw-arrow" data-a="${a}" pathLength="1" d="M${from[0]},${from[1]} Q${mx - dy * bend},${my + dx * bend} ${to[0]},${to[1]}"/>`;
};
const blast = (x: number, y: number, a: string) =>
  `<g transform="translate(${x},${y})"><circle class="hw-blast" data-a="${a}" r="24"/><circle class="hw-blast" data-a="${a}b" r="24"/></g>`;

// ---------- timelines ----------

type Props = Record<string, string | number>;
type Track = [number, Props][];

/** Plays every track on its loop. Times are in seconds from the start of the loop. */
function run(root: Element, dur: number, tracks: Record<string, Track>) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anims: Animation[] = [];
  for (const [name, track] of Object.entries(tracks)) {
    const frames = [...track].sort((x, y) => x[0] - y[0]).map(([t, p]) => ({ ...p, offset: Math.min(1, Math.max(0, t / dur)) }));
    if (!frames.length) continue;
    if (frames[0].offset > 0) frames.unshift({ ...frames[0], offset: 0 });
    if (frames[frames.length - 1].offset < 1) frames.push({ ...frames[frames.length - 1], offset: 1 });
    root.querySelectorAll(`[data-a="${name}"]`).forEach((el) => {
      const an = el.animate(frames as Keyframe[], { duration: dur * 1000, iterations: Infinity, easing: 'linear', fill: 'both' });
      anims.push(an);
    });
  }
  if (still) for (const an of anims) { an.currentTime = dur * 1000 * 0.8; an.pause(); }
  return anims;
}

const E = 'cubic-bezier(.3,.7,.2,1)';
/** Visible between t0 and t1. */
const vis = (t0: number, t1: number, d = 0.3): Track => [[0, { opacity: 0 }], [t0, { opacity: 0 }], [t0 + d, { opacity: 1 }], [t1, { opacity: 1 }], [t1 + d, { opacity: 0 }]];
/** Pops in with a little overshoot. */
const pop = (t0: number, t1: number): Track => [
  [0, { opacity: 0, transform: 'scale(.4)' }], [t0, { opacity: 0, transform: 'scale(.4)' }],
  [t0 + 0.22, { opacity: 1, transform: 'scale(1.12)' }], [t0 + 0.36, { opacity: 1, transform: 'scale(1)' }],
  [t1, { opacity: 1, transform: 'scale(1)' }], [t1 + 0.3, { opacity: 0, transform: 'scale(.8)' }],
];
/** Slides by (dx,dy) between t0 and t1, back to the start at `back`. */
const slide = (steps: [number, number, number, number][], back: number): Track => {
  const out: Track = [[0, { transform: 'translate(0px,0px)' }]];
  let x = 0;
  let y = 0;
  for (const [t0, t1, dx, dy] of steps) {
    out.push([t0, { transform: `translate(${x}px,${y}px)`, easing: E }]);
    x = dx; y = dy;
    out.push([t1, { transform: `translate(${x}px,${y}px)` }]);
  }
  out.push([back, { transform: `translate(${x}px,${y}px)`, opacity: 1 }], [back + 0.3, { transform: `translate(${x}px,${y}px)`, opacity: 0 }], [back + 0.31, { transform: 'translate(0px,0px)', opacity: 0 }], [back + 0.6, { opacity: 1 }]);
  return out;
};
/** Region changes colour at t, back at `back`. */
const paint = (from: string, to: string, t: number, back: number): Track => [[0, { fill: from }], [t, { fill: from }], [t + 0.35, { fill: to }], [back, { fill: to }], [back + 0.4, { fill: from }]];
const flashAt = (t: number): Track => [[0, { opacity: 0 }], [t, { opacity: 0 }], [t + 0.12, { opacity: 0.55 }], [t + 0.7, { opacity: 0 }]];
const draw = (t0: number, t1: number, off: number): Track => [[0, { strokeDashoffset: 1, opacity: 1 }], [t0, { strokeDashoffset: 1, opacity: 1, easing: E }], [t1, { strokeDashoffset: 0, opacity: 1 }], [off, { strokeDashoffset: 0, opacity: 1 }], [off + 0.3, { strokeDashoffset: 0, opacity: 0 }]];
/** Cursor path: [time, x, y, click?]. */
const cursorPath = (pts: [number, number, number, boolean?][]): Track => {
  const out: Track = [];
  for (const [t, x, y, click] of pts) {
    out.push([t, { transform: `translate(${x}px,${y}px) scale(1)`, opacity: 1, easing: E }]);
    if (click) {
      out.push([t + 0.08, { transform: `translate(${x}px,${y}px) scale(.82)`, opacity: 1 }]);
      out.push([t + 0.2, { transform: `translate(${x}px,${y}px) scale(1)`, opacity: 1, easing: E }]);
    }
  }
  const [lt, lx, ly] = pts[pts.length - 1];
  out.unshift([0, { transform: `translate(${pts[0][1]}px,${pts[0][2]}px) scale(1)`, opacity: 0 }]);
  out.push([lt + 0.5, { transform: `translate(${lx}px,${ly}px) scale(1)`, opacity: 0 }]);
  return out;
};
const blastAt = (t: number): Track => [[0, { opacity: 0, transform: 'scale(.2)' }], [t, { opacity: 0.9, transform: 'scale(.2)', easing: 'ease-out' }], [t + 0.6, { opacity: 0, transform: 'scale(1.4)' }]];
/** A number that shows from t0 to t1 (for crossfading strengths). */
const num = (t0: number, t1: number): Track => (t0 <= 0
  ? [[0, { opacity: 1 }], [t1, { opacity: 1 }], [t1 + 0.2, { opacity: 0 }], [99, { opacity: 0 }]]
  : [[0, { opacity: 0 }], [t0, { opacity: 0 }], [t0 + 0.2, { opacity: 1 }], [t1, { opacity: 1 }], [t1 + 0.2, { opacity: 0 }]]);
/** First number again once the loop restarts. */
const numBack = (t1: number, back: number): Track => [[0, { opacity: 1 }], [t1, { opacity: 1 }], [t1 + 0.2, { opacity: 0 }], [back, { opacity: 0 }], [back + 0.2, { opacity: 1 }]];

// ---------- lessons ----------

interface Lesson { nav: string; title: string; points: string[]; dur: number; svg: string; tracks: Record<string, Track> }

const LESSONS: Lesson[] = [
  {
    nav: 'Цель игры', title: 'Объедините Европу',
    points: [
      'Выберите любую из 41 страны. У каждой своя армия, экономика и особенность.',
      'Захватывайте области одну за другой. Победа — вся Европа, или самая большая держава через 30 ходов в короткой партии.',
      'Страна падает, когда у неё не остаётся ни одной ключевой области.',
    ],
    dur: 7.5,
    svg: region('r1', ME) + region('r2', NEU) + region('r3', OTHER) + region('r4', FOE) + region('r5', NEU) + region('r6', FRIEND)
      + ['r2', 'r4', 'r5', 'r3', 'r6'].map((r) => flash(r)).join('')
      + tag(200, 130, 'Европа ваша', 'gold', 'win', 130),
    tracks: {
      r2: paint(NEU, ME, 0.9, 6.8), fr2: flashAt(0.9),
      r4: paint(FOE, ME, 2.0, 6.8), fr4: flashAt(2.0),
      r5: paint(NEU, ME, 3.1, 6.8), fr5: flashAt(3.1),
      r3: paint(OTHER, ME, 4.2, 6.8), fr3: flashAt(4.2),
      r6: paint(FRIEND, ME, 5.2, 6.8), fr6: flashAt(5.2),
      win: pop(5.6, 6.7),
    },
  },
  {
    nav: 'Ход и приказы', title: 'Отдайте приказы и завершите ход',
    points: [
      'Нажмите на свою армию: зелёные стрелки — куда можно перейти.',
      'Каждый отряд действует один раз за ход. Отдавайте приказы, пока не надоест, затем «Конец хода».',
      'После этого ходят все остальные страны, и начинается новый ход.',
    ],
    dur: 8,
    svg: region('r1', ME) + region('r2', ME) + region('r4', ME) + region('r3', FOE) + region('r5', NEU) + region('r6', FOE)
      + move(194, 64, 'm1') + move(76, 176, 'm2')
      + counter(78, 66, 40, ME, { a: 'u' })
      + `<g transform="translate(300,226)"><g data-a="endbtn" class="hw-btn"><rect x="-48" y="-14" width="96" height="28" rx="8"/><text text-anchor="middle" dy="0.35em">Конец хода</text></g></g>`
      + `<g class="hw-turn" transform="translate(356,24)"><text data-a="t1" text-anchor="end">Ход 4</text><text data-a="t2" text-anchor="end" opacity="0">Ход 5</text></g>`
      + cursor(),
    tracks: {
      cur: cursorPath([[0.3, 320, 236], [1.2, 84, 72, true], [2.4, 84, 72], [3.1, 200, 70, true], [4.4, 205, 90], [5.1, 306, 230, true], [6.2, 306, 230]]),
      'u-halo': vis(1.3, 3.2, 0.15),
      m1: pop(1.6, 3.2), m2: pop(1.75, 3.2),
      u: [[0, { transform: 'translate(0px,0px)', opacity: 1 }], [3.3, { transform: 'translate(0px,0px)', opacity: 1, easing: E }], [4.0, { transform: 'translate(116px,-2px)', opacity: 1 }], [4.2, { transform: 'translate(116px,-2px)', opacity: 0.5 }], [5.3, { transform: 'translate(116px,-2px)', opacity: 0.5 }], [5.6, { transform: 'translate(116px,-2px)', opacity: 1 }], [7.3, { transform: 'translate(116px,-2px)', opacity: 1 }], [7.6, { transform: 'translate(116px,-2px)', opacity: 0 }], [7.61, { transform: 'translate(0px,0px)', opacity: 0 }], [7.9, { opacity: 1 }]],
      endbtn: [[0, { transform: 'scale(1)' }], [5.15, { transform: 'scale(1)' }], [5.25, { transform: 'scale(.92)' }], [5.45, { transform: 'scale(1)' }]],
      t1: numBack(5.4, 7.5), t2: num(5.5, 7.4),
    },
  },
  {
    nav: 'Атака', title: 'Процент — это шанс победы',
    points: [
      'Рядом с врагом появляется значок с процентом. Зелёный — шанс хороший, красный — лучше подождать.',
      'Ползунок в панели решает, сколько солдат отправить.',
      'Победитель занимает область и забирает трофеи: деньги и пленных.',
    ],
    dur: 8,
    svg: region('r1', ME) + region('r2', FOE) + region('r4', ME) + region('r3', FOE) + region('r5', NEU) + region('r6', NEU) + flash('r2')
      + arrow([92, 70], [186, 64], 'arr')
      + counter(194, 64, 18, FOE, { a: 'e', mine: false })
      + counter(78, 66, 40, ME, { a: 'u', n2: 31 })
      + chip(194, 92, '72%', 'good', 'ch')
      + tag(206, 122, '+12 денег', 'gold', 'loot', 84)
      + cursor(),
    tracks: {
      'u-halo': vis(0.4, 2.6, 0.15),
      ch: pop(0.8, 2.5),
      cur: cursorPath([[0.4, 330, 220], [1.6, 200, 98, true], [2.6, 205, 110]]),
      arr: draw(2.5, 3.1, 3.8),
      fr2: flashAt(3.2),
      e: [[0, { opacity: 1, transform: 'scale(1)' }], [3.2, { opacity: 1, transform: 'scale(1)' }], [3.6, { opacity: 0, transform: 'scale(.6)' }], [7.4, { opacity: 0, transform: 'scale(.6)' }], [7.7, { opacity: 1, transform: 'scale(1)' }]],
      r2: paint(FOE, ME, 3.3, 7.3),
      u: slide([[3.5, 4.2, 116, -2]], 7.2),
      'u-n1': numBack(3.8, 7.6), 'u-n2': num(3.9, 7.4),
      loot: [[0, { opacity: 0, transform: 'translate(0px,0px)' }], [4.2, { opacity: 0, transform: 'translate(0px,0px)' }], [4.5, { opacity: 1, transform: 'translate(0px,-6px)' }], [5.6, { opacity: 1, transform: 'translate(0px,-14px)' }], [6.0, { opacity: 0, transform: 'translate(0px,-18px)' }]],
    },
  },
  {
    nav: 'Совместный удар', title: 'Бейте вместе из разных областей',
    points: [
      'Выберите цель, затем подключите армии из соседних областей.',
      'Каждая подключённая армия добавляет силу и поднимает шанс.',
      'В область входит главная армия, остальные остаются на месте.',
    ],
    dur: 8.6,
    svg: region('r1', ME) + region('r4', ME) + region('r2', NEU) + region('r5', FOE) + region('r3', NEU) + region('r6', FOE) + flash('r5')
      + arrow([92, 74], [190, 166], 'a1', 0.12) + arrow([92, 178], [184, 172], 'a2', -0.25)
      + counter(198, 174, 40, FOE, { a: 'e', mine: false })
      + counter(78, 66, 30, ME, { a: 'u', n2: 24 })
      + counter(76, 176, 25, ME, { a: 'j', n2: 20 })
      + chip(198, 202, '38%', 'bad', 'c1') + chip(198, 202, '71%', 'good', 'c2')
      + tag(76, 208, 'В атаке', 'gold', 'jt', 64)
      + cursor(),
    tracks: {
      'u-halo': vis(0.4, 4.0, 0.15),
      c1: [[0, { opacity: 0 }], [0.8, { opacity: 0 }], [1.05, { opacity: 1 }], [2.5, { opacity: 1 }], [2.7, { opacity: 0 }]],
      c2: [[0, { opacity: 0 }], [2.55, { opacity: 0 }], [2.75, { opacity: 1 }], [3.9, { opacity: 1 }], [4.2, { opacity: 0 }]],
      cur: cursorPath([[0.5, 330, 236], [1.6, 82, 180, true], [2.6, 90, 190], [3.2, 204, 206, true], [4.2, 220, 226]]),
      'j-halo': vis(1.75, 4.6, 0.15), jt: pop(1.8, 4.4),
      a1: draw(3.4, 4.0, 4.8), a2: draw(3.5, 4.1, 4.8),
      fr5: flashAt(4.3),
      e: [[0, { opacity: 1 }], [4.3, { opacity: 1 }], [4.7, { opacity: 0 }], [7.8, { opacity: 0 }], [8.1, { opacity: 1 }]],
      r5: paint(FOE, ME, 4.4, 7.8),
      u: slide([[4.6, 5.4, 120, 108]], 7.7),
      'u-n1': numBack(4.5, 8.1), 'u-n2': num(4.6, 7.9),
      'j-n1': numBack(4.5, 8.1), 'j-n2': num(4.6, 7.9),
    },
  },
  {
    nav: 'Флот', title: 'Флот открывает путь по морю',
    points: [
      'Пунктир через море — переправа: по ней можно высадиться на чужой берег или остров.',
      'Пока в море стоит более сильный флот врага, высадка невозможна.',
      'Потопите его своим флотом или авиацией, и путь открыт.',
    ],
    dur: 9,
    svg: region('r1', ME) + region('r4', ME) + region('r3', FOE) + region('r6', FOE) + flash('r3')
      + `<text class="hw-sea" x="198" y="200" text-anchor="middle">Северное море</text>`
      + `<path class="hw-cross" data-a="cr" d="M96,64 Q198,8 300,70"/><path class="hw-cross open" data-a="cr2" d="M96,64 Q198,8 300,70" opacity="0"/>`
      + `<g transform="translate(198,38)"><g data-a="x" class="hw-x" opacity="0"><circle r="10"/><path d="M-4,-4 L4,4 M4,-4 L-4,4"/></g></g>`
      + counter(198, 130, 20, FOE, { type: 'fleet', a: 'ef', mine: false })
      + counter(196, 226, 28, ME, { type: 'fleet', a: 'mf' })
      + blast(198, 130, 'bl')
      + counter(78, 66, 40, ME, { a: 'u' })
      + chip(318, 102, '68%', 'good', 'ch')
      + tag(198, 82, 'Флот врага мешает высадке', 'bad', 'tb', 176) + tag(198, 82, 'Путь открыт', 'good', 'tg', 100)
      + arrow([92, 62], [304, 70], 'arr', -0.3),
    tracks: {
      'u-halo': vis(0.4, 2.0, 0.15),
      x: pop(0.8, 4.2), tb: pop(1.0, 2.9),
      'mf-halo': vis(2.2, 3.6, 0.15),
      mf: slide([[2.6, 3.4, -18, -96], [4.0, 4.4, 2, -96]], 8.5),
      bl: blastAt(3.5), blb: blastAt(3.7),
      ef: [[0, { opacity: 1 }], [3.5, { opacity: 1 }], [3.9, { opacity: 0 }], [8.5, { opacity: 0 }], [8.8, { opacity: 1 }]],
      cr: [[0, { opacity: 1 }], [4.4, { opacity: 1 }], [4.7, { opacity: 0 }], [8.5, { opacity: 0 }], [8.8, { opacity: 1 }]],
      cr2: [[0, { opacity: 0 }], [4.4, { opacity: 0 }], [4.7, { opacity: 1 }], [8.5, { opacity: 1 }], [8.8, { opacity: 0 }]],
      tg: pop(4.6, 5.8),
      ch: pop(5.4, 6.2),
      arr: draw(6.1, 6.7, 7.3),
      fr3: flashAt(6.8),
      r3: paint(FOE, ME, 6.9, 8.4),
      u: slide([[7.0, 7.8, 240, 8]], 8.4),
    },
  },
  {
    nav: 'Авиация', title: 'Самолёты бьют, но не захватывают',
    points: [
      'Авиакрыло ударяет по вражеским армиям и флотам в двух областях от базы.',
      'Удар снимает часть солдат, и потом атаковать их армией проще.',
      'Землю авиация не берёт — область остаётся у врага.',
    ],
    dur: 7.5,
    svg: region('r1', ME) + region('r4', ME) + region('r2', ME) + region('r3', FOE) + region('r5', FOE) + region('r6', FOE)
      + `<circle class="hw-range" data-a="ring" cx="76" cy="176" r="150" opacity="0"/>`
      + counter(198, 174, 36, FOE, { a: 'e', n2: 27, mine: false })
      + counter(322, 176, 20, FOE, { a: 'e2', mine: false })
      + `<g transform="translate(198,150)"><g data-a="t1" class="hw-strike" opacity="0"><circle r="10"/><path d="M-6,0 H-2 M2,0 H6 M0,-6 V-2 M0,2 V6"/></g></g>`
      + `<g transform="translate(322,152)"><g data-a="t2" class="hw-strike" opacity="0"><circle r="10"/><path d="M-6,0 H-2 M2,0 H6 M0,-6 V-2 M0,2 V6"/></g></g>`
      + counter(76, 176, 15, ME, { type: 'air', a: 'air' })
      + `<g data-a="plane" class="hw-plane" opacity="0"><path d="${GLYPH.air}" transform="rotate(90) scale(1.3)"/></g>`
      + blast(198, 174, 'bl')
      + tag(198, 214, '−9 солдат', 'bad', 'dmg', 80)
      + tag(198, 120, 'Земля остаётся у врага', 'muted', 'note', 150)
      + cursor(),
    tracks: {
      'air-halo': vis(0.4, 2.8, 0.15),
      ring: vis(0.7, 2.8),
      t1: pop(1.0, 2.8), t2: pop(1.15, 2.8),
      cur: cursorPath([[0.4, 330, 236], [1.8, 204, 156, true], [2.8, 214, 170]]),
      plane: [[0, { opacity: 0, transform: 'translate(76px,170px)' }], [2.8, { opacity: 0, transform: 'translate(76px,170px)' }], [2.9, { opacity: 1, transform: 'translate(76px,170px)', easing: 'ease-in' }], [3.5, { opacity: 1, transform: 'translate(198px,168px)' }], [3.6, { opacity: 0, transform: 'translate(210px,168px)' }]],
      bl: blastAt(3.5), blb: blastAt(3.7),
      'e-n1': numBack(3.6, 7.2), 'e-n2': num(3.7, 7.0),
      dmg: [[0, { opacity: 0, transform: 'translate(0px,0px)' }], [3.7, { opacity: 0, transform: 'translate(0px,0px)' }], [3.9, { opacity: 1, transform: 'translate(0px,-4px)' }], [5.0, { opacity: 1, transform: 'translate(0px,-10px)' }], [5.3, { opacity: 0, transform: 'translate(0px,-12px)' }]],
      note: pop(5.0, 6.9),
    },
  },
  {
    nav: 'Рельеф', title: 'Горы и реки помогают защитникам',
    points: [
      'Горы на карте отмечены штриховкой из вершин: оборона там на 30% сильнее.',
      'Синие линии — крупные реки: атака через реку слабее на 20%.',
      'Обходите горы и переправы или собирайте армию побольше.',
    ],
    dur: 8,
    svg: region('r2', ME) + region('r1', FOE) + region('r3', FOE) + region('r5', FOE) + region('r4', NEU) + region('r6', NEU)
      + `<polygon class="hw-peaks" data-a="pk" points="${R.r5.d}" opacity="0"/>`
      + `<path class="hw-river" data-a="rv" pathLength="1" d="M258,22 C244,44 256,58 246,74 S258,100 252,124"/>`
      + counter(194, 64, 40, ME, { a: 'u' })
      + chip(78, 92, '74%', 'good', 'c1')
      + chip(198, 196, '52%', 'mid', 'c2') + tag(198, 222, 'Горы: оборона +30%', 'muted', 'g2', 130)
      + chip(318, 92, '58%', 'mid', 'c3') + tag(318, 118, 'Река: атака −20%', 'blue', 'g3', 116),
    tracks: {
      'u-halo': vis(0.3, 7.3, 0.15),
      c1: pop(0.7, 7.2),
      pk: vis(1.8, 7.2, 0.5), c2: pop(2.3, 7.2), g2: pop(2.5, 7.2),
      rv: draw(3.8, 4.6, 7.2), c3: pop(4.6, 7.2), g3: pop(4.8, 7.2),
    },
  },
  {
    nav: 'Снабжение', title: 'Чем дальше от дома, тем слабее',
    points: [
      'Армия снабжается со своих земель. Две области вглубь — без потерь.',
      'Дальше армия теряет силу в бою и солдат каждый ход.',
      'Если враг отрезал дорогу домой, армия окружена: −40% силы.',
    ],
    dur: 9.4,
    svg: region('r1', ME) + region('r4', ME) + region('r2', ME, 'r2', 'occ') + region('r3', ME, 'r3', 'occ') + region('r6', ME, 'r6', 'occ') + region('r5', FOE) + flash('r3')
      + `<path class="hw-supply" data-a="sup" d="M78,70 L194,64 L318,74 L322,176"/>`
      + `<path class="hw-supply cut" data-a="sup2" d="M194,64 L318,74 L322,176" opacity="0"/>`
      + counter(194, 64, 50, ME, { a: 'u', n2: 46, n3: 38 })
      + counter(198, 174, 30, FOE, { a: 'e', mine: false })
      + tag(194, 92, 'Снабжение в норме', 'good', 's1', 128)
      + tag(322, 204, 'Далеко: −10% силы', 'gold', 's2', 128)
      + tag(322, 204, 'Окружена: −40% силы', 'bad', 's3', 140),
    tracks: {
      s1: pop(0.5, 1.9),
      u: slide([[2.1, 2.8, 124, 10], [3.4, 4.1, 128, 112]], 8.9),
      s2: pop(4.3, 6.0),
      'u-n1': numBack(5.0, 9.0), 'u-n2': num(5.1, 7.3), 'u-n3': num(7.4, 8.8),
      e: slide([[5.9, 6.6, 120, -100]], 8.9),
      fr3: flashAt(6.6),
      r3: paint(ME, FOE, 6.65, 8.9),
      sup2: vis(6.7, 8.8),
      s3: pop(6.9, 8.6),
    },
  },
  {
    nav: 'Экономика', title: 'Области приносят деньги и солдат',
    points: [
      'Промышленные области дают деньги, призывные — солдат, крупные центры — и то и другое.',
      'Занятая чужая земля даёт половину и копит недовольство, пока через 12 ходов не станет своей.',
      'Армия в области успокаивает людей. При 100% недовольства — восстание.',
    ],
    dur: 8.4,
    svg: region('r1', ME) + region('r2', ME) + region('r4', ME) + region('r5', ME) + region('r3', ME, 'r3', 'occ') + region('r6', FOE)
      + `<g class="hw-hud" transform="translate(16,14)"><rect width="104" height="26" rx="8"/><g transform="translate(14,13)">${coinSvg()}</g><text data-a="m1" x="30" y="17">120</text><text data-a="m2" x="30" y="17" opacity="0">163</text></g>`
      + tag(78, 92, '+14 · +2', 'gold', 'y1', 70) + tag(194, 90, '+18', 'gold', 'y2', 42) + tag(76, 200, '+4 солдат', 'red', 'y3', 78)
      + tag(198, 140, '+9', 'gold', 'y4', 34) + tag(318, 84, '+4 · половина', 'gold', 'y5', 100)
      + `<g transform="translate(318,50)"><g class="hw-unrest" data-a="ub" opacity="0"><rect x="-34" y="-5" width="68" height="10" rx="5"/><rect class="fill" data-a="uf" x="-34" y="-5" width="68" height="10" rx="5"/></g></g>`
      + tag(318, 28, 'Недовольство', 'bad', 'ut', 96)
      + counter(198, 174, 20, ME, { a: 'g' })
      + tag(318, 112, 'Армия успокаивает', 'good', 'gt', 128),
    tracks: {
      y1: pop(0.6, 2.8), y2: pop(0.8, 2.8), y3: pop(1.0, 2.8), y4: pop(1.2, 2.8), y5: pop(1.4, 2.8),
      m1: numBack(2.9, 8.0), m2: num(3.0, 7.8),
      ub: vis(3.6, 7.8), ut: pop(3.6, 5.2),
      uf: [[0, { transform: 'scaleX(.2)' }], [3.7, { transform: 'scaleX(.2)', fill: '#e0c04a', easing: E }], [5.0, { transform: 'scaleX(.85)', fill: '#e2574c' }], [6.0, { transform: 'scaleX(.85)', fill: '#e2574c', easing: E }], [7.0, { transform: 'scaleX(.35)', fill: '#e0c04a' }]],
      g: slide([[5.2, 5.9, 120, -90]], 7.8),
      gt: pop(6.0, 7.6),
    },
  },
  {
    nav: 'Дипломатия', title: 'Войны, союзы и мир',
    points: [
      'Чтобы атаковать, нужна война. Союзники и друзья жертвы могут вступиться — окно объявления войны предупредит.',
      'На старте отношения как в нынешней Европе: ЕС и НАТО дружат, у России и Беларуси холод с Западом.',
      'Мир можно заключить в любой момент: белый, с сохранением занятого или с репарациями.',
    ],
    dur: 9,
    svg: region('r1', ME) + region('r4', ME) + region('r2', FOE) + region('r5', FOE) + region('r3', FRIEND) + region('r6', FRIEND) + flash('r5')
      + `<path class="hw-front" data-a="fr" pathLength="1" d="M128,26 L142,62 L134,104 L128,170 L140,236"/>`
      + tag(196, 132, 'Война', 'bad', 'w', 60)
      + `<path class="hw-ally" data-a="al" d="M300,120 Q250,150 214,150"/>`
      + tag(318, 200, 'Друг вступается', 'muted', 'at', 116)
      + tag(200, 100, 'Мир: оставить занятое', 'good', 'pc', 158)
      + tag(200, 100, 'Перемирие 10 ходов', 'muted', 'tr', 140),
    tracks: {
      fr: draw(0.6, 1.4, 5.6), w: pop(1.0, 5.4),
      al: vis(2.2, 5.6), at: pop(2.4, 4.4),
      fr5: flashAt(3.8), r5: paint(FOE, ME, 3.9, 8.4),
      pc: pop(5.6, 6.9), tr: pop(7.0, 8.4),
    },
  },
  {
    nav: 'Цели и курс', title: 'Национальные цели и постоянный курс',
    points: [
      'Выберите цель — через несколько ходов она даст бонус навсегда: доход, атаку, оборону, войска.',
      'У 10 крупных стран свои цели, у остальных общие.',
      'Когда цели кончатся, выберите постоянный курс: бонус каждый ход, сменить можно в любой момент.',
    ],
    dur: 9,
    svg: `<g transform="translate(30,26)">
        ${goalCard(0, 0, 'Индустриализация', '+10% к доходу', 'g1')}
        ${goalCard(176, 0, 'Военная реформа', '+10% к атаке', 'g2')}
      </g>
      <g transform="translate(30,118)">
        <text class="hw-h" x="0" y="0">Постоянный курс</text>
        ${courseCard(0, 12, 'Порядок', '+2 стабильности за ход', 'k1')}
        ${courseCard(176, 12, 'Рост', '+10% к доходу', 'k2')}
      </g>
      <g class="hw-hud" transform="translate(125,214)"><rect width="150" height="26" rx="8"/><text x="12" y="17">Стабильность</text><text data-a="s1" x="138" y="17" text-anchor="end">70%</text><text data-a="s2" x="138" y="17" text-anchor="end" opacity="0">72%</text><text data-a="s3" x="138" y="17" text-anchor="end" opacity="0">74%</text></g>`
      + cursor(),
    tracks: {
      g1b: [[0, { transform: 'scaleX(0)' }], [0.5, { transform: 'scaleX(0)', easing: E }], [1.1, { transform: 'scaleX(.25)' }], [1.4, { transform: 'scaleX(.25)', easing: E }], [2.0, { transform: 'scaleX(.5)' }], [2.3, { transform: 'scaleX(.5)', easing: E }], [2.9, { transform: 'scaleX(.75)' }], [3.2, { transform: 'scaleX(.75)', easing: E }], [3.8, { transform: 'scaleX(1)' }], [8.5, { transform: 'scaleX(1)' }], [8.8, { transform: 'scaleX(0)' }]],
      g1d: pop(3.9, 8.5),
      g2b: [[0, { transform: 'scaleX(0)' }], [4.0, { transform: 'scaleX(0)', easing: E }], [4.8, { transform: 'scaleX(1)' }], [8.5, { transform: 'scaleX(1)' }], [8.8, { transform: 'scaleX(0)' }]],
      g2d: pop(4.9, 8.5),
      cur: cursorPath([[4.6, 330, 240], [5.5, 90, 160, true], [6.6, 120, 190]]),
      k1: [[0, { opacity: 0.45 }], [5.0, { opacity: 0.45 }], [5.2, { opacity: 1 }], [8.5, { opacity: 1 }], [8.8, { opacity: 0.45 }]],
      k2: [[0, { opacity: 0.45 }], [5.0, { opacity: 0.45 }], [5.2, { opacity: 1 }], [8.5, { opacity: 1 }], [8.8, { opacity: 0.45 }]],
      k1on: vis(5.6, 8.5, 0.2),
      s1: numBack(6.6, 8.6), s2: num(6.7, 7.5), s3: num(7.6, 8.5),
    },
  },
];

function coinSvg() {
  return '<circle r="6.5" fill="#f0b94d" stroke="#2b1d04" stroke-width="1.2"/><circle r="3.4" fill="none" stroke="#8a5a10" stroke-width="1.2"/>';
}
function goalCard(x: number, y: number, name: string, text: string, a: string) {
  return `<g transform="translate(${x},${y})" class="hw-card">
    <rect width="164" height="74" rx="10"/>
    <text class="hw-card-t" x="12" y="30">${name}</text><text class="hw-card-s" x="12" y="46">${text}</text>
    <rect class="hw-bar" x="12" y="54" width="140" height="6" rx="3"/>
    <rect class="hw-bar-fill" data-a="${a}b" x="12" y="54" width="140" height="6" rx="3"/>
    <g transform="translate(150,15)"><g data-a="${a}d" class="hw-done" opacity="0"><circle r="8"/><path d="M-4,0 L-1,3 L4,-3"/></g></g>
  </g>`;
}
function courseCard(x: number, y: number, name: string, text: string, a: string) {
  return `<g transform="translate(${x},${y})"><g class="hw-card course" data-a="${a}" opacity=".45">
    <rect width="164" height="60" rx="10"/>
    <rect class="hw-card-on" data-a="${a}on" width="164" height="60" rx="10" opacity="0"/>
    <text class="hw-card-t" x="12" y="26">${name}</text><text class="hw-card-s" x="12" y="44">${text}</text>
  </g></g>`;
}

// ---------- the window ----------

export class HowTo {
  private el: HTMLElement;
  private i = 0;
  private anims: Animation[] = [];
  private onTutorial: (() => void) | null = null;
  private keys = (e: KeyboardEvent) => {
    if (!this.el.classList.contains('open')) return;
    if (e.key === 'ArrowRight') this.go(this.i + 1);
    else if (e.key === 'ArrowLeft') this.go(this.i - 1);
    else if (e.key === 'Escape') this.close();
  };

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', this.keys);
  }

  open(onTutorial?: () => void) {
    this.onTutorial = onTutorial ?? null;
    this.el.innerHTML = `
      <div class="ht-box" role="dialog" aria-modal="true" aria-labelledby="ht-title">
        <nav class="ht-nav" aria-label="Разделы">
          <div class="ht-brand">Как играть</div>
          ${LESSONS.map((l, i) => `<button class="ht-tab" data-i="${i}"><span class="ht-no">${String(i + 1).padStart(2, '0')}</span>${l.nav}</button>`).join('')}
        </nav>
        <section class="ht-main">
          <button class="icon-btn ht-close" aria-label="Закрыть">${icon('close', 16)}</button>
          <div class="ht-stage"><svg class="hw" viewBox="0 0 400 260" aria-hidden="true">
            <defs><pattern id="hw-peaks" patternUnits="userSpaceOnUse" width="16" height="13"><path d="M1,10 L5,4.5 L9,10 M7.5,7.5 L10.5,3.5 L14.5,10" fill="none" stroke="rgba(255,255,255,.42)" stroke-width="1.1" stroke-linejoin="round"/></pattern>
            <pattern id="hw-occ" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><rect width="2" height="7" fill="rgba(255,255,255,.18)"/></pattern></defs>
            <g class="hw-scene"></g></svg></div>
          <div class="ht-text">
            <div class="ht-step"></div>
            <h2 id="ht-title"></h2>
            <ul class="ht-points"></ul>
          </div>
          <div class="ht-foot">
            <button class="btn ghost" data-go="prev">${icon('prev', 16)} Назад</button>
            <div class="ht-dots">${LESSONS.map((_, i) => `<i data-i="${i}"></i>`).join('')}</div>
            <button class="btn primary" data-go="next">Далее ${icon('next', 16)}</button>
          </div>
        </section>
      </div>`;
    this.el.classList.add('open');
    this.el.onclick = (e) => { if (e.target === this.el) this.close(); };
    this.el.querySelector<HTMLButtonElement>('.ht-close')!.onclick = () => this.close();
    this.el.querySelectorAll<HTMLButtonElement>('.ht-tab').forEach((b) => { b.onclick = () => this.go(Number(b.dataset.i)); });
    this.el.querySelector<HTMLButtonElement>('[data-go="prev"]')!.onclick = () => this.go(this.i - 1);
    this.el.querySelector<HTMLButtonElement>('[data-go="next"]')!.onclick = () => {
      if (this.i < LESSONS.length - 1) this.go(this.i + 1);
      else if (this.onTutorial) { this.close(); this.onTutorial(); } else this.close();
    };
    this.go(0, true);
    this.el.querySelector<HTMLButtonElement>('[data-go="next"]')!.focus();
  }

  close() {
    for (const a of this.anims) a.cancel();
    this.anims = [];
    this.el.classList.remove('open');
    this.el.innerHTML = '';
  }

  private go(i: number, first = false) {
    if (i < 0 || i >= LESSONS.length) return;
    if (!first) play('click');
    const back = i < this.i;
    this.i = i;
    const l = LESSONS[i];
    for (const a of this.anims) a.cancel();
    const scene = this.el.querySelector<SVGGElement>('.hw-scene')!;
    scene.innerHTML = l.svg;
    this.anims = run(scene, l.dur, l.tracks);
    const text = this.el.querySelector<HTMLElement>('.ht-text')!;
    text.classList.remove('in', 'back');
    void text.offsetWidth; // restart the entrance
    text.classList.add('in');
    if (back) text.classList.add('back');
    this.el.querySelector('.ht-step')!.textContent = `${String(i + 1).padStart(2, '0')} / ${String(LESSONS.length).padStart(2, '0')}`;
    this.el.querySelector('#ht-title')!.textContent = l.title;
    this.el.querySelector('.ht-points')!.innerHTML = l.points.map((p) => `<li>${p}</li>`).join('');
    this.el.querySelectorAll('.ht-tab').forEach((b, k) => b.classList.toggle('on', k === i));
    this.el.querySelectorAll('.ht-dots i').forEach((d, k) => d.classList.toggle('on', k <= i));
    this.el.querySelector<HTMLButtonElement>('[data-go="prev"]')!.disabled = i === 0;
    const next = this.el.querySelector<HTMLButtonElement>('[data-go="next"]')!;
    next.innerHTML = i < LESSONS.length - 1 ? `Далее ${icon('next', 16)}` : this.onTutorial ? `Обучение на карте ${icon('play', 15)}` : 'Понятно';
    this.el.querySelector('.ht-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
