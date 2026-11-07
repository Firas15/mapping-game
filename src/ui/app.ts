import { COUNTRIES, COUNTRY, PARTIES, flagUrl, type CountryDef } from '../data/countries';
import { TRAITS } from '../data/traits';
import { CAPITAL, KIND_INFO, REGION, REGIONS, regionTitle, regionsOf } from '../data/regions';
import { SEA } from '../data/seas';
import { buildGraph, neighbours, seaPairs } from '../game/graph';
import { CARD, drawHand, playCard } from '../game/cards';
import {
  type Difficulty, type GameState, type Unit, type WarEvent, PLAYER_SAFE_UNTIL, SHORT_TURNS, armiesAt,
  clearSave, integrated, INTEGRATE_AFTER, load, newGame, owned, ownedBy, save, season, strOf, trait, unitsOf,
} from '../game/state';
import {
  annex, annexCost, cantAnnex, endTurn, grossIncome, influenceGain, netIncome, peaceAnswer, playerAttack,
} from '../game/rules';
import {
  type PeaceTerms, airStrike, airTargets, atWar, attackers, attackPower, blocOf, canAttackRegion, canMoveArmy,
  airMoves, asIfStrength, cantDeclare, chance, declareWar, defensePower, enemiesOf, fleetMoves, friends, joinCandidates, keyRegions,
  makePeace, moveAir, moveArmy, moveFleet, splitArmy, warPenalty, battleNotes, supplyStatus, MOUNTAIN_BONUS, possibleGuardians,
} from '../game/war';
import {
  UNIT_INFO, armyTotal, build, cantBuild, cantReinforce, disband, draft, draftCap, maxArmies, price,
  reinforceUnit, upkeepOf,
} from '../game/units';
import {
  ALLIANCE_COST, ALLY_MIN, breakAlliance, canAlly, improveCost, improveRelations, isAlly, proposeAlliance, relation,
  relationLabel,
} from '../game/diplomacy';
import { BRANCHES, UPGRADES, buyUpgrade, hasUpgrade, upgradeBlocked } from '../game/upgrades';
import { EVENT, resolveEvent } from '../game/events';
import { COURSE, FOCUS, courseOf, coursesOpen, setCourse, startFocus } from '../game/focus';
import { cantJoin, joinBloc, leaveBloc } from '../game/blocs';
import { ACHIEVEMENTS, type Metric, rankOf } from '../game/stats';
import { MapView, type Orders, type Skip } from '../map/MapView';
import { icon } from './icons';
import { politicsBlock } from './politics';
import { endHtml, focusHtml, peaceHtml, rankingHtml } from './screens';
import { Tutorial, tutorialDone } from './tutorial';
import { isMuted, play, setMuted } from './sound';
import { Menu } from './menu';
import { HowTo } from './howto';
import { breakAd, gameplay } from '../platform';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const signed = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));
const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
const regionIds = (country: string) => regionsOf(country).map((r) => r.id);

type Difficulty4 = { label: string; cls: string };
function difficulty(c: CountryDef): Difficulty4 {
  const p = c.army + c.eco;
  if (p >= 110) return { label: 'Легко', cls: 'easy' };
  if (p >= 55) return { label: 'Средне', cls: 'mid' };
  if (p >= 22) return { label: 'Сложно', cls: 'hard' };
  return { label: 'Испытание', cls: 'pro' };
}
const topPartyOf = (c: CountryDef) => (['dem', 'con', 'soc', 'nat'] as const)[c.parties.indexOf(Math.max(...c.parties))];

export type MapMode = 'political' | 'blocs' | 'resources' | 'relations' | 'threat' | 'unrest';
const MODES: { id: MapMode; name: string; icon: string; legend: string }[] = [
  { id: 'political', name: 'Политика', icon: 'flag', legend: '' },
  { id: 'blocs', name: 'Коалиции', icon: 'users', legend: '' },
  { id: 'resources', name: 'Ресурсы', icon: 'coins', legend: '<i style="background:#e0b04a"></i>деньги <i style="background:#d6564d"></i>солдаты <i style="background:#9b7be0"></i>и то, и другое' },
  { id: 'relations', name: 'Отношения', icon: 'handshake', legend: '<i style="background:#d6403a"></i>война <i style="background:#7a3a3a"></i>вражда <i style="background:#4a5570"></i>нейтралитет <i style="background:#3fbf7f"></i>дружба, союз' },
  { id: 'threat', name: 'Угрозы', icon: 'shield', legend: '<i style="background:#2d5a44"></i>в безопасности <i style="background:#e2574c"></i>враг может взять' },
  { id: 'unrest', name: 'Недовольство', icon: 'megaphone', legend: '<i style="background:#e0c04a"></i>спокойно <i style="background:#e2574c"></i>скоро восстание' },
];

const BLOC_COLORS = ['#5b9bf0', '#b07ad0', '#3fbfb0', '#e07b39'];

/** Blend two #rrggbb colours. */
function mix(a: string, b: string, t: number) {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * Math.max(0, Math.min(1, t))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export class App {
  private s: GameState | null = null;
  private picked: string | null = null;
  private selected: string | null = null;
  private unitSel: number | null = null;
  /** region chosen as an attack target, waiting for "Атаковать" */
  private target: string | null = null;
  /** other armies the player has added to the planned attack */
  private joiners = new Set<number>();
  /** soldiers the player wants to send from the selected army; null = all of them */
  private send: number | null = null;

  /** How many soldiers of this army the next order uses. */
  private amount(u: Unit) {
    return Math.max(1, Math.min(u.str, Math.round(this.send ?? u.str)));
  }
  private mode: MapMode = 'political';
  private map: MapView;
  private tutorial = new Tutorial($('#tutorial'));
  private menu = new Menu($('#menu-screen'));
  private howto = new HowTo($('#howto'));
  private ownerView: Record<string, string> | null = null;
  private cinematic = false;
  private busy = false;
  private journalSeen = 0;
  /** journal shows everything, not only what concerns the player */
  private journalAll = false;
  private metric: Metric = 'power';
  private settings: { difficulty: Difficulty; short: boolean } = { difficulty: 'normal', short: false };

  constructor(topo: unknown) {
    this.map = new MapView($('#map-host'), topo, {
      region: (id) => this.onRegion(id),
      unit: (id) => this.onUnit(id),
      zone: (id) => this.onZone(id),
    });
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
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.s && !$('#modal').classList.contains('open') && !$('#howto').classList.contains('open')) this.clearUnit();
    });
    this.renderModes();
    this.showMenu();
  }

  // ---------- main menu ----------

  private showMenu() {
    gameplay(false);
    if (this.s) save(this.s);
    this.s = null;
    this.unitSel = null;
    this.target = null;
    this.closeModal();
    this.menu.open({
      saved: load(),
      onContinue: async () => {
        await breakAd();
        this.s = load();
        if (this.s) this.enterGame(); else this.showStart();
      },
      onNew: () => this.showStart(),
      onHowTo: () => this.howto.open(),
    }, {
      update: (owner) => this.map.update({ owner, player: null, selected: [], units: [], fill: null }),
      flash: (ids) => this.map.flash(ids),
      drift: (p, k, d) => this.map.focusPoint(p, k, d, isMobile() ? 0 : 440),
    });
  }

  // ---------- start screen ----------

  private showStart() {
    gameplay(false);
    this.menu.close();
    this.s = null;
    this.unitSel = null;
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
    for (const c of [...COUNTRIES].sort((a, b) => b.army + b.eco - (a.army + a.eco))) (groups[difficulty(c).label] ??= []).push(c);
    const list = Object.entries(groups).map(([label, cs]) => `
      <div class="group-title">${label}</div>
      ${cs.map((c) => `
        <button class="country-row ${c.code === this.picked ? 'on' : ''}" data-pick="${c.code}">
          <img src="${flagUrl(c.code)}" alt="" class="flag-s"><span>${c.name}</span>
          <span class="tag ${difficulty(c).cls}">${difficulty(c).label}</span>
        </button>`).join('')}`).join('');

    const p = this.picked ? COUNTRY[this.picked] : null;
    const st = this.settings;
    const seg = (key: 'difficulty', opts: [Difficulty, string][]) => opts.map(([v, l]) =>
      `<button class="seg-btn ${st[key] === v ? 'on' : ''}" data-diff="${v}">${l}</button>`).join('');
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
        <div class="muted small">Областей: ${regionsOf(p.code).length}. Столица: ${REGION[CAPITAL[p.code]].name}.</div>
        <div class="trait"><div class="muted small">Особенность</div><b>${TRAITS[p.trait].name}</b><div>${TRAITS[p.trait].text}</div></div>
        ${politicsBlock([...p.parties], topPartyOf(p), p.gov)}
        <div class="setup">
          <div class="setup-row"><span>Сложность</span><div class="seg">${seg('difficulty', [['easy', 'Лёгкая'], ['normal', 'Обычная'], ['hard', 'Тяжёлая']])}</div></div>
          <div class="setup-row"><span>Партия</span><div class="seg">
            <button class="seg-btn ${!st.short ? 'on' : ''}" data-short="0">Вся Европа</button>
            <button class="seg-btn ${st.short ? 'on' : ''}" data-short="1">${SHORT_TURNS} ходов</button></div></div>
          <div class="muted small">${st.short ? `Через ${SHORT_TURNS} ходов побеждает страна с наибольшей территорией.` : 'Победа — когда вся Европа ваша.'}</div>
        </div>
        <button class="btn primary wide" id="play">Играть: ${p.name}</button>
      </div>` : '';

    $('#start').innerHTML = `
      <div class="brand"><span class="logo">${icon('flag', 20)}</span><div><h1>Mapping</h1>
        <div class="muted">Выберите страну и объедините Европу</div></div>
        <button class="icon-btn to-menu" id="to-menu" aria-label="Главное меню" title="Главное меню">${icon('prev', 16)}</button></div>
      ${saved ? `<button class="btn continue wide" id="continue"><img src="${flagUrl(saved.player)}" alt="" class="flag-s">
        Продолжить: ${COUNTRY[saved.player].name}, ход ${saved.turn}</button>` : ''}
      ${card}
      <div class="country-list">${list}</div>`;

    $('#start').querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => {
      b.onclick = () => {
        this.onRegion(CAPITAL[b.dataset.pick!]);
        this.map.focus(regionIds(b.dataset.pick!), isMobile() ? { padBottom: $('#start').offsetHeight } : { padLeft: 380 });
      };
    });
    $('#start').querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) => {
      b.onclick = () => { this.settings.difficulty = b.dataset.diff as Difficulty; play('click'); this.renderStart(); };
    });
    $('#start').querySelectorAll<HTMLButtonElement>('[data-short]').forEach((b) => {
      b.onclick = () => { this.settings.short = b.dataset.short === '1'; play('click'); this.renderStart(); };
    });
    const playBtn = document.getElementById('play');
    if (playBtn) playBtn.onclick = () => this.startGame(this.picked!);
    $('#to-menu').onclick = () => { play('click'); this.showMenu(); };
    const cont = document.getElementById('continue');
    if (cont && saved) cont.onclick = () => { this.s = saved; this.enterGame(); };
  }

  private async startGame(code: string) {
    await breakAd();
    play('turn');
    this.s = newGame(code, drawHand(), { ...this.settings });
    save(this.s);
    this.enterGame();
    if (!tutorialDone()) setTimeout(() => this.tutorial.start(), 900);
  }

  private enterGame() {
    document.body.dataset.mode = 'game';
    gameplay(true);
    this.selected = this.home();
    this.unitSel = null;
    this.journalSeen = this.s!.log.length;
    this.renderAll();
    setTimeout(() => this.focusHome(), 60);
    this.showPending();
  }

  private home(): string {
    const s = this.s!;
    const cap = s.capital[s.player];
    return cap && s.owner[cap] === s.player ? cap : owned(s)[0] ?? CAPITAL[s.player];
  }

  private pads() {
    const panel = $('#panel').getBoundingClientRect();
    return isMobile() ? { padBottom: panel.height } : { padRight: panel.width + 24 };
  }

  private focusHome() {
    const code = this.s?.player ?? this.picked;
    if (!code) return;
    const ids = this.s ? owned(this.s) : regionIds(code);
    this.map.focus(ids.length ? ids : regionIds(code), this.s ? this.pads() : { padLeft: isMobile() ? 0 : 380 });
  }

  // ---------- clicks on the map ----------

  private unit(): Unit | null {
    const s = this.s;
    return s && this.unitSel != null ? s.units.find((u) => u.id === this.unitSel) ?? null : null;
  }

  private clearUnit() {
    this.unitSel = null;
    this.target = null;
    this.renderPanel();
    this.updateMap();
  }

  private onRegion(id: string | null) {
    if (this.cinematic || this.busy) return;
    if (!this.s) {
      if (!id) return;
      this.picked = REGION[id]?.c ?? id;
      play('select');
      this.renderStart();
      this.updateMap();
      return;
    }
    const s = this.s;
    const u = this.unit();
    if (u && id && u.owner === s.player) {
      if (u.type === 'army' && canMoveArmy(s, u, id)) {
        const before = armiesAt(s, id, s.player).length;
        const part = this.amount(u) < u.str ? splitArmy(s, u, this.amount(u)) : u;
        const m = moveArmy(s, part, id);
        this.unitSel = part !== u ? u.id : m?.id ?? null;
        this.send = null;
        if (before) this.toast('Армии объединились', 'info');
        else if (part !== u) this.toast(`Отправлено ${part.str}, на месте осталось ${u.str}`, 'info');
        play('select');
        this.target = null;
        this.selected = id;
        save(s);
        this.renderAll();
        return;
      }
      if (u.type === 'army' && canAttackRegion(s, u, id)) {
        if (this.target === id) { void this.doAttack(u, id); return; }
        this.target = id;
        this.joiners.clear();
        this.selected = id;
        play('select');
        this.renderPanel();
        this.updateMap();
        return;
      }
      if (u.type === 'air' && airTargets(s, u).regions.includes(id)) { void this.doStrike(u, id); return; }
      if (u.type === 'air' && moveAir(s, u, id)) {
        play('select');
        this.toast(`Авиакрыло перелетело: ${regionTitle(id)}`, 'info');
        this.selected = id;
        save(s);
        this.renderAll();
        return;
      }
    }
    this.unitSel = null;
    this.target = null;
    this.selected = id ?? this.home();
    if (id) play('select');
    this.renderPanel();
    this.updateMap();
  }

  private onUnit(id: number) {
    if (this.cinematic || this.busy || !this.s) return;
    const s = this.s;
    const u = s.units.find((x) => x.id === id);
    if (!u) return;
    const mine = this.unit();
    // clicking an enemy counter with an order in hand means "go there"
    if (mine && u.owner !== s.player) {
      if (SEA[u.at]) return this.onZone(u.at);
      return this.onRegion(u.at);
    }
    if (u.owner === s.player) {
      this.unitSel = this.unitSel === id ? null : id;
      this.send = null;
      this.target = null;
      if (!SEA[u.at]) this.selected = u.at;
      play('select');
      this.renderPanel();
      this.updateMap();
      return;
    }
    if (!SEA[u.at]) this.onRegion(u.at);
  }

  private onZone(z: string) {
    if (this.cinematic || this.busy || !this.s) return;
    const s = this.s;
    const u = this.unit();
    if (!u || u.owner !== s.player) return;
    if (u.type === 'fleet' && fleetMoves(u).includes(z) && !u.acted) {
      const r = moveFleet(s, u, z);
      if (r.battle) {
        play(r.won ? 'win' : 'loss');
        this.toast(r.won ? `Морская победа: ${SEA[z].name}` : `Флот разбит: ${SEA[z].name}`, r.won ? 'good' : 'bad');
      } else play('select');
      save(s);
      this.renderAll();
      return;
    }
    if (u.type === 'air' && airTargets(s, u).zones.includes(z)) void this.doStrike(u, z);
  }

  private orders(): Orders | null {
    const s = this.s;
    const u = this.unit();
    if (!s || !u || u.owner !== s.player || u.acted) return null;
    if (u.type === 'army') {
      const near = neighbours(u.at);
      return {
        moves: near.filter((r) => canMoveArmy(s, u, r)),
        attacks: asIfStrength(u, this.amount(u), () => near.filter((r) => canAttackRegion(s, u, r))
          .map((r) => ({ r, ch: chance(s, u, r), war: atWar(s, s.player, s.owner[r]) }))),
        strikes: [], zones: [],
      };
    }
    if (u.type === 'air') {
      const t = airTargets(s, u);
      return { moves: airMoves(s, u), attacks: [], strikes: [...t.regions, ...t.zones], zones: [] };
    }
    return { moves: [], attacks: [], strikes: [], zones: fleetMoves(u) };
  }

  // ---------- actions ----------

  /** Refreshes the attack forecast numbers without rebuilding the panel. */
  private updateForecast(u: Unit) {
    const s = this.s!;
    const t = this.target;
    if (!t || !document.getElementById('att-chance')) return;
    const join = [...this.joiners];
    const n = this.amount(u);
    const ch = asIfStrength(u, n, () => chance(s, u, t, join));
    $('#att-chance').textContent = `${ch}%`;
    $('#att-bar').style.width = `${ch}%`;
    $('#att-power').textContent = fmt(asIfStrength(u, n, () => attackPower(s, u, t, join)));
    $('#att-notes').innerHTML = this.notesHtml(u, t, join);
  }

  /** Terrain and supply lines under the battle forecast. */
  private notesHtml(u: Unit, t: string, join: number[]) {
    return battleNotes(this.s!, u, t, join).map((x) => {
      const ic = x.text.startsWith('Горы') ? 'mountain' : x.text.startsWith('Река') ? 'river' : 'supply';
      return `<div class="battle-note ${x.good ? 'good' : 'bad'}">${icon(ic, 14)} ${x.text}</div>`;
    }).join('');
  }

  private async doAttack(u: Unit, to: string) {
    const s = this.s!;
    const enemy = s.owner[to];
    if (!atWar(s, s.player, enemy)) {
      const ok = await this.confirmWar(enemy);
      if (!ok) return;
    }
    this.busy = true;
    const wasCapital = s.capital[enemy] === to;
    const join = [...this.joiners];
    const group = attackers(s, u, to, join).length;
    await this.map.playStrike(u.at, to, COUNTRY[s.player].color, 'attack');
    const part = this.amount(u) < u.str ? splitArmy(s, u, this.amount(u)) : u;
    this.send = null;
    const r = playerAttack(s, part, to, join);
    this.joiners.clear();
    this.busy = false;
    this.target = null;
    if (!r) { this.renderAll(); return; }
    if (r.won) {
      play(wasCapital ? 'capital' : 'win');
      const spoils = [r.loot.money ? `+${r.loot.money} денег` : '', r.loot.army ? `+${r.loot.army} солдат` : ''].filter(Boolean).join(', ');
      this.toast(`Взято: ${regionTitle(to)}${group > 1 ? ` (армий: ${group})` : ''}${spoils ? ` · ${spoils}` : ''}`, 'good');
      this.selected = to;
    } else {
      play('loss');
      this.toast(`Атака отбита: ${regionTitle(to)}`, 'bad');
    }
    if (!s.units.includes(u)) this.unitSel = null;
    save(s);
    this.renderAll();
    this.map.flash(r.won ? [to] : []);
    this.showFresh();
  }

  private async doStrike(a: Unit, target: string) {
    const s = this.s!;
    this.busy = true;
    await this.map.playStrike(a.at, target, '#ffd27a', 'air');
    const r = airStrike(s, a, target);
    this.busy = false;
    if (r) {
      play('win');
      this.toast(`Авиаудар: −${r.dmg} у врага, наши потери ${r.lost}`, 'good');
    }
    if (!s.units.includes(a)) this.unitSel = null;
    save(s);
    this.renderAll();
    this.showFresh();
  }

  private act(fn: () => void) {
    fn();
    save(this.s!);
    this.renderAll();
  }

  // ---------- drawing ----------

  private renderAll() {
    if (!this.s) return;
    this.renderHud();
    this.renderPanel();
    this.renderDecisions();
    this.renderJournal();
    this.renderModes();
    this.updateMap();
    if (this.s.won || this.s.lost) this.showEnd();
  }

  private updateMap() {
    const s = this.s;
    const u = this.unit();
    this.map.update({
      owner: s ? this.ownerView ?? s.owner : Object.fromEntries(REGIONS.map((r) => [r.id, r.c])),
      player: s ? s.player : null,
      selected: s ? (u && !SEA[u.at] ? [u.at] : this.selected ? [this.selected] : []) : this.picked ? regionIds(this.picked) : [],
      allies: new Set(s?.allies ?? []),
      capitals: s?.capital,
      units: s?.units ?? [],
      selectedUnit: this.unitSel,
      joining: this.target ? this.joiners : undefined,
      orders: this.orders(),
      fill: s ? this.fill() : null,
    });
  }

  /** Colours for the non-political map modes. */
  private fill(): Record<string, string> | null {
    const s = this.s!;
    if (this.mode === 'political') return null;
    const out: Record<string, string> = {};
    const dim = '#232c40';
    for (const r of REGIONS) {
      const o = s.owner[r.id];
      if (this.mode === 'resources') {
        const base = { industry: '#e0b04a', manpower: '#d6564d', hub: '#9b7be0' }[r.kind];
        const v = r.kind === 'manpower' ? r.men / 4 : r.eco / 30;
        out[r.id] = mix(dim, base, 0.35 + 0.65 * Math.min(1, v));
      } else if (this.mode === 'blocs') {
        const b = blocOf(s, o);
        if (o === s.player || (s.allies.includes(o) && !b)) out[r.id] = o === s.player ? '#f0b94d' : '#c9a24a';
        else if (s.coalition.includes(o)) out[r.id] = '#d6403a';
        else if (b) out[r.id] = BLOC_COLORS[s.blocs.indexOf(b) % BLOC_COLORS.length];
        else out[r.id] = dim;
      } else if (this.mode === 'relations') {
        if (o === s.player) out[r.id] = '#f0b94d';
        else if (atWar(s, s.player, o)) out[r.id] = '#d6403a';
        else if (friends(s, s.player, o)) out[r.id] = '#3fbf7f';
        else {
          const rel = relation(s, o);
          out[r.id] = rel >= 0 ? mix('#4a5570', '#5fbf8a', rel / 100) : mix('#4a5570', '#7a3a3a', -rel / 100);
        }
      } else if (this.mode === 'threat') {
        if (o !== s.player) { out[r.id] = atWar(s, s.player, o) ? '#4a2228' : dim; continue; }
        let worst = 0;
        for (const n of neighbours(r.id)) {
          for (const e of armiesAt(s, n)) {
            if (e.owner === s.player || friends(s, s.player, e.owner)) continue;
            const w = atWar(s, s.player, e.owner) ? 1 : 0.5;
            worst = Math.max(worst, chance(s, e, r.id) * w);
          }
        }
        out[r.id] = mix('#2d5a44', '#e2574c', worst / 80);
      } else {
        const un = s.unrest[r.id];
        out[r.id] = un == null ? (o === s.player ? '#33405a' : dim) : mix('#e0c04a', '#e2574c', un / 100);
      }
    }
    return out;
  }

  /** Legend for the current map mode; the bloc one lists the blocs in play. */
  private legend(): string {
    if (this.mode !== 'blocs') return MODES.find((m) => m.id === this.mode)!.legend;
    const s = this.s;
    if (!s) return '';
    const parts = ['<span><i style="background:#f0b94d"></i>вы и союзники</span>'];
    if (s.coalition.some((c) => ownedBy(s, c).length)) parts.push('<span><i style="background:#d6403a"></i>коалиция против вас</span>');
    s.blocs.forEach((b, i) => parts.push(`<span><i style="background:${BLOC_COLORS[i % BLOC_COLORS.length]}"></i>${b.name}: ${b.members.map((m) => COUNTRY[m].name).join(', ')}</span>`));
    if (!s.blocs.length) parts.push('<span class="muted">Блоков пока нет, они складываются по ходу игры</span>');
    return parts.join('');
  }

  private renderModes() {
    const bar = $('#modes');
    bar.innerHTML = `<div class="modes-row">${MODES.map((m) => `
      <button class="mode-btn ${m.id === this.mode ? 'on' : ''}" data-mode="${m.id}" title="${m.name}" aria-label="Режим карты: ${m.name}">
        ${icon(m.icon, 16)}<span>${m.name}</span></button>`).join('')}</div>
      ${this.legend() ? `<div class="mode-legend">${this.legend()}</div>` : ''}`;
    bar.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      b.onclick = () => { this.mode = b.dataset.mode as MapMode; play('click'); this.renderModes(); this.updateMap(); };
    });
  }

  private renderHud() {
    const s = this.s!;
    const p = COUNTRY[s.player];
    const ruling = PARTIES[s.ruling[s.player]];
    const net = netIncome(s);
    const army = armyTotal(s, s.player);
    const dr = army < draftCap(s, s.player) ? draft(s, s.player) : 0;
    const st = s.focus[s.player];
    const allDone = coursesOpen(s, s.player);
    const course = courseOf(s, s.player);
    const goal = st.cur ? `${FOCUS[st.cur].name} · ${st.left}` : allDone ? (course ? COURSE[course].name : 'Выбрать курс') : 'Выбрать цель';
    const idle = !st.cur && !course;
    $('#hud').innerHTML = `
      <div class="hud-me">
        <img src="${flagUrl(s.player)}" alt="Флаг: ${p.name}" class="flag-m">
        <div><b>${p.name}</b><div class="pill" style="--c:${ruling.color}">${ruling.name}</div></div>
      </div>
      <div class="resources">
        <div class="res" title="Деньги. За ход ${signed(net)}: доход ${fmt(grossIncome(s) * s.turnIncomeMul)}, содержание войск −${upkeepOf(s, s.player)}">
          <span class="ri money">${icon('coins')}</span><b>${fmt(s.money)}</b><small class="${net >= 0 ? 'up' : 'down'}">${signed(net)}</small></div>
        <div class="res" title="Армия: сумма всех армий. Призыв +${draft(s, s.player)} за ход, пока армия меньше ${draftCap(s, s.player)}. Флот ${strOf(s, s.player, 'fleet')}, авиация ${strOf(s, s.player, 'air')}">
          <span class="ri army">${icon('swords')}</span><b>${fmt(army)}</b>${dr ? `<small class="up">+${dr}</small>` : ''}</div>
        <div class="res ${s.stability < 30 ? 'warn' : ''}" title="Стабильность. Доход ×${Math.round((0.5 + s.stability / 200) * 100)}%. Ниже 45% протесты, ниже 20% революция, от неё же растёт недовольство в занятых областях">
          <span class="ri stab">${icon('smile')}</span><b>${s.stability}%</b><span class="meter"><i style="width:${s.stability}%"></i></span></div>
        <div class="res" title="Влияние: +${influenceGain(s)} за ход. На отношения, союзы и мирное присоединение">
          <span class="ri infl">${icon('handshake')}</span><b>${s.influence}</b><small class="up">+${influenceGain(s)}</small></div>
      </div>
      <div class="hud-turn">
        <div><b>Ход ${s.turn}${s.settings.short ? ` / ${SHORT_TURNS}` : ''}</b><div class="muted">${season(s.turn)}</div></div>
        <button class="btn hud-btn ${idle ? 'pulse' : ''}" id="goals" title="Национальные цели">${icon(course ? 'repeat' : 'flag', 16)}<span>${goal}</span></button>
        <button class="btn hud-btn" id="upgrades" title="Улучшения">${icon('sparkles', 16)}<span>${s.upgrades.length}/${UPGRADES.length}</span></button>
        <button class="btn hud-btn" id="rank" title="Рейтинг стран">${icon('trophy', 16)}<span>#${rankOf(s, 'power')}</span></button>
        <button class="icon-btn" id="help" aria-label="Как играть" title="Как играть">${icon('help')}</button>
        <button class="icon-btn" id="menu" aria-label="Главное меню" title="Главное меню">${icon('map')}</button>
      </div>`;
    $('#goals').onclick = () => this.showGoals();
    $('#upgrades').onclick = () => this.showUpgrades();
    $('#rank').onclick = () => this.showRanking();
    $('#help').onclick = () => {
      // the lessons are a menu: gameplay stops while they're open
      gameplay(false);
      this.howto.open(() => this.tutorial.start(), () => { if (this.s && document.body.dataset.mode === 'game') gameplay(true); });
    };
    $('#menu').onclick = () => this.showMenu();
  }

  // ---------- side panel ----------

  private renderPanel() {
    const s = this.s!;
    const u = this.unit();
    $('#panel').innerHTML = u && u.owner === s.player ? this.unitPanel(u) : this.regionPanel(this.selected ?? this.home());
    this.bindPanel();
  }

  private unitPanel(u: Unit): string {
    const s = this.s!;
    const info = UNIT_INFO[u.type];
    const where = SEA[u.at] ? SEA[u.at].name : regionTitle(u.at);
    let body = '';
    if (u.type === 'army') {
      const t = this.target && canAttackRegion(s, u, this.target) ? this.target : null;
      if (t) {
        const enemy = s.owner[t];
        const war = atWar(s, s.player, enemy);
        const join = [...this.joiners];
        const n = this.amount(u);
        const group = attackers(s, u, t, join);
        const ch = asIfStrength(u, n, () => chance(s, u, t, join));
        const cands = joinCandidates(s, u, t);
        const joinList = cands.length ? `
          <div class="join-title">Подключить к удару <span class="muted">армии из соседних областей</span></div>
          <div class="unit-list">${cands.map((x) => `
            <button class="unit-row join-row ${this.joiners.has(x.id) ? 'on' : ''}" data-join="${x.id}">${icon('swords', 15)}
              <span>${regionTitle(x.at)}</span><b>${x.str}</b><span class="join-tick">${this.joiners.has(x.id) ? 'В атаке' : 'Подключить'}</span></button>`).join('')}</div>` : '';
        body = `
          <div class="battle">
            <div class="battle-title">${icon('swords', 15)} Атака: ${regionTitle(t)} <img src="${flagUrl(enemy)}" alt="" class="flag-s"></div>
            <div class="battle-row"><span>Наша сила${group.length > 1 ? ` (армий: ${group.length})` : ''}</span><b id="att-power">${fmt(asIfStrength(u, n, () => attackPower(s, u, t, join)))}</b></div>
            <div class="battle-row"><span>Оборона</span><b>${fmt(defensePower(s, t))}</b></div>
            <div id="att-notes">${this.notesHtml(u, t, join)}</div>
            <div class="chance"><div class="chance-bar"><i id="att-bar" style="width:${ch}%"></i></div><span>Шанс победы <b id="att-chance">${ch}%</b></span></div>
            ${war ? '' : `<div class="warn-line">${icon('flag', 14)} Войны с этой страной нет. Атака объявит её: −${warPenalty(s)} стабильности</div>`}
          </div>
          ${joinList}
          <button class="btn danger wide" id="attack">${icon('swords', 16)} ${war ? 'Атаковать' : 'Объявить войну и атаковать'}</button>
          <button class="btn ghost wide" id="cancel-target">Отмена</button>`;
      } else if (u.acted) {
        body = `<div class="note">Армия уже действовала в этом ходу.</div>`;
      } else {
        body = `<div class="hint">${icon('next', 14)} Зелёная стрелка — перейти (армии в одной области объединяются). Процент — атаковать: нажмите, затем можно подключить армии из соседних областей.</div>`;
      }
      if (!u.acted && u.str >= 2) {
        const n = this.amount(u);
        body = `
          <div class="send">
            <div class="send-top"><span>Отправить</span><b id="send-val">${n}</b><span class="muted">из ${u.str}</span></div>
            <input type="range" id="send" min="1" max="${u.str}" step="1" value="${n}" aria-label="Сколько солдат отправить">
            <div class="send-btns"><button class="seg-btn" data-send="half">Половина</button><button class="seg-btn" data-send="all">Все</button></div>
          </div>` + body;
      }
      const why = cantReinforce(s, u);
      body += `
        <div class="row-btns">
          <button class="btn" id="reinforce" ${why ? `data-off="${why}"` : ''}>${icon('users', 15)} +10 за ${price(s, s.player, 'reinforce')}</button>
          <button class="btn ghost" id="disband">Распустить</button>
        </div>`;
    } else if (u.type === 'air') {
      body = u.acted ? `<div class="note">Авиакрыло уже летало в этом ходу.</div>`
        : `<div class="hint">${icon('target', 14)} Прицелы — вражеские армии и флоты в радиусе 2 областей: нажмите, чтобы ударить. Зелёные стрелки — перелёт на свою территорию.</div>`;
      body += `<div class="row-btns"><button class="btn ghost" id="disband">Распустить</button></div>`;
    } else {
      body = u.acted ? `<div class="note">Флот уже ходил в этом ходу.</div>`
        : `<div class="hint">${icon('dove', 14)} Нажмите на соседнее море, чтобы перейти. Пока флот стоит в море, враг не может высадиться через него, если его флот не сильнее.</div>`;
      body += `<div class="row-btns"><button class="btn ghost" id="disband">Распустить</button></div>`;
    }
    return `
      <div class="panel-head">
        <span class="unit-badge ${u.type}" style="--c:${COUNTRY[u.owner].color}">${icon(u.type === 'army' ? 'swords' : u.type === 'air' ? 'target' : 'dove', 22)}</span>
        <div><h2>${info.name} · ${u.str}</h2><div class="muted">${where}</div></div>
        <button class="icon-btn" id="close-unit" aria-label="Снять выделение">${icon('close', 16)}</button>
      </div>
      <div class="muted small">${info.text}</div>
      ${this.supplyLine(u)}
      <div class="actions">${body}</div>`;
  }

  private supplyLine(u: Unit) {
    const st = supplyStatus(this.s!, u);
    if (u.type !== 'army') return '';
    return `<div class="supply ${st.level}">${icon('supply', 14)} ${st.text}</div>`;
  }

  /** Mountains and border rivers of a region. */
  private terrainLine(id: string) {
    const r = REGION[id];
    const rivers = [...new Set(Object.values(r.rivers))];
    const parts = [
      r.mountain ? `<span>${icon('mountain', 14)} Горы: оборона +${Math.round(MOUNTAIN_BONUS * 100)}%</span>` : '',
      rivers.length ? `<span>${icon('river', 14)} ${rivers.length > 1 ? 'Реки' : 'Река'} ${rivers.join(', ')}: атака через ${rivers.length > 1 ? 'них' : 'неё'} слабее</span>` : '',
    ].filter(Boolean);
    return parts.length ? `<div class="terrain">${parts.join('')}</div>` : '';
  }

  private regionPanel(id: string): string {
    const s = this.s!;
    const r = REGION[id];
    const o = s.owner[id];
    const mine = o === s.player;
    const title = regionTitle(id);
    const isCap = s.capital[o] === id;
    const occupied = o !== r.c;
    const share = integrated(s, id) ? 1 : 0.5;
    const unrest = s.unrest[id];

    // what the region gives
    const chips = [
      r.eco ? `<span class="chip money">${icon('coins', 13)} +${Math.round(r.eco * share)}</span>` : '',
      r.men ? `<span class="chip men">${icon('users', 13)} +${Math.round(r.men * share)}</span>` : '',
    ].join('');
    let status = `${COUNTRY[o].name}${isCap ? ' · столица' : ''}`;
    if (occupied) status += ` · занята у ${COUNTRY[r.c].name}`;
    let occ = '';
    if (occupied && !integrated(s, id)) {
      const left = INTEGRATE_AFTER - (s.turn - (s.heldSince[id] ?? s.turn));
      occ = `<div class="occ">${icon('megaphone', 14)} Недовольство <b>${unrest ?? 0}%</b> · своей станет через ${left} ход.
        ${mine ? '<span class="muted">Армия в области успокаивает народ.</span>' : ''}</div>`;
    }

    // what can be done here
    let actions = '';
    const here = s.units.filter((u) => u.at === id && u.owner === s.player);
    const fleetsNear = s.units.filter((u) => u.type === 'fleet' && u.owner === s.player && r.coast.includes(u.at));
    const unitList = [...here, ...fleetsNear].map((u) => `
      <button class="unit-row" data-unit="${u.id}">${icon(u.type === 'army' ? 'swords' : u.type === 'air' ? 'target' : 'dove', 15)}
        <span>${UNIT_INFO[u.type].name}${SEA[u.at] ? ` · ${SEA[u.at].name}` : ''}</span><b>${u.str}</b>${u.acted ? '<span class="muted small">ходила</span>' : ''}</button>`).join('');
    if (mine) {
      const b = (type: 'army' | 'fleet' | 'air', label: string) => {
        const why = cantBuild(s, s.player, type, id);
        if (type === 'fleet' && !r.coast.length) return '';
        return `<button class="btn" data-build="${type}" ${why ? `data-off="${why}"` : ''}>${label} · ${price(s, s.player, type)}</button>`;
      };
      actions = `
        ${unitList ? `<div class="unit-list">${unitList}</div>` : ''}
        <div class="build-title">Набрать здесь <span class="muted">армий ${unitsOf(s, s.player, 'army').length}/${maxArmies(s, s.player)}</span></div>
        <div class="row-btns">${b('army', armiesAt(s, id, s.player).length ? '+10 в армию' : 'Новая армия')}${b('fleet', 'Флот')}${b('air', 'Авиация')}</div>`;
    } else {
      actions = this.nationBlock(o);
    }

    const nation = mine ? s.player : o;
    const tr = trait(nation);
    const st = s.focus[nation];
    return `
      <div class="panel-head">
        <img src="${flagUrl(o)}" alt="Флаг: ${COUNTRY[o].name}" class="flag-l">
        <div><h2>${isCap ? `${icon('star', 16)} ` : ''}${title}</h2><div class="muted">${status}</div></div>
      </div>
      <div class="yield ${r.kind}"><span>${KIND_INFO[r.kind].name}</span><div class="yield-row">${chips}</div></div>
      ${this.terrainLine(id)}
      ${occ}
      <div class="actions">${actions}</div>
      <details class="more" ${mine ? '' : 'open'}>
        <summary>${COUNTRY[nation].name}: подробнее</summary>
        <div class="stats three">
          <div class="stat">${icon('swords', 15)}<span>Армия</span><b>${armyTotal(s, nation)}</b></div>
          <div class="stat">${icon('dove', 15)}<span>Флот</span><b>${strOf(s, nation, 'fleet')}</b></div>
          <div class="stat">${icon('target', 15)}<span>Авиация</span><b>${strOf(s, nation, 'air')}</b></div>
        </div>
        <div class="muted small">Областей: ${ownedBy(s, nation).length} · ключевых: ${keyRegions(s, nation).length}${s.keyless[nation] ? ` · без столицы ${s.keyless[nation]} ход.` : ''}${blocOf(s, nation) ? ` · ${blocOf(s, nation)!.name}` : ''}</div>
        <div class="trait"><div class="muted small">Особенность</div><b>${tr.name}</b><div>${tr.text}</div></div>
        ${st.cur ? `<div class="muted small">Цель: ${FOCUS[st.cur].name} (${st.left} ход.)</div>` : ''}
        ${nation === s.player && blocOf(s, s.player) ? `<button class="btn ghost wide" id="leave-bloc">Выйти: ${blocOf(s, s.player)!.name}</button>` : ''}
        ${politicsBlock(s.parties[nation], s.ruling[nation], COUNTRY[nation].gov, nation === s.player ? `Ходов до выборов: ${s.nextElection - s.turn}` : '')}
      </details>`;
  }

  /** War, peace and friendship with another country. */
  private nationBlock(n: string): string {
    const s = this.s!;
    const war = atWar(s, s.player, n);
    const label = relationLabel(s, n);
    const rel = relation(s, n);
    let threat = '';
    const odds = owned(s).flatMap((r) => neighbours(r).filter((x) => s.owner[x] === n)
      .flatMap((x) => armiesAt(s, x, n).map((e) => chance(s, e, r))));
    const worst = odds.length ? Math.max(...odds) : 0;
    if (worst > 0 && !war) {
      const when = s.turn < PLAYER_SAFE_UNTIL ? ` (не раньше ${PLAYER_SAFE_UNTIL}-го хода)` : '';
      threat = `<div class="threat ${worst >= 60 ? 'bad' : worst >= 35 ? 'mid' : 'good'}">${icon('shield', 14)} Если нападут на вас: шанс ${worst}%${when}</div>`;
    }
    const bloc = blocOf(s, n);
    let btns = '';
    if (war) {
      btns = `<div class="war-line">${icon('swords', 15)} Идёт война</div>
        <button class="btn wide" id="peace">${icon('handshake', 16)} Предложить мир</button>`;
    } else {
      const why = cantDeclare(s, s.player, n);
      const ac = cantAnnex(s, n);
      btns = `
        <div class="dip-head"><span>Отношения</span><b class="${label.tone}">${label.text} · ${rel > 0 ? '+' : ''}${rel}</b></div>
        <div class="rel-bar"><i style="left:${(rel + 100) / 2}%"></i><span style="left:${(ALLY_MIN + 100) / 2}%"></span></div>
        ${isAlly(s, n) ? `<button class="btn ghost wide" id="break">Разорвать союз</button>` : `
        <div class="row-btns">
          <button class="btn" id="improve" ${s.influence < improveCost(s, n) || rel >= 100 ? `data-off="Нужно ${improveCost(s, n)} влияния"` : ''}>+15 · ${improveCost(s, n)} влияния</button>
          <button class="btn" id="ally" ${!canAlly(s, n) ? `data-off="${rel < ALLY_MIN ? `Нужны отношения от +${ALLY_MIN}` : `Нужно ${ALLIANCE_COST} влияния`}"` : ''}>${icon('handshake', 14)} Союз</button>
        </div>`}
        ${!ac || ac.startsWith('Нужно') ? `<button class="btn wide" id="annex" ${ac ? `data-off="${ac}"` : ''}>${icon('handshake', 15)} Присоединить мирно · ${annexCost(s, n)} влияния</button>` : ''}
        ${bloc && !bloc.members.includes(s.player) && bloc.members[0] === n ? `<button class="btn wide" id="join" ${cantJoin(s, bloc.id) ? `data-off="${cantJoin(s, bloc.id)}"` : ''}>Вступить: ${bloc.name}</button>` : ''}
        <button class="btn danger-ghost wide" id="declare" ${why ? `data-off="${why}"` : ''}>${icon('swords', 15)} Объявить войну</button>`;
    }
    return `<div class="diplomacy">${btns}</div>${threat}${enemiesOf(s, n).length ? `<div class="muted small">Воюет с: ${enemiesOf(s, n).map((e) => COUNTRY[e].name).join(', ')}</div>` : ''}`;
  }

  private bindPanel() {
    const s = this.s!;
    const on = (id: string, fn: () => void) => {
      const b = document.getElementById(id);
      if (b) b.onclick = () => (b.dataset.off ? this.toast(b.dataset.off, 'bad') : fn());
    };
    const u = this.unit();
    const sel = this.selected ?? this.home();
    const o = s.owner[sel];
    on('close-unit', () => this.clearUnit());
    on('cancel-target', () => { this.target = null; this.renderPanel(); });
    if (u) {
      on('attack', () => { if (this.target) void this.doAttack(u, this.target); });
      const slider = document.getElementById('send') as HTMLInputElement | null;
      if (slider) {
        // live numbers while dragging; the panel is redrawn only when the drag ends
        slider.oninput = () => {
          this.send = Number(slider.value);
          $('#send-val').textContent = slider.value;
          this.updateForecast(u);
          this.updateMap();
        };
        slider.onchange = () => this.renderPanel();
      }
      $('#panel').querySelectorAll<HTMLButtonElement>('[data-send]').forEach((b) => {
        b.onclick = () => {
          this.send = b.dataset.send === 'half' ? Math.max(1, Math.round(u.str / 2)) : null;
          play('click');
          this.renderPanel();
          this.updateMap();
        };
      });
      on('reinforce', () => this.act(() => { if (reinforceUnit(s, u)) play('recruit'); }));
      $('#panel').querySelectorAll<HTMLButtonElement>('[data-join]').forEach((b) => {
        b.onclick = () => {
          const id = Number(b.dataset.join);
          if (this.joiners.has(id)) this.joiners.delete(id); else this.joiners.add(id);
          play('click');
          this.renderPanel();
          this.updateMap();
        };
      });
      on('disband', () => this.act(() => { disband(s, u); this.unitSel = null; }));
    }
    $('#panel').querySelectorAll<HTMLButtonElement>('[data-unit]').forEach((b) => {
      b.onclick = () => this.onUnit(Number(b.dataset.unit));
    });
    $('#panel').querySelectorAll<HTMLButtonElement>('[data-build]').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.off) return this.toast(b.dataset.off, 'bad');
        this.act(() => { if (build(s, s.player, b.dataset.build as 'army', sel)) play('recruit'); });
      };
    });
    on('peace', () => this.showPeace(o));
    on('declare', async () => { if (await this.confirmWar(o)) this.renderAll(); });
    on('improve', () => this.act(() => { if (improveRelations(s, o)) play('click'); }));
    on('ally', () => this.act(() => { if (proposeAlliance(s, o)) { play('ally'); this.toast(`Союз: ${COUNTRY[o].name}`, 'good'); } }));
    on('break', () => this.act(() => { breakAlliance(s, o); }));
    on('annex', () => this.act(() => { if (annex(s, o)) { play('ally'); this.toast(`Мирно присоединена: ${COUNTRY[o].name}`, 'good'); } }));
    on('leave-bloc', () => this.act(() => { leaveBloc(s); }));
    on('join', () => this.act(() => { const b = blocOf(s, o); if (b && joinBloc(s, b.id)) { play('ally'); } }));
  }

  // ---------- decisions and end of turn ----------

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
    const idle = this.idleUnits().length;
    $('#decisions').innerHTML = `
      <div class="cards">${cards}</div>
      <div class="end-col">
        <button class="btn next-unit" id="next-unit" ${idle ? '' : 'data-off="Все отряды получили приказ"'}>
          ${icon('next', 15)}<span>Следующий отряд</span><b>${idle}</b></button>
        <button class="btn primary end" id="end-turn">
          <span>Конец хода</span><small>${signed(netIncome(s))} денег</small></button>
      </div>`;
    $('#next-unit').onclick = () => (idle ? this.nextUnit() : this.toast('Все отряды получили приказ', 'info'));
    $('#decisions').querySelectorAll<HTMLButtonElement>('[data-card]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.card!;
        if (s.played) return this.toast(s.played === id ? 'Это решение уже принято' : 'В этом ходу решение уже принято', 'info');
        const why = CARD[id].blocked?.(s);
        if (why) return this.toast(why, 'bad');
        this.act(() => { playCard(s, id); });
        play('card');
        this.toast(`Решение: ${CARD[id].title}`, 'good');
      };
    });
    $('#end-turn').onclick = () => void this.endTurn();
  }

  /** The player's units that still have an order to give this turn. */
  private idleUnits() {
    const s = this.s!;
    return unitsOf(s, s.player).filter((u) => !u.acted).sort((a, b) =>
      ['army', 'air', 'fleet'].indexOf(a.type) - ['army', 'air', 'fleet'].indexOf(b.type) || a.id - b.id);
  }

  /** Selects the next unit without an order and brings the camera to it. */
  private nextUnit() {
    const list = this.idleUnits();
    if (!list.length) return;
    const i = list.findIndex((u) => u.id === this.unitSel);
    const u = list[(i + 1) % list.length];
    this.onUnit(u.id);
    if (this.unitSel !== u.id) this.onUnit(u.id);
    const s = this.s!;
    const where = SEA[u.at] ? REGIONS.filter((r) => r.coast.includes(u.at) && s.owner[r.id] === s.player).map((r) => r.id) : [u.at];
    if (where.length) this.map.focus(where.slice(0, 1), { ...this.pads(), duration: 450 });
  }

  private async endTurn() {
    const s = this.s!;
    if (this.cinematic || this.busy) return;
    this.busy = true;
    // between turns is a natural break for an ad (the platform limits how often)
    await breakAd();
    this.unitSel = null;
    this.target = null;
    const before = { ...s.owner };
    const income = endTurn(s);
    save(s);
    const captures = s.events.filter((e) => e.won && e.defender === s.player && before[e.target] === s.player);
    if (captures.length) {
      this.ownerView = { ...s.owner };
      for (const e of captures) this.ownerView[e.target] = s.player;
      this.renderHud();
      this.renderDecisions();
      this.updateMap();
      await this.playCaptures(captures);
    }
    this.busy = false;
    this.selected = this.home();
    this.renderAll();
    this.map.flash(s.events.filter((e) => e.won && !captures.includes(e)).map((e) => e.target));
    if (s.won || s.lost) return;
    this.toast(`Ход ${s.turn}, ${season(s.turn)}. Доход ${signed(income)}`, 'info');
    play('turn');
    if (s.events.some((e) => e.defender === s.player)) play('alarm');
    this.showPending();
    this.showFresh();
  }

  /** Windows that wait for the player after a turn: event, notices, peace offers. */
  private showPending() {
    const s = this.s!;
    const next = () => this.showPending();
    if (s.pendingEvent) return this.showEvent(next);
    if (s.notice) {
      const n = s.notice;
      s.notice = null;
      save(s);
      play(n.tone === 'bad' ? 'alarm' : 'event');
      const m = this.modal(`<div class="notice ${n.tone}"><h3>${n.title}</h3><p>${n.text}</p></div>
        <div class="row"><button class="btn primary" data-m="ok">Понятно</button></div>`, 'notice-card');
      m.querySelector<HTMLButtonElement>('[data-m="ok"]')!.onclick = () => { this.closeModal(); next(); };
      return;
    }
    if (s.peaceOffer) {
      const n = s.peaceOffer;
      s.peaceOffer = null;
      save(s);
      play('event');
      const m = this.modal(`
        <div class="event-head"><img src="${flagUrl(n)}" alt="" class="flag-l"><div class="event-meta">Предложение мира</div></div>
        <h3>${COUNTRY[n].name} просит мира</h3>
        <p class="event-text">Они признают поражение: вы оставляете себе всё, что заняли в этой войне. Затем перемирие на 10 ходов.</p>
        <div class="row"><button class="btn ghost" data-m="no">Воевать дальше</button><button class="btn primary" data-m="yes">Заключить мир</button></div>`);
      m.querySelector<HTMLButtonElement>('[data-m="no"]')!.onclick = () => { this.closeModal(); next(); };
      m.querySelector<HTMLButtonElement>('[data-m="yes"]')!.onclick = () => {
        this.closeModal();
        this.act(() => makePeace(s, s.player, n, 'keep'));
        play('ally');
        next();
      };
    }
  }

  /** Achievements unlocked since last time. */
  private showFresh() {
    const s = this.s;
    if (!s?.fresh.length) return;
    for (const id of s.fresh) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (a) this.toast(`Достижение: ${a.name}`, 'good');
    }
    s.fresh = [];
    play('buy');
    save(s);
  }

  /** Camera flies to each region the enemy took and shows the attack. */
  private async playCaptures(captures: WarEvent[]) {
    const skip: Skip = { skipped: false };
    this.cinematic = true;
    document.body.classList.add('cinematic');
    const banner = $('#cine');
    banner.className = 'open';
    banner.innerHTML = `<div class="cine-text" id="cine-text"></div><button class="btn ghost" id="cine-skip">Пропустить</button>`;
    $('#cine-skip').onclick = () => { skip.skipped = true; };
    play('alarm');
    for (const e of captures.slice(0, 5)) {
      if (skip.skipped) break;
      const who = COUNTRY[e.attacker].name;
      const where = regionTitle(e.target);
      banner.classList.remove('lost');
      $('#cine-text').innerHTML = `<img src="${flagUrl(e.attacker)}" alt="" class="flag-s"><span>${who} наступает: <b>${where}</b></span>`;
      await this.map.playCapture(this.originOf(e.attacker, e.target), e.target, COUNTRY[e.attacker].color, () => {
        this.ownerView![e.target] = e.attacker;
        this.updateMap();
        play('loss');
        banner.classList.add('lost');
        $('#cine-text').innerHTML = `<img src="${flagUrl(e.attacker)}" alt="" class="flag-s"><span><b>${where}</b> потеряна. Её занимает ${who}</span>`;
      }, skip, this.pads());
    }
    this.ownerView = null;
    banner.className = '';
    banner.innerHTML = '';
    document.body.classList.remove('cinematic');
    this.cinematic = false;
    this.updateMap();
    this.focusHome();
  }

  private originOf(attacker: string, target: string): string {
    const shown = this.ownerView ?? this.s!.owner;
    return neighbours(target).find((r) => shown[r] === attacker) ?? CAPITAL[attacker] ?? target;
  }

  // ---------- journal ----------

  private renderJournal() {
    const s = this.s!;
    const fresh = Math.max(0, s.log.length - this.journalSeen);
    const open = document.body.classList.contains('journal-open');
    const byTurn = new Map<number, typeof s.log>();
    for (const l of s.log.filter((x) => this.journalAll || x.tone !== 'info').slice(0, 60)) {
      if (!byTurn.has(l.turn)) byTurn.set(l.turn, []);
      byTurn.get(l.turn)!.push(l);
    }
    $('#journal').innerHTML = `
      <button class="btn journal-btn" id="journal-btn">${icon('ballot', 16)}<span>Журнал</span>${fresh && !open ? `<i>${fresh}</i>` : ''}</button>
      <div class="journal-list"><div class="j-filter"><button class="seg-btn ${this.journalAll ? '' : 'on'}" data-jall="0">Моё</button><button class="seg-btn ${this.journalAll ? 'on' : ''}" data-jall="1">Всё в Европе</button></div>${[...byTurn].map(([t, ls]) => `
        <div class="j-turn">Ход ${t}</div>
        ${ls.map((l) => `<div class="j-line ${l.tone}">${l.text}</div>`).join('')}`).join('') || '<div class="muted small">Пока пусто</div>'}</div>`;
    $('#journal').querySelectorAll<HTMLButtonElement>('[data-jall]').forEach((b) => {
      b.onclick = () => { this.journalAll = b.dataset.jall === '1'; this.renderJournal(); };
    });
    $('#journal-btn').onclick = () => {
      document.body.classList.toggle('journal-open');
      this.journalSeen = s.log.length;
      play('click');
      this.renderJournal();
    };
  }

  // ---------- windows ----------

  private toast(text: string, tone: 'good' | 'bad' | 'info') {
    const t = document.createElement('div');
    t.className = `toast ${tone}`;
    t.textContent = text;
    $('#toasts').prepend(t);
    setTimeout(() => t.classList.add('out'), 2800);
    setTimeout(() => t.remove(), 3200);
  }

  private modal(html: string, cls = '') {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card ${cls}">${html}</div>`;
    m.classList.add('open');
    m.querySelector<HTMLButtonElement>('[data-m="close"]')?.addEventListener('click', () => this.closeModal());
    return m;
  }
  private closeModal() {
    $('#modal').classList.remove('open');
    $('#modal').innerHTML = '';
  }

  private confirmWar(n: string): Promise<boolean> {
    const s = this.s!;
    const why = cantDeclare(s, s.player, n);
    if (why) { this.toast(why, 'bad'); return Promise.resolve(false); }
    const joiners = COUNTRIES.map((c) => c.code).filter((c) => c !== n && friends(s, n, c) && c !== s.player);
    const maybe = possibleGuardians(s, n).filter((c) => !joiners.includes(c));
    return new Promise((resolve) => {
      const m = this.modal(`
        <div class="event-head"><img src="${flagUrl(n)}" alt="" class="flag-l"><div class="event-meta">Объявление войны</div></div>
        <h3>Объявить войну стране ${COUNTRY[n].name}?</h3>
        <ul class="consequences">
          <li class="down">−${warPenalty(s)} стабильности</li>
          <li class="down">Отношения с этой страной −50, с остальными −2</li>
          ${joiners.length ? `<li class="down">За них вступятся: ${joiners.map((j) => COUNTRY[j].name).join(', ')}</li>` : maybe.length ? '' : '<li class="up">Союзников у них нет</li>'}
          ${maybe.length ? `<li class="down">Могут вступиться друзья: ${maybe.map((j) => COUNTRY[j].name).join(', ')}</li>` : ''}
        </ul>
        <div class="row"><button class="btn ghost" data-m="no">Отмена</button><button class="btn danger" data-m="yes">Объявить войну</button></div>`);
      m.querySelector<HTMLButtonElement>('[data-m="no"]')!.onclick = () => { this.closeModal(); resolve(false); };
      m.querySelector<HTMLButtonElement>('[data-m="yes"]')!.onclick = () => {
        this.closeModal();
        declareWar(s, s.player, n);
        play('alarm');
        save(s);
        resolve(true);
      };
    });
  }

  private showPeace(n: string) {
    const s = this.s!;
    const m = this.modal(peaceHtml(s, n), 'peace');
    m.querySelectorAll<HTMLButtonElement>('[data-terms]').forEach((b) => {
      b.onclick = () => {
        const terms = b.dataset.terms as PeaceTerms;
        const a = peaceAnswer(s, n, terms);
        if (!a.ok) { play('loss'); this.toast(a.why, 'bad'); return; }
        this.closeModal();
        this.act(() => makePeace(s, s.player, n, terms, terms === 'reparations' ? n : undefined));
        play('ally');
        this.toast(`Мир заключён: ${COUNTRY[n].name}`, 'good');
      };
    });
  }

  private showRanking() {
    const m = this.modal(rankingHtml(this.s!, this.metric), 'ranking');
    m.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach((b) => {
      b.onclick = () => { this.metric = b.dataset.metric as Metric; play('click'); this.showRanking(); };
    });
  }

  private showGoals() {
    const s = this.s!;
    const m = this.modal(focusHtml(s), 'goals-card');
    m.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) => {
      b.onclick = () => {
        if (!b.classList.contains('open')) return;
        this.act(() => { startFocus(s, s.player, b.dataset.focus!); });
        play('buy');
        this.showGoals();
      };
    });
    m.querySelectorAll<HTMLButtonElement>('[data-course]').forEach((b) => {
      b.onclick = () => {
        if (!b.classList.contains('open')) return;
        this.act(() => { setCourse(s, s.player, b.dataset.course!); });
        play('buy');
        this.showGoals();
      };
    });
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
      <div class="win-top"><h3>Улучшения</h3><span class="muted">Казна: <b>${fmt(s.money)}</b></span>
        <button class="icon-btn" data-m="close" aria-label="Закрыть">${icon('close', 16)}</button></div>
      <p class="muted">Покупаются за деньги и действуют сразу и навсегда.</p>
      <div class="upg-grid">${cols}</div>`, 'upgrades');
    m.querySelectorAll<HTMLButtonElement>('[data-upg]').forEach((b) => {
      b.onclick = () => {
        const u = UPGRADES.find((x) => x.id === b.dataset.upg)!;
        const why = upgradeBlocked(s, u);
        if (why) return this.toast(why, why === 'Изучено' ? 'info' : 'bad');
        this.act(() => { buyUpgrade(s, u.id); });
        this.toast(`Изучено: ${u.name}`, 'good');
        play('buy');
        this.showUpgrades();
      };
    });
  }

  /** A random event. The player has to pick an option to go on. */
  private showEvent(after?: () => void) {
    const s = this.s!;
    const ev = s.pendingEvent ? EVENT[s.pendingEvent] : null;
    if (!ev) return after?.();
    setTimeout(() => play('event'), 250);
    const options = ev.options.map((o, i) => {
      const fxs = o.effects(s);
      return `
        <button class="event-opt" data-opt="${i}"><b>${o.label}</b>
          ${fxs.length ? fxs.map((e) => `<span class="${e.good ? 'up' : 'down'}">${e.text}</span>`).join('') : '<span class="muted">Ничего не изменится</span>'}
        </button>`;
    }).join('');
    const m = this.modal(`
      <div class="event-head"><span class="event-icon">${icon(ev.icon, 26)}</span><div class="event-meta">Событие · ход ${s.turn}</div></div>
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

  private showEnd() {
    const s = this.s!;
    if ($('#modal').classList.contains('open') && $('#modal').querySelector('.end-card')) return;
    gameplay(false);
    play(s.won ? 'victory' : 'defeat');
    const m = this.modal(endHtml(s), 'end-card');
    m.querySelector<HTMLButtonElement>('[data-m="new"]')!.onclick = () => {
      clearSave();
      this.closeModal();
      this.showStart();
    };
  }
}

