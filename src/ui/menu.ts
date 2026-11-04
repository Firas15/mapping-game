// Main menu over a living map: countries quietly trade regions in the background.
import { COUNTRY, COUNTRIES, flagUrl } from '../data/countries';
import { REGIONS } from '../data/regions';
import { SEAS } from '../data/seas';
import { land } from '../game/graph';
import type { GameState } from '../game/state';
import { icon } from './icons';

export interface MenuActions {
  saved: GameState | null;
  onContinue: () => void;
  onNew: () => void;
  onHowTo: () => void;
}

export interface MenuMap {
  update: (owner: Record<string, string>) => void;
  flash: (ids: string[]) => void;
  drift: (lonLat: [number, number], k: number, duration: number) => void;
}

/** Slow tour of the map while the menu is open. */
const TOUR: [number, number, number][] = [[14, 50, 2.1], [4, 46, 2.3], [26, 52, 2.0], [20, 43, 2.4], [32, 56, 1.8], [10, 56, 2.2]];

export class Menu {
  private el: HTMLElement;
  private timers: number[] = [];
  private owner: Record<string, string> = {};

  constructor(el: HTMLElement) {
    this.el = el;
  }

  open(a: MenuActions, map: MenuMap) {
    document.body.dataset.mode = 'menu';
    const s = a.saved;
    this.el.innerHTML = `
      <div class="mn-box">
        <div class="mn-kicker">Пошаговая стратегия</div>
        <h1 class="mn-title">Mapping</h1>
        <p class="mn-lead">Выберите страну и объедините Европу — от Лиссабона до Урала.</p>
        <div class="mn-actions">
          ${s ? `<button class="mn-btn main" data-m="continue">
              <img src="${flagUrl(s.player)}" alt="" class="flag-s">
              <span><b>Продолжить</b><small>${COUNTRY[s.player].name} · ход ${s.turn}</small></span>${icon('next', 18)}</button>` : ''}
          <button class="mn-btn ${s ? '' : 'main'}" data-m="new">${icon('flag', 18)}<span><b>Новая игра</b><small>41 страна на выбор</small></span>${icon('next', 18)}</button>
          <button class="mn-btn" data-m="howto">${icon('book', 18)}<span><b>Как играть</b><small>11 коротких уроков</small></span>${icon('next', 18)}</button>
        </div>
        <div class="mn-facts"><span><b>${COUNTRIES.length}</b> стран</span><span><b>${REGIONS.length}</b> областей</span><span><b>${SEAS.length}</b> морей</span></div>
      </div>`;
    this.el.classList.add('open');
    this.el.querySelector<HTMLButtonElement>('[data-m="continue"]')?.addEventListener('click', () => { this.close(); a.onContinue(); });
    this.el.querySelector<HTMLButtonElement>('[data-m="new"]')!.addEventListener('click', () => { this.close(); a.onNew(); });
    this.el.querySelector<HTMLButtonElement>('[data-m="howto"]')!.addEventListener('click', () => a.onHowTo());
    this.el.querySelector<HTMLButtonElement>('.mn-btn.main')?.focus();
    this.animate(map);
  }

  close() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.el.classList.remove('open');
  }

  get isOpen() { return this.el.classList.contains('open'); }

  private animate(map: MenuMap) {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.owner = Object.fromEntries(REGIONS.map((r) => [r.id, r.c]));
    map.update(this.owner);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let stop = 0;
    const tour = () => { const [x, y, k] = TOUR[stop++ % TOUR.length]; map.drift([x, y], k, 9000); };
    tour();
    this.timers.push(window.setInterval(tour, 9500));
    // every so often a country takes a region from a neighbour; after a while the map resets
    let moves = 0;
    this.timers.push(window.setInterval(() => {
      if (++moves > 40) {
        moves = 0;
        this.owner = Object.fromEntries(REGIONS.map((r) => [r.id, r.c]));
        map.update(this.owner);
        return;
      }
      const r = REGIONS[Math.floor(Math.random() * REGIONS.length)].id;
      const nb = [...(land.get(r) ?? [])].filter((m) => this.owner[m] !== this.owner[r]);
      if (!nb.length) return;
      this.owner[r] = this.owner[nb[Math.floor(Math.random() * nb.length)]];
      map.update(this.owner);
      map.flash([r]);
    }, 1400));
  }
}
