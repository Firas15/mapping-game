import { icon } from './icons';

interface Step {
  /** element to highlight; none = centred card */
  target?: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  {
    title: 'Добро пожаловать в Mapping',
    text: 'Ваша цель — объединить под своим флагом всю Европу. Один ход — это один сезон. Покажу за минуту, как всё устроено.',
  },
  {
    target: '#map-host',
    title: 'Карта',
    text: 'Тяните карту, чтобы двигать её. Колесо мыши или щипок меняют масштаб. Нажмите на страну, чтобы узнать о ней всё.',
  },
  {
    target: '#hud .resources',
    title: 'Ваши ресурсы',
    text: '<b>Деньги</b> нужны на войска и решения. <b>Армия</b> — ваша сила в бою. <b>Стабильность</b> влияет на доход: чем она ниже, тем меньше денег. <b>Влияние</b> позволяет присоединять страны без войны.',
  },
  {
    target: '#panel',
    title: 'Карточка страны',
    text: 'Здесь армия, доход, особенность страны и её внутренняя политика. Партия у власти даёт свой бонус, а выборы проходят раз в 8 ходов.',
  },
  {
    target: '#map-host',
    title: 'Война и дипломатия',
    text: 'Соседи в белую полоску — ваши цели. Выберите такую страну, чтобы атаковать её или присоединить за влияние. Пунктир на море — морские пути. За ход можно провести 2 атаки.',
  },
  {
    target: '#decisions .cards',
    title: 'Решения',
    text: 'Каждый ход выпадают 3 решения, принять можно одно. Зелёным — что получите, красным — чем заплатите.',
  },
  {
    target: '#end-turn',
    title: 'Конец хода',
    text: 'Когда всё сделали, завершите ход: придёт доход, армия соседей восстановится, выпадут новые решения. Удачи!',
  },
];

const DONE_KEY = 'mapping-tutorial-done';

export const tutorialDone = () => {
  try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return false; }
};
const markDone = () => {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* ignore */ }
};

export class Tutorial {
  private i = 0;
  private root: HTMLElement;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
    if (e.key === 'ArrowRight') this.go(1);
    if (e.key === 'ArrowLeft') this.go(-1);
  };
  private onResize = () => this.render();

  constructor(host: HTMLElement) {
    this.root = host;
  }

  start() {
    this.i = 0;
    this.root.classList.add('open');
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
    this.render();
  }

  close() {
    this.root.classList.remove('open');
    this.root.innerHTML = '';
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    markDone();
  }

  private go(d: number) {
    const n = this.i + d;
    if (n >= STEPS.length) return this.close();
    if (n < 0) return;
    this.i = n;
    this.render();
  }

  private render() {
    const step = STEPS[this.i];
    const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    const r = el?.getBoundingClientRect();
    const pad = 6;
    const last = this.i === STEPS.length - 1;
    const dots = STEPS.map((_, k) => `<span class="${k === this.i ? 'on' : ''}"></span>`).join('');
    this.root.innerHTML = `
      ${r ? `<div class="spot" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px"></div>`
        : '<div class="spot-full"></div>'}
      <div class="tut-card" role="dialog" aria-label="${step.title}">
        <div class="tut-top"><span class="tut-step">Шаг ${this.i + 1} из ${STEPS.length}</span>
          <button class="icon-btn" data-t="skip" aria-label="Пропустить обучение">${icon('close', 16)}</button></div>
        <h3>${step.title}</h3>
        <p>${step.text}</p>
        <div class="tut-foot">
          <div class="tut-dots">${dots}</div>
          <button class="btn ghost" data-t="skip">Пропустить</button>
          ${this.i > 0 ? '<button class="btn ghost" data-t="back">Назад</button>' : ''}
          <button class="btn primary" data-t="next">${last ? 'Играть' : 'Далее'}</button>
        </div>
      </div>`;
    const card = this.root.querySelector<HTMLElement>('.tut-card')!;
    this.place(card, r);
    this.root.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => {
      b.onclick = () => {
        const t = b.dataset.t;
        if (t === 'skip') this.close();
        else this.go(t === 'back' ? -1 : 1);
      };
    });
    card.querySelector<HTMLButtonElement>('[data-t="next"]')?.focus();
  }

  /** Puts the card next to the highlighted element, wherever it has room. */
  private place(card: HTMLElement, r?: DOMRect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = Math.min(360, vw - 32);
    card.style.width = cw + 'px';
    const ch = card.offsetHeight;
    let x = (vw - cw) / 2;
    let y = (vh - ch) / 2;
    if (r) {
      const big = r.width > vw * 0.6 && r.height > vh * 0.5;
      if (big) { x = vw - cw - 24; y = vh - ch - 120; }
      else if (r.bottom + 16 + ch < vh) { y = r.bottom + 16; x = r.left + r.width / 2 - cw / 2; }
      else if (r.top - 16 - ch > 0) { y = r.top - 16 - ch; x = r.left + r.width / 2 - cw / 2; }
      else if (r.left - 16 - cw > 0) { x = r.left - 16 - cw; y = r.top + r.height / 2 - ch / 2; }
      else { x = r.right + 16; y = r.top; }
    }
    card.style.left = Math.max(16, Math.min(vw - cw - 16, x)) + 'px';
    card.style.top = Math.max(16, Math.min(vh - ch - 16, y)) + 'px';
  }
}
