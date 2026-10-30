import { COUNTRIES, COUNTRY, PARTIES, flagUrl, type CountryDef } from '../data/countries';
import { TRAITS } from '../data/traits';
import { buildGraph, seaPairs } from '../game/graph';
import { CAPITAL, REGION, REGIONS, regionTitle, regionsOf } from '../data/regions';
import { CARD, drawHand, playCard } from '../game/cards';
import {
  type GameState, CAPITULATE_AFTER, PLAYER_SAFE_UNTIL, armyOf, clearSave, load, newGame, owned, ownedBy, save, season, trait,
} from '../game/state';
import {
  RECRUIT_SIZE, annex, annexCost, attack, attackPower, canAnnexHere, chanceOf, defensePower, endTurn, front,
  grossIncome, influenceGain, maxAttacks, netIncome, recruit, recruitCost, upkeep, winChance,
} from '../game/rules';
import {
  ALLIANCE_COST, ALLY_HELP, ALLY_MIN, allyHelp, breakAlliance, canAlly, improveCost, improveRelations, isAlly,
  proposeAlliance, relation, relationLabel,
} from '../game/diplomacy';
import { BRANCHES, UPGRADES, buyUpgrade, hasUpgrade, upgradeBlocked } from '../game/upgrades';
import { MapView } from '../map/MapView';
import { icon } from './icons';
import { politicsBlock } from './politics';
import { EVENT, resolveEvent } from '../game/events';
import { Tutorial, tutorialDone } from './tutorial';
import { isMuted, play, setMuted } from './sound';

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
    buildGraph(this.map.landPairs(), this.map.centroid);
    this.map.setSeaLinks(seaPairs);
    $('#zoom-in').onclick = () => this.map.zoomBy(1.6);
    $('#zoom-out').onclick = () => this.map.zoomBy(1 / 1.6);
    $('#zoom-home').onclick = () => this.focusHome();
    const muteBtn = $('#mute');
    const drawMute = () => {
      muteBtn.innerHTML = icon(isMuted() ? 'mute' : 'sound');
      muteBtn.setAttribute('aria-label', isMuted() ? 'Включить звук' : 'Выключить звук');
    };
    muteBtn.onclick = () => { setMuted(!isMuted()); drawMute(); play('click'); };
    drawMute();
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
      if (isMobile()) this.map.focus(regionIds(this.picked!), { duration: 0, padBottom: $('#start').offsetHeight + 8 });
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
        <div class="muted small">Областей: ${regionsOf(p.code).length}. Столица: ${REGION[CAPITAL[p.code]].name}</div>
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
        this.map.focus(regionIds(b.dataset.pick!), isMobile() ? { padBottom: $('#start').offsetHeight } : { padLeft: 380 });
      };
    });
    const play = document.getElementById('play');
    if (play) play.onclick = () => this.startGame(this.picked!);
    const cont = document.getElementById('continue');
    if (cont && saved) cont.onclick = () => { this.s = saved; this.enterGame(); };
  }

  private startGame(code: string) {
    play('turn');
    this.s = newGame(code, drawHand());
    save(this.s);
    this.enterGame();
    if (!tutorialDone()) setTimeout(() => this.tutorial.start(), 900);
  }

  private enterGame() {
    document.body.dataset.mode = 'game';
    this.selected = this.home();
    this.renderAll();
    setTimeout(() => this.focusHome(), 60); // after the panels have taken their place
    if (this.s!.pendingEvent) this.showEvent();
  }

  /** A region of the player's to fall back on: the capital if still held. */
  private home(): string {
    const s = this.s!;
    const cap = CAPITAL[s.player];
    return s.owner[cap] === s.player ? cap : owned(s)[0] ?? cap;
  }

  private focusHome() {
    const code = this.s?.player ?? this.picked;
    if (!code) return;
    const panel = $('#panel').getBoundingClientRect();
    const ids = this.s ? owned(this.s) : regionIds(code);
    this.map.focus(ids.length ? ids : regionIds(code), isMobile() ? { padBottom: panel.height } : { padRight: this.s ? panel.width + 24 : 0 });
  }

  // ---------- selection ----------

  private onSelect(code: string | null) {
    if (!this.s) {
      if (!code) return;
      this.picked = REGION[code]?.c ?? code;
      play('select');
      this.renderStart();
      this.updateMap();
      return;
    }
    this.selected = code ?? this.home();
    if (code) play('select');
    this.renderPanel();
    this.updateMap();
  }

  private targets(): Set<string> {
    const s = this.s;
    if (!s) return new Set();
    return new Set(REGIONS.map((r) => r.id).filter((r) => front(s, r)));
  }

  private updateMap() {
    const s = this.s;
    this.map.update({
      owner: s ? s.owner : Object.fromEntries(REGIONS.map((r) => [r.id, r.c])),
      player: s ? s.player : null,
      selected: s ? (this.selected ? [this.selected] : []) : this.picked ? regionIds(this.picked) : [],
      targets: this.targets(),
      allies: new Set(s?.allies ?? []),
      capHold: s?.capHold,
      capitulateAfter: CAPITULATE_AFTER,
    });
  }

  // ---------- game screen ----------

  private renderAll() {
    this.renderHud();
    this.renderPanel();
    this.renderDecisions();
    this.updateMap();
    if (this.s?.won) this.showWin();
    else if (this.s?.lost) this.showLose();
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
        <div class="res ${s.stability < 30 ? 'warn' : ''}" title="Стабильность. Доход умножается на ${Math.round((0.5 + s.stability / 200) * 100)}%. Ниже 45% начинаются протесты, ниже 20% — революция">
          <span class="ri stab">${icon('smile')}</span><b>${s.stability}%</b>
          <span class="meter"><i style="width:${s.stability}%"></i></span></div>
        <div class="res" title="Влияние: +${influenceGain(s)} за ход. Тратится на мирное присоединение">
          <span class="ri infl">${icon('handshake')}</span><b>${s.influence}</b><small class="up">+${influenceGain(s)}</small></div>
      </div>
      <div class="hud-turn">
        <div><b>Ход ${s.turn}</b><div class="muted">${season(s.turn)}</div></div>
        <div class="attacks" title="Атак осталось в этом ходу">${icon('target', 16)} ${s.attacksLeft}/${maxAttacks(s)}</div>
        <button class="btn upg-btn" id="upgrades" title="Улучшения">${icon('sparkles', 16)}<span>Улучшения</span>
          <small>${(s.upgrades ?? []).length}/${UPGRADES.length}</small></button>
        <button class="icon-btn" id="help" aria-label="Обучение">${icon('help')}</button>
        <button class="icon-btn" id="menu" aria-label="Новая игра">${icon('restart')}</button>
      </div>`;
    $('#upgrades').onclick = () => this.showUpgrades();
    $('#help').onclick = () => this.tutorial.start();
    $('#menu').onclick = () => this.confirmRestart();
  }

  private renderPanel() {
    const s = this.s!;
    const code = this.selected ?? this.home();
    const region = REGION[code];
    const homeland = COUNTRY[region.c];
    const ownerCode = s.owner[code];
    const mine = ownerCode === s.player;
    const tr = trait(region.c);
    const f = front(s, code);
    const nation = ownerCode;
    const title = regionTitle(code);
    const single = regionsOf(region.c).length === 1;

    // "Бавария · Германия · столица", and who holds it if it changed hands
    const parts = [single ? '' : homeland.name, region.capital ? 'столица' : 'область'].filter(Boolean);
    let status = parts.join(' · ');
    if (ownerCode !== region.c) status += ` · ${mine ? 'захвачена вами' : `занята: ${COUNTRY[ownerCode].name}`}`;

    // capitulation countdown when this capital is occupied
    let siege = '';
    const hold = region.capital && ownerCode !== region.c ? s.capHold[region.c] : undefined;
    if (hold) {
      const left = CAPITULATE_AFTER - hold.turns;
      siege = `<div class="threat ${hold.by === s.player ? 'good' : region.c === s.player ? 'bad' : 'mid'}">${icon('flag', 14)}
        Столица занята. ${homeland.name} капитулирует через ${left} ход., если её не отобьют</div>`;
    }

    const armyLabel = mine ? 'Ваша армия' : 'Армия страны';
    const armyValue = armyOf(s, ownerCode);
    const lands = ownedBy(s, ownerCode).length;

    // how dangerous this country is for the player right now
    let threat = '';
    if (!mine) {
      const odds = owned(s).map((t) => chanceOf(s, ownerCode, t));
      const worst = odds.length ? Math.max(...odds) : 0;
      if (worst > 0) {
        const level = worst >= 60 ? 'bad' : worst >= 35 ? 'mid' : 'good';
        const when = s.turn < PLAYER_SAFE_UNTIL ? ` (не раньше ${PLAYER_SAFE_UNTIL}-го хода)` : '';
        threat = `<div class="threat ${level}">${icon('shield', 14)} Если ${COUNTRY[ownerCode].name} нападёт на вас: шанс ${worst}%${when}</div>`;
      }
    }

    let actions = '';
    if (mine) {
      const cost = recruitCost(s);
      actions = `
        <button class="btn primary wide" id="recruit" ${s.money < cost ? 'data-off="1"' : ''}>
          ${icon('users', 16)} Набрать войска: +${RECRUIT_SIZE} за ${cost}</button>
        <div class="muted small">Каждые 4 солдата стоят 1 деньгу за ход</div>`;
    } else {
      const ally = isAlly(s, ownerCode);
      const cost = annexCost(s, code);
      const annexBtn = canAnnexHere(s, code)
        ? `<button class="btn wide" id="annex" ${s.influence < cost ? 'data-off="1"' : ''}>
            ${icon('handshake', 16)} Присоединить за ${cost} влияния</button>` : '';
      if (f) {
        const ch = winChance(s, code);
        const help = allyHelp(s, code);
        actions = `
          <div class="battle">
            <div class="battle-row"><span>Ваша сила</span><b>${fmt(attackPower(s, f, code))}</b></div>
            ${help > 0 ? `<div class="muted small">${icon('handshake', 14)} Союзники помогают: +${fmt(help)}</div>` : ''}
            <div class="battle-row"><span>Оборона</span><b>${fmt(defensePower(s, code))}</b></div>
            ${ownerCode === region.c ? `<div class="muted small">${icon('castle', 14)} Родная земля: +${region.capital ? 75 : 25}% к обороне${region.capital ? ' (столица)' : ''}</div>` : ''}
            ${f === 'sea' ? `<div class="muted small">${icon('dove', 14)} Морской десант${trait(s.player).effect.seaMaster || hasUpgrade(s, 'navy') ? ' без штрафа' : ': −25% к силе'}</div>` : ''}
            <div class="chance"><div class="chance-bar"><i style="width:${ch}%"></i></div><span>Шанс победы <b>${ch}%</b></span></div>
          </div>
          <button class="btn danger wide" id="attack" ${s.attacksLeft <= 0 || s.army < 5 ? 'data-off="1"' : ''}>
            ${icon('swords', 16)} Атаковать</button>
          ${annexBtn}`;
      } else if (ally) {
        actions = `<div class="note">Союзник. Помогает вам в боях рядом со своей границей: ${Math.round(ALLY_HELP * 100)}% армии.</div>${annexBtn}`;
      } else {
        actions = `<div class="note">Нет общей границы. Захватите соседей, чтобы подобраться ближе.</div>`;
      }
      actions += this.diplomacyBlock(ownerCode);
    }

    const electionNote = nation === s.player ? `Ходов до выборов: ${s.nextElection - s.turn}` : '';
    $('#panel').innerHTML = `
      <div class="panel-head">
        <img src="${flagUrl(ownerCode)}" alt="Флаг: ${COUNTRY[ownerCode].name}" class="flag-l">
        <div><h2>${region.capital ? `${icon('star', 16)} ` : ''}${title}</h2><div class="muted">${status}</div></div>
      </div>
      <div class="stats">
        <div class="stat">${icon('swords', 16)}<span>${armyLabel}</span><b>${fmt(armyValue)}</b></div>
        <div class="stat">${icon('coins', 16)}<span>Доход области</span><b>${region.eco}</b></div>
      </div>
      <div class="muted small">${mine ? 'У вас' : `У страны ${COUNTRY[ownerCode].name}`} областей: ${lands}. Армия защищает их все, потеря каждой ослабляет страну.</div>
      ${siege}
      <div class="trait"><div class="muted small">Особенность: ${homeland.name}</div><b>${tr.name}</b><div>${tr.text}</div></div>
      ${threat}
      <div class="actions">${actions}</div>
      ${politicsBlock(s.parties[nation], s.ruling[nation], COUNTRY[nation].gov, electionNote)}
      <ul class="log">${s.log.slice(0, 6).map((l) => `<li class="${l.tone}"><span>Ход ${l.turn}</span>${l.text}</li>`).join('')}</ul>`;

    const on = (id: string, fn: () => void, why: string) => {
      const b = document.getElementById(id);
      if (b) b.onclick = () => (b.dataset.off ? this.toast(why, 'bad') : fn());
    };
    on('recruit', () => this.act(() => { if (recruit(s)) play('recruit'); }), 'Не хватает денег');
    on('attack', () => this.doAttack(code), s.attacksLeft <= 0 ? 'Атаки на этот ход закончились' : 'Слишком маленькая армия');
    on('annex', () => this.act(() => {
      const who = COUNTRY[ownerCode].name;
      if (annex(s, code)) { this.toast(`Мирно присоединено: ${who}`, 'good'); play('ally'); }
    }), `Нужно ${annexCost(s, code)} влияния`);
    on('improve', () => this.act(() => { if (improveRelations(s, ownerCode)) play('click'); }), `Нужно ${improveCost(s, ownerCode)} влияния`);
    on('ally', () => this.act(() => {
      if (proposeAlliance(s, ownerCode)) { this.toast(`Союз заключён: ${COUNTRY[ownerCode].name}`, 'good'); play('ally'); }
    }), relation(s, ownerCode) < ALLY_MIN ? `Нужны отношения от +${ALLY_MIN}` : `Нужно ${ALLIANCE_COST} влияния`);
    on('break', () => this.act(() => { breakAlliance(s, ownerCode); }), '');
  }

  /** Relations with a computer country and what can be done about them. */
  private diplomacyBlock(nation: string): string {
    const s = this.s!;
    const r = relation(s, nation);
    const label = relationLabel(s, nation);
    const ally = isAlly(s, nation);
    const pos = (r + 100) / 2; // 0..100 on the bar
    let buttons = '';
    if (ally) {
      buttons = `<button class="btn ghost wide" id="break">Разорвать союз</button>`;
    } else {
      const ic = improveCost(s, nation);
      buttons = `
        <div class="dip-row">
          <button class="btn" id="improve" ${s.influence < ic || r >= 100 ? 'data-off="1"' : ''}>+${15} отношений · ${ic} влияния</button>
          <button class="btn" id="ally" ${!canAlly(s, nation) ? 'data-off="1"' : ''}>${icon('handshake', 15)} Союз</button>
        </div>
        <div class="muted small">Союз возможен от +${ALLY_MIN}. Союзники не нападают и помогают в боях.</div>`;
    }
    return `
      <div class="diplomacy">
        <div class="dip-head"><span>Отношения с вами</span><b class="${label.tone}">${label.text} · ${r > 0 ? '+' : ''}${r}</b></div>
        <div class="rel-bar"><i style="left:${pos}%"></i><span style="left:${(ALLY_MIN + 100) / 2}%"></span></div>
        ${buttons}
      </div>`;
  }

  private showUpgrades() {
    const s = this.s!;
    const cols = BRANCHES.map((b) => `
      <div class="upg-col">
        <div class="upg-branch">${b.name}</div>
        ${UPGRADES.filter((u) => u.branch === b.id).map((u) => {
          const why = upgradeBlocked(s, u);
          const done = hasUpgrade(s, u.id);
          const state = done ? 'done' : why ? 'locked' : 'ready';
          return `
            <button class="upg ${state}" data-upg="${u.id}">
              <span class="upg-icon">${icon(done ? 'trophy' : u.icon, 16)}</span>
              <b>${u.name}</b>
              <span class="upg-text">${u.text}</span>
              <span class="upg-cost">${done ? 'Изучено' : why && !why.startsWith('Нужно') ? why : `${u.cost} денег`}</span>
            </button>`;
        }).join('')}
      </div>`).join('');
    const m = this.modal(`
      <div class="upg-top"><h3>Улучшения</h3><span class="muted">Казна: <b>${fmt(s.money)}</b></span>
        <button class="icon-btn" data-m="close" aria-label="Закрыть">${icon('close', 16)}</button></div>
      <p class="muted">Покупаются за деньги и действуют сразу и навсегда. Некоторые требуют предыдущего.</p>
      <div class="upg-grid">${cols}</div>`, 'upgrades');
    m.querySelector<HTMLButtonElement>('[data-m="close"]')!.onclick = () => this.closeModal();
    m.querySelectorAll<HTMLButtonElement>('[data-upg]').forEach((b) => {
      b.onclick = () => {
        const u = UPGRADES.find((x) => x.id === b.dataset.upg)!;
        const why = upgradeBlocked(s, u);
        if (why) return this.toast(why, why === 'Изучено' ? 'info' : 'bad');
        this.act(() => {
          buyUpgrade(s, u.id);
          if (u.effect.extraAttacks) s.attacksLeft += u.effect.extraAttacks;
        });
        this.toast(`Изучено: ${u.name}`, 'good');
        play('buy');
        this.showUpgrades();
      };
    });
  }

  private doAttack(code: string) {
    const s = this.s!;
    this.act(() => {
      const wasCapital = CAPITAL[s.owner[code]] === code;
      const r = attack(s, code);
      if (r === 'win') play(wasCapital ? 'capital' : 'win');
      if (r === 'loss') play('loss');
      if (r === 'win') this.toast(`Победа! Захвачено: ${regionTitle(code)}`, 'good');
      if (r === 'loss') this.toast(`Атака отбита: ${regionTitle(code)}`, 'bad');
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
        play('card');
        this.toast(`Решение принято: ${CARD[id].title}`, 'good');
      };
    });
    $('#end-turn').onclick = () => {
      let income = 0;
      this.act(() => { income = endTurn(s); });
      this.map.flash(s.events.filter((e) => e.won).map((e) => e.target));
      if (s.won || s.lost) return;
      this.toast(`Ход ${s.turn}, ${season(s.turn)}. Доход ${signed(income)}`, 'info');
      play('turn');
      const report = () => {
        if (s.events.some((e) => e.defender === s.player)) { play('alarm'); this.showTurnReport(); }
        else if (s.events.length) this.toast(`Сражений в Европе: ${s.events.length}. Подробности в журнале`, 'info');
      };
      if (s.pendingEvent) this.showEvent(report);
      else report();
    };
  }

  /** A random event. The player has to pick an option to go on. */
  private showEvent(after?: () => void) {
    const s = this.s!;
    const ev = s.pendingEvent ? EVENT[s.pendingEvent] : null;
    if (!ev) return after?.();
    setTimeout(() => play('event'), 250);
    const options = ev.options.map((o, i) => {
      const fx = o.effects(s);
      return `
        <button class="event-opt" data-opt="${i}">
          <b>${o.label}</b>
          ${fx.length ? fx.map((e) => `<span class="${e.good ? 'up' : 'down'}">${e.text}</span>`).join('') : '<span class="muted">Ничего не изменится</span>'}
        </button>`;
    }).join('');
    const m = this.modal(`
      <div class="event-head">
        <span class="event-icon">${icon(ev.icon, 26)}</span>
        <div class="event-meta">Событие · ход ${s.turn}</div>
      </div>
      <h3>${ev.title}</h3>
      <p class="event-text">${ev.text(s)}</p>
      <div class="event-opts">${options}</div>`, 'event');
    m.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => {
      b.onclick = () => {
        play('click');
        this.closeModal();
        this.act(() => resolveEvent(s, Number(b.dataset.opt)));
        after?.();
      };
    });
  }

  /** Battles of the computer turn. Opens only when the player was attacked. */
  private showTurnReport() {
    const s = this.s!;
    const rows = [...s.events]
      .sort((a, b) => Number(b.defender === s.player) - Number(a.defender === s.player))
      .slice(0, 8)
      .map((e) => {
        const vsMe = e.defender === s.player;
        const tone = vsMe ? (e.won ? 'bad' : 'good') : 'info';
        const result = vsMe ? (e.won ? 'захвачено' : 'отбито') : e.won ? 'захвачено' : 'атака отбита';
        return `
          <li class="${tone}">
            <img src="${flagUrl(e.attacker)}" alt="" class="flag-s">
            <span>${COUNTRY[e.attacker].name} → ${regionTitle(e.target)}</span>
            <b>${result}</b>
          </li>`;
      }).join('');
    const m = this.modal(`
      <h3>Итоги хода</h3>
      <p class="muted">На вас напали. Шанс каждого соседа против вас виден на карточке страны.</p>
      <ul class="report">${rows}</ul>
      <div class="row"><button class="btn primary" data-m="ok">Понятно</button></div>`);
    m.querySelector<HTMLButtonElement>('[data-m="ok"]')!.onclick = () => this.closeModal();
  }

  private showLose() {
    const s = this.s!;
    play('defeat');
    const m = this.modal(`
      <h3>Ваша страна пала</h3>
      <p class="muted">${COUNTRY[s.player].name} продержалась ходов: ${s.turn}. Попробуйте другую стратегию или страну.</p>
      <div class="row"><button class="btn primary" data-m="new">Новая игра</button></div>`);
    m.querySelector<HTMLButtonElement>('[data-m="new"]')!.onclick = () => {
      clearSave();
      this.closeModal();
      this.showStart();
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

  private modal(html: string, cls = '') {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card ${cls}">${html}</div>`;
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
    play('victory');
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

const regionIds = (country: string) => regionsOf(country).map((r) => r.id);
