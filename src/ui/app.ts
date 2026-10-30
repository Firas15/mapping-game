import { COUNTRIES, COUNTRY, PARTIES, flagUrl, type CountryDef } from '../data/countries';
import { TRAITS } from '../data/traits';
import { buildGraph } from '../game/graph';
import { CARD, drawHand, playCard } from '../game/cards';
import {
  type GameState, MAX_ATTACKS, clearSave, load, newGame, owned, save, season, trait,
} from '../game/state';
import {
  RECRUIT_SIZE, annex, annexCost, attack, attackPower, defensePower, endTurn, front, grossIncome,
  influenceGain, netIncome, recruit, recruitCost, upkeep, winChance,
} from '../game/rules';
import { MapView } from '../map/MapView';
import { icon } from './icons';
import { politicsBlock } from './politics';
import { Tutorial, tutorialDone } from './tutorial';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const signed = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

type Difficulty = { label: string; cls: string };
function difficulty(c: CountryDef): Difficulty {
  const p = c.army + c.eco;
  if (p >= 110) return { label: 'Легко', cls: 'easy' };
  if (p >= 55) return { label: 'Средне', cls: 'mid' };
  if (p >= 22) return { label: 'Сложно', cls: 'hard' };
  return { label: 'Испытание', cls: 'pro' };
}

const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

export class App {
  private s: GameState | null = null;
  private picked: string | null = null;
  private selected: string | null = null;
  private map: MapView;
  private tutorial = new Tutorial($('#tutorial'));

  constructor(topo: unknown) {
    this.map = new MapView($('#map-host'), topo, (c) => this.onSelect(c));
    buildGraph(this.map.landPairs());
    $('#zoom-in').onclick = () => this.map.zoomBy(1.6);
    $('#zoom-out').onclick = () => this.map.zoomBy(1 / 1.6);
    $('#zoom-home').onclick = () => this.focusHome();
    this.showStart();
  }

  // ---------- start screen ----------

  private showStart() {
    this.s = null;
    document.body.dataset.mode = 'pick';
    this.picked = this.picked ?? 'DE';
    this.renderStart();
    this.updateMap();
    requestAnimationFrame(() => {
      if (isMobile()) this.map.focus(this.picked!, { duration: 0, padBottom: $('#start').offsetHeight + 8 });
      else this.map.focusPoint([14, 50], 2.4, 0, 380);
    });
  }

  private renderStart() {
    const saved = load();
    const groups: Record<string, CountryDef[]> = {};
    for (const c of [...COUNTRIES].sort((a, b) => b.army + b.eco - (a.army + a.eco))) {
      (groups[difficulty(c).label] ??= []).push(c);
    }
    const list = Object.entries(groups).map(([label, cs]) => `
      <div class="group-title">${label}</div>
      ${cs.map((c) => `
        <button class="country-row ${c.code === this.picked ? 'on' : ''}" data-pick="${c.code}">
          <img src="${flagUrl(c.code)}" alt="" class="flag-s"><span>${c.name}</span>
          <span class="tag ${difficulty(c).cls}">${difficulty(c).label}</span>
        </button>`).join('')}`).join('');

    const p = this.picked ? COUNTRY[this.picked] : null;
    const card = p ? `
      <div class="pick-card">
        <div class="pick-head">
          <img src="${flagUrl(p.code)}" alt="Флаг: ${p.name}" class="flag-l">
          <div><h2>${p.name}</h2><span class="tag ${difficulty(p).cls}">${difficulty(p).label}</span></div>
        </div>
        <div class="stats">
          <div class="stat">${icon('swords', 16)}<span>Армия</span><b>${p.army}</b></div>
          <div class="stat">${icon('coins', 16)}<span>Доход</span><b>${p.eco}</b></div>
        </div>
        <div class="trait"><div class="muted small">Особенность</div><b>${TRAITS[p.trait].name}</b><div>${TRAITS[p.trait].text}</div></div>
        ${politicsBlock([...p.parties], topPartyOf(p), p.gov)}
        <button class="btn primary wide" id="play">Играть: ${p.name}</button>
      </div>` : '';

    $('#start').innerHTML = `
      <div class="brand"><span class="logo">${icon('flag', 20)}</span><div><h1>Mapping</h1>
        <div class="muted">Выберите страну и объедините Европу</div></div></div>
      ${saved ? `<button class="btn continue wide" id="continue"><img src="${flagUrl(saved.player)}" alt="" class="flag-s">
        Продолжить: ${COUNTRY[saved.player].name}, ход ${saved.turn}</button>` : ''}
      ${card}
      <div class="country-list">${list}</div>`;

    $('#start').querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => {
      b.onclick = () => {
        this.onSelect(b.dataset.pick!);
        this.map.focus(b.dataset.pick!, isMobile() ? { padBottom: $('#start').offsetHeight } : { padLeft: 380 });
      };
    });
    const play = document.getElementById('play');
    if (play) play.onclick = () => this.startGame(this.picked!);
    const cont = document.getElementById('continue');
    if (cont && saved) cont.onclick = () => { this.s = saved; this.enterGame(); };
  }

  private startGame(code: string) {
    this.s = newGame(code, drawHand());
    save(this.s);
    this.enterGame();
    if (!tutorialDone()) setTimeout(() => this.tutorial.start(), 900);
  }

  private enterGame() {
    document.body.dataset.mode = 'game';
    this.selected = this.s!.player;
    this.renderAll();
    requestAnimationFrame(() => this.focusHome());
  }

  private focusHome() {
    const code = this.s?.player ?? this.picked;
    if (!code) return;
    const panel = $('#panel').getBoundingClientRect();
    this.map.focus(code, isMobile() ? { padBottom: panel.height } : { padRight: this.s ? panel.width + 24 : 0 });
  }

  // ---------- selection ----------

  private onSelect(code: string | null) {
    if (!this.s) {
      if (!code) return;
      this.picked = code;
      this.renderStart();
      this.updateMap();
      return;
    }
    this.selected = code ?? this.s.player;
    this.renderPanel();
    this.updateMap();
  }

  private targets(): Set<string> {
    const s = this.s;
    if (!s) return new Set();
    return new Set(COUNTRIES.map((c) => c.code).filter((c) => front(s, c)));
  }

  private updateMap() {
    const s = this.s;
    this.map.update({
      owner: s ? s.owner : Object.fromEntries(COUNTRIES.map((c) => [c.code, c.code])),
      player: s ? s.player : null,
      selected: s ? this.selected : this.picked,
      targets: this.targets(),
    });
  }

  // ---------- game screen ----------

  private renderAll() {
    this.renderHud();
    this.renderPanel();
    this.renderDecisions();
    this.updateMap();
    if (this.s?.won) this.showWin();
  }

  private act(fn: () => void) {
    fn();
    save(this.s!);
    this.renderAll();
  }

  private renderHud() {
    const s = this.s!;
    const p = COUNTRY[s.player];
    const ruling = PARTIES[s.ruling[s.player]];
    const net = netIncome(s);
    $('#hud').innerHTML = `
      <div class="hud-me">
        <img src="${flagUrl(s.player)}" alt="Флаг: ${p.name}" class="flag-m">
        <div><b>${p.name}</b><div class="pill" style="--c:${ruling.color}">${ruling.name}</div></div>
      </div>
      <div class="resources">
        <div class="res" title="Деньги. За ход: ${signed(net)} (доход ${fmt(grossIncome(s) * s.turnIncomeMul)}, содержание армии −${upkeep(s)})">
          <span class="ri money">${icon('coins')}</span><b>${fmt(s.money)}</b><small class="${net >= 0 ? 'up' : 'down'}">${signed(net)}</small></div>
        <div class="res" title="Армия. Содержание: ${upkeep(s)} денег за ход">
          <span class="ri army">${icon('swords')}</span><b>${fmt(s.army)}</b></div>
        <div class="res" title="Стабильность. Доход умножается на ${Math.round((0.5 + s.stability / 200) * 100)}%">
          <span class="ri stab">${icon('smile')}</span><b>${s.stability}%</b>
          <span class="meter"><i style="width:${s.stability}%"></i></span></div>
        <div class="res" title="Влияние: +${influenceGain(s)} за ход. Тратится на мирное присоединение">
          <span class="ri infl">${icon('handshake')}</span><b>${s.influence}</b><small class="up">+${influenceGain(s)}</small></div>
      </div>
      <div class="hud-turn">
        <div><b>Ход ${s.turn}</b><div class="muted">${season(s.turn)}</div></div>
        <div class="attacks" title="Атак осталось в этом ходу">${icon('target', 16)} ${s.attacksLeft}/${MAX_ATTACKS}</div>
        <button class="icon-btn" id="help" aria-label="Обучение">${icon('help')}</button>
        <button class="icon-btn" id="menu" aria-label="Новая игра">${icon('restart')}</button>
      </div>`;
    $('#help').onclick = () => this.tutorial.start();
    $('#menu').onclick = () => this.confirmRestart();
  }

  private renderPanel() {
    const s = this.s!;
    const code = this.selected ?? s.player;
    const c = COUNTRY[code];
    const ownerCode = s.owner[code];
    const mine = ownerCode === s.player;
    const tr = trait(code);
    const f = front(s, code);
    const nation = mine ? s.player : ownerCode;

    let status = 'Независимая страна';
    if (code === s.player) status = 'Ваша столица';
    else if (mine) status = 'Ваша территория';
    else if (ownerCode !== code) status = `Под контролем: ${COUNTRY[ownerCode].name}`;

    const armyLabel = mine ? 'Ваша армия' : 'Гарнизон';
    const armyValue = mine ? s.army : s.garrison[code];

    let actions = '';
    if (mine) {
      const cost = recruitCost(s);
      actions = `
        <button class="btn primary wide" id="recruit" ${s.money < cost ? 'data-off="1"' : ''}>
          ${icon('users', 16)} Набрать войска: +${RECRUIT_SIZE} за ${cost}</button>
        <div class="muted small">Каждые 4 солдата стоят 1 деньгу за ход</div>`;
    } else if (f) {
      const ch = winChance(s, code);
      const cost = annexCost(s, code);
      const canAnnex = ownerCode === code;
      actions = `
        <div class="battle">
          <div class="battle-row"><span>Ваша сила</span><b>${fmt(attackPower(s, f))}</b></div>
          <div class="battle-row"><span>Оборона</span><b>${fmt(defensePower(s, code))}</b></div>
          ${f === 'sea' ? `<div class="muted small">${icon('dove', 14)} Морской десант${trait(s.player).effect.seaMaster ? ' без штрафа' : ': −25% к силе'}</div>` : ''}
          <div class="chance"><div class="chance-bar"><i style="width:${ch}%"></i></div><span>Шанс победы <b>${ch}%</b></span></div>
        </div>
        <button class="btn danger wide" id="attack" ${s.attacksLeft <= 0 || s.army < 5 ? 'data-off="1"' : ''}>
          ${icon('swords', 16)} Атаковать</button>
        ${canAnnex ? `<button class="btn wide" id="annex" ${s.influence < cost ? 'data-off="1"' : ''}>
          ${icon('handshake', 16)} Присоединить за ${cost} влияния</button>` : ''}`;
    } else {
      actions = `<div class="note">Нет общей границы. Захватите соседей, чтобы подобраться ближе.</div>`;
    }

    const electionNote = nation === s.player ? `Ходов до выборов: ${s.nextElection - s.turn}` : '';
    $('#panel').innerHTML = `
      <div class="panel-head">
        <img src="${flagUrl(code)}" alt="Флаг: ${c.name}" class="flag-l">
        <div><h2>${c.name}</h2><div class="muted">${status}</div></div>
      </div>
      <div class="stats">
        <div class="stat">${icon('swords', 16)}<span>${armyLabel}</span><b>${fmt(armyValue)}</b></div>
        <div class="stat">${icon('coins', 16)}<span>Доход</span><b>${c.eco}</b></div>
      </div>
      <div class="trait"><div class="muted small">Особенность</div><b>${tr.name}</b><div>${tr.text}</div></div>
      <div class="actions">${actions}</div>
      ${politicsBlock(s.parties[nation], s.ruling[nation], COUNTRY[nation].gov, electionNote)}
      <ul class="log">${s.log.slice(0, 5).map((l) => `<li class="${l.tone}"><span>Ход ${l.turn}</span>${l.text}</li>`).join('')}</ul>`;

    const on = (id: string, fn: () => void, why: string) => {
      const b = document.getElementById(id);
      if (b) b.onclick = () => (b.dataset.off ? this.toast(why, 'bad') : fn());
    };
    on('recruit', () => this.act(() => { recruit(s); }), 'Не хватает денег');
    on('attack', () => this.doAttack(code), s.attacksLeft <= 0 ? 'Атаки на этот ход закончились' : 'Слишком маленькая армия');
    on('annex', () => this.act(() => {
      if (annex(s, code)) this.toast(`Мирно присоединено: ${c.name}`, 'good');
    }), `Нужно ${annexCost(s, code)} влияния`);
  }

  private doAttack(code: string) {
    const s = this.s!;
    this.act(() => {
      const r = attack(s, code);
      if (r === 'win') this.toast(`Победа! Захвачено: ${COUNTRY[code].name}`, 'good');
      if (r === 'loss') this.toast(`Атака отбита: ${COUNTRY[code].name}`, 'bad');
    });
  }

  private renderDecisions() {
    const s = this.s!;
    const cards = s.hand.map((id) => {
      const card = CARD[id];
      const blocked = card.blocked?.(s);
      const state = s.played === id ? 'played' : s.played ? 'faded' : blocked ? 'blocked' : '';
      return `
        <button class="card ${state}" data-card="${id}">
          <span class="card-icon">${icon(card.icon, 18)}</span>
          <span class="card-title">${card.title}</span>
          ${card.effects(s).map((e) => `<span class="${e.good ? 'up' : 'down'}">${e.text}</span>`).join('')}
          ${s.played === id ? '<span class="card-badge">Принято</span>' : blocked && !s.played ? `<span class="card-why">${blocked}</span>` : ''}
        </button>`;
    }).join('');
    const net = netIncome(s);
    $('#decisions').innerHTML = `
      <div class="cards">${cards}</div>
      <button class="btn primary end" id="end-turn">
        <span>Конец хода</span><small>${signed(net)} денег</small></button>`;
    $('#decisions').querySelectorAll<HTMLButtonElement>('[data-card]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.card!;
        if (s.played) return this.toast(s.played === id ? 'Это решение уже принято' : 'В этом ходу решение уже принято', 'info');
        const why = CARD[id].blocked?.(s);
        if (why) return this.toast(why, 'bad');
        this.act(() => { playCard(s, id); });
        this.toast(`Решение принято: ${CARD[id].title}`, 'good');
      };
    });
    $('#end-turn').onclick = () => {
      let income = 0;
      this.act(() => { income = endTurn(s); });
      this.toast(`Ход ${s.turn}, ${season(s.turn)}. Доход ${signed(income)}`, 'info');
    };
  }

  // ---------- overlays ----------

  private toast(text: string, tone: 'good' | 'bad' | 'info') {
    const t = document.createElement('div');
    t.className = `toast ${tone}`;
    t.textContent = text;
    $('#toasts').prepend(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  private modal(html: string) {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card">${html}</div>`;
    m.classList.add('open');
    return m;
  }
  private closeModal() {
    $('#modal').classList.remove('open');
    $('#modal').innerHTML = '';
  }

  private confirmRestart() {
    const m = this.modal(`
      <h3>Начать заново?</h3>
      <p class="muted">Текущая партия будет удалена.</p>
      <div class="row"><button class="btn ghost" data-m="no">Отмена</button><button class="btn danger" data-m="yes">Новая игра</button></div>`);
    m.querySelector<HTMLButtonElement>('[data-m="no"]')!.onclick = () => this.closeModal();
    m.querySelector<HTMLButtonElement>('[data-m="yes"]')!.onclick = () => {
      clearSave();
      this.closeModal();
      this.showStart();
    };
  }

  private showWin() {
    const s = this.s!;
    const m = this.modal(`
      <div class="win-icon">${icon('trophy', 36)}</div>
      <h3>Европа объединена!</h3>
      <p class="muted">${COUNTRY[s.player].name} контролирует все ${owned(s).length} стран. Ходов: ${s.turn}.</p>
      <div class="row"><button class="btn primary" data-m="new">Сыграть ещё</button></div>`);
    m.querySelector<HTMLButtonElement>('[data-m="new"]')!.onclick = () => {
      clearSave();
      this.closeModal();
      this.showStart();
    };
  }
}

function topPartyOf(c: CountryDef) {
  const order = ['dem', 'con', 'soc', 'nat'] as const;
  return order[c.parties.indexOf(Math.max(...c.parties))];
}
