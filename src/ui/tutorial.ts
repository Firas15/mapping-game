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
    text: 'Ваша цель — объединить Европу под своим флагом. Один ход — один сезон. Покажу за минуту, как всё устроено.',
  },
  {
    target: '#map-host',
    title: 'Карта и войска',
    text: 'Тяните карту и крутите колесо, чтобы двигать и приближать. Фишки на карте — это <b>армии</b>, <b>флоты</b> и <b>авиация</b>. Нажмите на свою армию: <b>зелёная стрелка</b> — перейти, <b>процент</b> — атаковать. Все ваши армии рядом атакуют вместе.',
  },
  {
    target: '#map-host',
    title: 'Море и небо',
    text: 'Флот стоит в море и не пускает через него вражеский десант. Авиация бомбит вражеские армии и флоты в двух областях от базы, но землю не берёт.',
  },
  {
    target: '#map-host',
    title: 'Столицы',
    text: '<b>Звезда</b> — столица. Если её взяли, правительство переезжает в другую ключевую область: крупный центр или захваченную столицу. Страна капитулирует, когда 3 хода у неё нет ни одной ключевой области.',
  },
  {
    target: '#hud .resources',
    title: 'Ресурсы',
    text: '<b>Деньги</b> — на войска и решения. <b>Армия</b> — все ваши армии вместе, пополняется призывом. <b>Стабильность</b> влияет на доход и на восстания. <b>Влияние</b> — на дружбу, союзы и мирное присоединение.',
  },
  {
    target: '#panel',
    title: 'Карточка области',
    text: 'Здесь видно, что даёт область, и можно набрать войска. У чужой страны — война, мир, союз и отношения. Занятая чужая земля даёт половину и копит недовольство, пока через 12 ходов не станет вашей.',
  },
  {
    target: '#modes',
    title: 'Режимы карты',
    text: 'Переключайте карту: ресурсы областей, отношения с вами, угрозы и недовольство.',
  },
  {
    target: '#goals',
    title: 'Цели, улучшения, рейтинг',
    text: 'Выберите национальную цель — через несколько ходов она даст бонус навсегда. Рядом улучшения за деньги и рейтинг стран.',
  },
  {
    target: '#decisions .cards',
    title: 'Решения',
    text: 'Каждый ход выпадают 3 решения, принять можно одно.',
  },
  {
    target: '#end-turn',
    title: 'Конец хода',
    text: 'Завершите ход: придёт доход, соседи сделают свои ходы. Всё, что случилось, — в журнале слева внизу. Удачи!',
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
