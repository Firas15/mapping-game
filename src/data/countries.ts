import type { TraitId } from './traits';

export type PartyId = 'dem' | 'con' | 'soc' | 'nat';

export interface CountryDef {
  code: string;
  name: string;
  /** Map colour. Neighbours are picked to contrast. */
  color: string;
  /** Starting army strength. */
  army: number;
  /** Money per turn the territory brings. */
  eco: number;
  trait: TraitId;
  gov: 'republic' | 'monarchy';
  /** Party popularity in %, order: dem, con, soc, nat. */
  parties: [number, number, number, number];
  /** Where to put the label, if the centroid is a bad spot. */
  label?: [number, number];
}

const c = (
  code: string, name: string, color: string, army: number, eco: number,
  trait: TraitId, gov: CountryDef['gov'], parties: CountryDef['parties'], label?: [number, number],
): CountryDef => ({ code, name, color, army, eco, trait, gov, parties, label });

export const COUNTRIES: CountryDef[] = [
  c('RU', 'Россия', '#a33434', 90, 60, 'frost', 'republic', [10, 55, 15, 20], [44, 57.5]),
  c('DE', 'Германия', '#5c6470', 75, 95, 'industry', 'republic', [35, 30, 25, 10]),
  c('FR', 'Франция', '#3d6fd1', 65, 85, 'legion', 'republic', [35, 20, 25, 20], [2.4, 46.8]),
  c('GB', 'Великобритания', '#c8475a', 55, 90, 'navy', 'monarchy', [25, 35, 30, 10], [-1.6, 52.6]),
  c('IT', 'Италия', '#4f9a4a', 50, 70, 'diplomacy', 'republic', [25, 30, 20, 25], [12.6, 42.8]),
  c('TR', 'Турция', '#b5813f', 60, 55, 'straits', 'republic', [20, 45, 10, 25], [34, 39.2]),
  c('ES', 'Испания', '#d9a62e', 45, 60, 'tourism', 'monarchy', [20, 30, 35, 15], [-3.6, 40.2]),
  c('PL', 'Польша', '#d77aa0', 50, 50, 'hussars', 'republic', [35, 35, 15, 15], [19.3, 52.1]),
  c('UA', 'Украина', '#4f86c6', 45, 35, 'blackearth', 'republic', [45, 20, 15, 20], [31.5, 49.2]),
  c('NL', 'Нидерланды', '#e07b39', 20, 60, 'traders', 'monarchy', [35, 30, 20, 15]),
  c('SE', 'Швеция', '#3f7fc4', 35, 55, 'steel', 'monarchy', [30, 25, 35, 10], [15.2, 62.6]),
  c('CH', 'Швейцария', '#b83a3a', 25, 55, 'neutral', 'republic', [30, 35, 20, 15]),
  c('BE', 'Бельгия', '#e3c74a', 15, 45, 'heart', 'monarchy', [30, 30, 30, 10]),
  c('NO', 'Норвегия', '#3f8f8a', 20, 45, 'oil', 'monarchy', [30, 25, 40, 5], [9.5, 61.6]),
  c('AT', 'Австрия', '#d8d2c2', 25, 40, 'habsburg', 'republic', [25, 35, 25, 15]),
  c('IE', 'Ирландия', '#58b368', 10, 40, 'tiger', 'republic', [40, 30, 25, 5]),
  c('DK', 'Дания', '#d0566a', 15, 35, 'vikings', 'monarchy', [35, 25, 35, 5], [9.2, 56.1]),
  c('FI', 'Финляндия', '#c9d6e6', 25, 30, 'mannerheim', 'republic', [30, 35, 25, 10], [26.4, 63.2]),
  c('CZ', 'Чехия', '#4aa6a6', 20, 30, 'skoda', 'republic', [35, 35, 20, 10]),
  c('PT', 'Португалия', '#2f8f5b', 15, 25, 'seafarers', 'republic', [25, 30, 35, 10]),
  c('RO', 'Румыния', '#e0c04a', 25, 25, 'carpathians', 'republic', [30, 30, 25, 15]),
  c('GR', 'Греция', '#6fb0e8', 25, 25, 'cradle', 'republic', [30, 35, 25, 10], [22, 39.6]),
  c('HU', 'Венгрия', '#8a9a3a', 15, 20, 'cavalry', 'republic', [20, 50, 10, 20]),
  c('BY', 'Беларусь', '#a0b05a', 30, 15, 'partisans', 'republic', [10, 60, 20, 10]),
  c('RS', 'Сербия', '#9a4a6a', 20, 12, 'resilience', 'republic', [25, 40, 15, 20]),
  c('SK', 'Словакия', '#8f5fb5', 10, 15, 'tatras', 'republic', [30, 25, 30, 15]),
  c('BG', 'Болгария', '#4f8f6f', 15, 12, 'roses', 'republic', [30, 30, 25, 15]),
  c('HR', 'Хорватия', '#3a5fa8', 10, 15, 'adriatic', 'republic', [30, 40, 20, 10], [15.6, 45.7]),
  c('EE', 'Эстония', '#3a8ac9', 6, 12, 'digital', 'republic', [45, 30, 15, 10]),
  c('LT', 'Литва', '#d8b04a', 10, 10, 'duchy', 'republic', [35, 35, 20, 10]),
  c('LV', 'Латвия', '#b07ad0', 8, 9, 'amber', 'republic', [35, 30, 20, 15]),
  c('SI', 'Словения', '#e08ab0', 5, 12, 'alps', 'republic', [40, 30, 25, 5]),
  c('BA', 'Босния и Герцеговина', '#e0b03a', 8, 6, 'mountains', 'republic', [30, 30, 20, 20]),
  c('AL', 'Албания', '#6b2a2a', 6, 4, 'bunkers', 'republic', [35, 35, 25, 5]),
  c('MK', 'Северная Македония', '#f0a040', 5, 4, 'crossroads', 'republic', [35, 30, 25, 10]),
  c('MD', 'Молдова', '#c97a4a', 5, 3, 'vineyards', 'republic', [40, 20, 30, 10]),
  c('CY', 'Кипр', '#e8a0a0', 5, 8, 'island', 'republic', [35, 35, 25, 5]),
  c('LU', 'Люксембург', '#6fc3d9', 5, 25, 'bank', 'monarchy', [40, 35, 20, 5]),
  c('ME', 'Черногория', '#c96b3a', 3, 3, 'blackmountain', 'republic', [40, 30, 20, 10]),
  c('XK', 'Косово', '#5aa0e0', 3, 2, 'young', 'republic', [45, 30, 15, 10]),
  c('IS', 'Исландия', '#6a8fd6', 3, 8, 'volcano', 'republic', [35, 35, 25, 5], [-18.6, 64.9]),
];

export const COUNTRY: Record<string, CountryDef> = Object.fromEntries(COUNTRIES.map((x) => [x.code, x]));

// Sea crossings: lets islands take part and gives the map a few naval fronts.
export const SEA_LINKS: [string, string][] = [
  ['GB', 'FR'], ['GB', 'BE'], ['GB', 'NL'], ['GB', 'NO'], ['GB', 'IS'], ['GB', 'DK'],
  ['IS', 'NO'], ['DK', 'SE'], ['DK', 'NO'], ['SE', 'FI'], ['SE', 'EE'], ['FI', 'EE'],
  ['SE', 'LV'], ['IT', 'AL'], ['IT', 'GR'], ['IT', 'HR'], ['GR', 'CY'], ['TR', 'CY'],
  ['TR', 'UA'], ['TR', 'RU'], ['ES', 'IT'], ['IE', 'FR'], ['SE', 'PL'], ['LT', 'SE'],
];

export const PARTIES: Record<PartyId, { name: string; color: string; effect: string }> = {
  dem: { name: 'Демократы', color: '#5b9bf0', effect: '+2 влияния за ход, но войны бьют по стабильности' },
  con: { name: 'Консерваторы', color: '#a68bf0', effect: '+1 стабильности за ход' },
  soc: { name: 'Социалисты', color: '#f07a6b', effect: '+10% к доходу' },
  nat: { name: 'Националисты', color: '#c9a25a', effect: '+15% к атаке, −1 влияния за ход' },
};
export const PARTY_ORDER: PartyId[] = ['dem', 'con', 'soc', 'nat'];

export const flagUrl = (code: string) => `${import.meta.env.BASE_URL}flags/${code.toLowerCase()}.svg`;
