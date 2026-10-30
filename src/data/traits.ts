export interface TraitEffect {
  incomeMul?: number;
  flatIncome?: number;
  armyCostMul?: number;
  attackMul?: number;
  defenseMul?: number;
  winterDefenseMul?: number;
  influence?: number;
  stability?: number;
  /** Sea crossings without the usual penalty. */
  seaMaster?: boolean;
  /** Stability the attacker loses for attacking this country. */
  aggressorStability?: number;
}

export interface Trait {
  name: string;
  text: string;
  effect: TraitEffect;
}

const t = (name: string, text: string, effect: TraitEffect): Trait => ({ name, text, effect });

export const TRAITS = {
  frost: t('Генерал Мороз', '+60% к обороне зимой', { winterDefenseMul: 0.6 }),
  industry: t('Индустрия', 'Войска на 25% дешевле', { armyCostMul: -0.25 }),
  legion: t('Иностранный легион', '+15% к атаке', { attackMul: 0.15 }),
  navy: t('Владычица морей', 'Атаки через море без штрафа', { seaMaster: true }),
  diplomacy: t('Дипломатия', '+2 влияния за ход', { influence: 2 }),
  straits: t('Проливы', '+30% к обороне', { defenseMul: 0.3 }),
  tourism: t('Туризм', '+15% к доходу', { incomeMul: 0.15 }),
  hussars: t('Крылатые гусары', '+20% к атаке', { attackMul: 0.2 }),
  blackearth: t('Чернозём', '+20% к доходу', { incomeMul: 0.2 }),
  traders: t('Торговцы', '+25% к доходу', { incomeMul: 0.25 }),
  steel: t('Шведская сталь', 'Войска на 15% дешевле', { armyCostMul: -0.15 }),
  neutral: t('Нейтралитет', 'Напавший теряет 15 стабильности', { aggressorStability: 15 }),
  heart: t('Сердце Европы', '+2 влияния за ход', { influence: 2 }),
  oil: t('Нефть Севера', '+25 денег за ход', { flatIncome: 25 }),
  habsburg: t('Наследие Габсбургов', '+2 влияния за ход', { influence: 2 }),
  tiger: t('Кельтский тигр', '+20% к доходу', { incomeMul: 0.2 }),
  vikings: t('Викинги', 'Атаки через море без штрафа', { seaMaster: true }),
  mannerheim: t('Линия Маннергейма', '+50% к обороне', { defenseMul: 0.5 }),
  skoda: t('Заводы «Шкода»', 'Войска на 15% дешевле', { armyCostMul: -0.15 }),
  seafarers: t('Мореплаватели', 'Атаки через море без штрафа', { seaMaster: true }),
  carpathians: t('Карпаты', '+25% к обороне', { defenseMul: 0.25 }),
  cradle: t('Колыбель демократии', '+1 стабильности за ход', { stability: 1 }),
  cavalry: t('Мадьярская конница', '+15% к атаке', { attackMul: 0.15 }),
  partisans: t('Партизаны', '+30% к обороне', { defenseMul: 0.3 }),
  resilience: t('Стойкость', '+1 стабильности за ход', { stability: 1 }),
  tatras: t('Татры', '+25% к обороне', { defenseMul: 0.25 }),
  roses: t('Розовое масло', '+15% к доходу', { incomeMul: 0.15 }),
  adriatic: t('Адриатика', '+15% к доходу', { incomeMul: 0.15 }),
  digital: t('Цифровое государство', '+20% к доходу', { incomeMul: 0.2 }),
  duchy: t('Великое княжество', '+10% к атаке', { attackMul: 0.1 }),
  amber: t('Янтарный берег', '+15% к доходу', { incomeMul: 0.15 }),
  alps: t('Альпы', '+30% к обороне', { defenseMul: 0.3 }),
  mountains: t('Горы', '+30% к обороне', { defenseMul: 0.3 }),
  bunkers: t('Бункеры', '+40% к обороне', { defenseMul: 0.4 }),
  crossroads: t('Перекрёсток Балкан', '+2 влияния за ход', { influence: 2 }),
  vineyards: t('Виноградники', '+15% к доходу', { incomeMul: 0.15 }),
  island: t('Остров', '+30% к обороне', { defenseMul: 0.3 }),
  bank: t('Банк Европы', '+30% к доходу', { incomeMul: 0.3 }),
  blackmountain: t('Чёрные горы', '+40% к обороне', { defenseMul: 0.4 }),
  young: t('Молодая страна', '+2 влияния за ход', { influence: 2 }),
  volcano: t('Вулканы и льды', '+40% к обороне', { defenseMul: 0.4 }),
} satisfies Record<string, Trait>;

export type TraitId = keyof typeof TRAITS;
