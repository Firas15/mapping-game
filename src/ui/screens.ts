// HTML for the bigger windows: ranking, national goals, peace, end of game.
import { COUNTRY, flagUrl } from '../data/countries';
import { REGIONS } from '../data/regions';
import { type GameState, DIFFICULTY, ownedBy } from '../game/state';
import { METRICS, type Metric, ACHIEVEMENTS, ranking } from '../game/stats';
import { COURSES, FOCUS, available, coursesOpen, focusesOf } from '../game/focus';
import { type PeaceTerms, reparationsOf, warOf } from '../game/war';
import { peaceAnswer, warScore } from '../game/rules';
import { icon } from './icons';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

export function rankingHtml(s: GameState, m: Metric) {
  const rows = ranking(s, m);
  const top = Math.max(1, rows[0]?.v ?? 1);
  const tabs = METRICS.map((x) => `<button class="tab ${x.id === m ? 'on' : ''}" data-metric="${x.id}">${icon(x.icon, 15)}<span>${x.name}</span></button>`).join('');
  const list = rows.slice(0, 15).map((r, i) => `
    <li class="${r.n === s.player ? 'me' : ''}">
      <span class="rk">${i + 1}</span>
      <img src="${flagUrl(r.n)}" alt="" class="flag-s">
      <span class="rn">${COUNTRY[r.n].name}</span>
      <span class="rbar"><i style="width:${(r.v / top) * 100}%;background:${COUNTRY[r.n].color}"></i></span>
      <b>${fmt(r.v)}</b>
    </li>`).join('');
  const myIdx = rows.findIndex((r) => r.n === s.player);
  const me = myIdx >= 15 ? `<li class="me"><span class="rk">${myIdx + 1}</span><img src="${flagUrl(s.player)}" alt="" class="flag-s">
    <span class="rn">${COUNTRY[s.player].name}</span><span class="rbar"><i style="width:${(rows[myIdx].v / top) * 100}%"></i></span><b>${fmt(rows[myIdx].v)}</b></li>` : '';
  return `
    <div class="win-top"><h3>Рейтинг стран</h3><button class="icon-btn" data-m="close" aria-label="Закрыть">${icon('close', 16)}</button></div>
    <div class="tabs">${tabs}</div>
    <ol class="rank">${list}${me}</ol>`;
}

export function focusHtml(s: GameState) {
  const st = s.focus[s.player];
  const open = new Set(available(s, s.player).map((f) => f.id));
  const cards = focusesOf(s.player).map((f) => {
    const done = st.done.includes(f.id);
    const cur = st.cur === f.id;
    const state = done ? 'done' : cur ? 'cur' : open.has(f.id) && !st.cur ? 'open' : 'locked';
    const req = f.requires && !st.done.includes(f.requires) ? `После: ${FOCUS[f.requires].name}` : '';
    const foot = done ? 'Выполнено' : cur ? `Осталось ходов: ${st.left}` : req || `${f.turns} хода`;
    return `
      <button class="goal ${state}" data-focus="${f.id}">
        <span class="goal-icon">${icon(done ? 'trophy' : f.icon, 18)}</span>
        <b>${f.name}</b><span class="goal-text">${f.text}</span>
        <span class="goal-foot">${foot}</span>
        ${cur ? `<span class="goal-bar"><i style="width:${((f.turns - st.left) / f.turns) * 100}%"></i></span>` : ''}
      </button>`;
  }).join('');
  return `
    <div class="win-top"><h3>Национальные цели</h3><button class="icon-btn" data-m="close" aria-label="Закрыть">${icon('close', 16)}</button></div>
    <p class="muted">Выберите одну цель. Через несколько ходов она даст свой бонус навсегда. Затем можно взять следующую.</p>
    <div class="goals">${cards}</div>
    ${courseHtml(s)}`;
}

/** Lasting course, open once every goal is done. */
function courseHtml(s: GameState) {
  const open = coursesOpen(s, s.player);
  const cur = s.focus[s.player].course;
  const left = available(s, s.player).length + (s.focus[s.player].cur ? 1 : 0);
  const cards = COURSES.map((c) => {
    const on = open && cur === c.id;
    return `
      <button class="course ${open ? 'open' : 'locked'} ${on ? 'on' : ''}" data-course="${c.id}">
        <span class="goal-icon">${icon(c.icon, 17)}</span><b>${c.name}</b><span class="goal-text">${c.text}</span>
        ${on ? '<span class="course-tag">Выбран</span>' : ''}
      </button>`;
  }).join('');
  const hint = open ? 'Действует каждый ход, пока выбран. Сменить можно в любой момент.'
    : `Откроется, когда выполните все цели (осталось ${left})`;
  return `
    <div class="course-head"><h4>${icon('repeat', 16)} Постоянный курс</h4><span class="muted small">${hint}</span></div>
    <div class="courses">${cards}</div>`;
}

export function peaceHtml(s: GameState, n: string) {
  const w = warOf(s, s.player, n);
  const { taken, lost } = warScore(s, n);
  const terms: { id: PeaceTerms; name: string; text: string }[] = [
    { id: 'white', name: 'Белый мир', text: 'Все занятые в этой войне области возвращаются прежним хозяевам' },
    { id: 'keep', name: 'Оставить занятое', text: 'Каждый оставляет себе то, что успел занять' },
    { id: 'reparations', name: 'Занятое и репарации', text: `Вы оставляете занятое и получаете ${reparationsOf(s, n)} денег` },
  ];
  const opts = terms.map((t) => {
    const a = peaceAnswer(s, n, t.id);
    return `
      <button class="peace-opt ${a.ok ? 'ok' : 'no'}" data-terms="${t.id}">
        <b>${t.name}</b><span>${t.text}</span>
        <span class="answer">${icon(a.ok ? 'handshake' : 'close', 14)} ${a.why}</span>
      </button>`;
  }).join('');
  return `
    <div class="win-top"><h3>Мир: ${COUNTRY[n].name}</h3><button class="icon-btn" data-m="close" aria-label="Закрыть">${icon('close', 16)}</button></div>
    <div class="peace-score">
      <div><span class="muted">Война идёт</span><b>${w ? s.turn - w.since : 0} ход.</b></div>
      <div><span class="muted">Вы заняли</span><b class="up">${taken}</b></div>
      <div><span class="muted">Вы потеряли</span><b class="down">${lost}</b></div>
    </div>
    <div class="peace-opts">${opts}</div>
    <p class="muted small">После мира — перемирие на 10 ходов.</p>`;
}

/** Line chart of the player's land against the biggest rival, turn by turn. */
function chart(s: GameState) {
  const h = s.history;
  if (h.length < 2) return '';
  const W = 520;
  const H = 150;
  const maxY = Math.max(5, ...h.map((x) => Math.max(x.me, x.topN)));
  const x = (i: number) => (i / (h.length - 1)) * W;
  const y = (v: number) => H - (v / maxY) * (H - 10);
  const line = (f: (p: (typeof h)[number]) => number) => h.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(f(p)).toFixed(1)}`).join('');
  return `
    <svg viewBox="0 0 ${W} ${H + 18}" class="chart" role="img" aria-label="Число ваших областей по ходам">
      <path d="${line((p) => p.topN)}" class="rival"/>
      <path d="${line((p) => p.me)}" class="me" style="stroke:${COUNTRY[s.player].color}"/>
      <text x="0" y="${H + 14}">ход ${h[0].t}</text><text x="${W}" y="${H + 14}" text-anchor="end">ход ${h[h.length - 1].t}</text>
    </svg>
    <div class="chart-legend"><span><i style="background:${COUNTRY[s.player].color}"></i>Ваши области</span><span><i class="rival"></i>Сильнейший соперник</span></div>`;
}

export function endHtml(s: GameState) {
  const titles: Record<string, string> = {
    unified: 'Европа объединена!',
    'short-win': 'Вы — сильнейшая держава Европы!',
    'short-lose': 'Время вышло',
    capitulation: 'Мы капитулировали',
    conquered: 'Наша страна пала',
  };
  const won = s.won;
  const st = s.stats;
  const cells = [
    ['Ходов', s.turn], ['Областей сейчас', ownedBy(s, s.player).length], ['Максимум областей', st.maxRegions],
    ['Побед в боях', st.battlesWon], ['Поражений', st.battlesLost], ['Взято столиц', st.capitalsTaken],
    ['Присоединено мирно', st.annexed], ['Потоплено флотов', st.fleetsSunk], ['Авиаударов', st.airStrikes],
  ].map(([k, v]) => `<div class="cell"><span>${k}</span><b>${v}</b></div>`).join('');
  const ach = ACHIEVEMENTS.map((a) => `
    <li class="${s.achievements.includes(a.id) ? 'got' : ''}">${icon(a.icon, 16)}<div><b>${a.name}</b><span>${a.text}</span></div></li>`).join('');
  const share = Math.round((ownedBy(s, s.player).length / REGIONS.length) * 100);
  return `
    <div class="end-head ${won ? 'won' : 'lost'}">
      <span class="end-icon">${icon(won ? 'trophy' : 'flag', 30)}</span>
      <div><h3>${titles[s.endReason] ?? (won ? 'Победа!' : 'Конец игры')}</h3>
      <span class="muted">${COUNTRY[s.player].name} · ${DIFFICULTY[s.settings.difficulty].name} сложность · ${share}% Европы</span></div>
    </div>
    ${chart(s)}
    <div class="end-stats">${cells}</div>
    <h4>Достижения · ${s.achievements.length} из ${ACHIEVEMENTS.length}</h4>
    <ul class="ach">${ach}</ul>
    <div class="row"><button class="btn primary" data-m="new">Новая игра</button></div>`;
}
