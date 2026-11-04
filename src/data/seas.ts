/** Sea zones. Fleets stand in them; a sea crossing passes through one. */
export interface SeaDef {
  id: string;
  name: string;
  /** label and fleet spot, lon/lat */
  center: [number, number];
  /** zones a fleet can sail to in one turn */
  nb: string[];
}

export const SEAS: SeaDef[] = [
  { id: 'NATL', name: 'Северная Атлантика', center: [-19, 61], nb: ['NORW', 'ATL'] },
  { id: 'NORW', name: 'Норвежское море', center: [4, 67.5], nb: ['NATL', 'NORTH', 'BAR'] },
  { id: 'BAR', name: 'Баренцево море', center: [40, 72], nb: ['NORW', 'WHITE'] },
  { id: 'WHITE', name: 'Белое море', center: [38.5, 65.8], nb: ['BAR'] },
  { id: 'NORTH', name: 'Северное море', center: [3.5, 56], nb: ['NORW', 'CHAN', 'BALT'] },
  { id: 'CHAN', name: 'Ла-Манш', center: [-3, 50], nb: ['NORTH', 'ATL'] },
  { id: 'ATL', name: 'Атлантика', center: [-8, 45.5], nb: ['NATL', 'CHAN', 'WMED'] },
  { id: 'BALT', name: 'Балтийское море', center: [18.5, 56.5], nb: ['NORTH', 'BOTH', 'FIN'] },
  { id: 'BOTH', name: 'Ботнический залив', center: [20.5, 62.5], nb: ['BALT'] },
  { id: 'FIN', name: 'Финский залив', center: [26.5, 59.8], nb: ['BALT'] },
  { id: 'WMED', name: 'Западное Средиземноморье', center: [4.5, 39.5], nb: ['ATL', 'TYRR', 'CMED'] },
  { id: 'TYRR', name: 'Тирренское море', center: [12, 40], nb: ['WMED', 'CMED'] },
  { id: 'ADR', name: 'Адриатическое море', center: [15.5, 43], nb: ['CMED'] },
  { id: 'CMED', name: 'Ионическое море', center: [18.5, 37], nb: ['WMED', 'TYRR', 'ADR', 'AEG', 'EMED'] },
  { id: 'AEG', name: 'Эгейское море', center: [25, 38.5], nb: ['CMED', 'EMED', 'BLACK'] },
  { id: 'EMED', name: 'Восточное Средиземноморье', center: [31, 34.3], nb: ['AEG', 'CMED'] },
  { id: 'BLACK', name: 'Чёрное море', center: [34, 43.5], nb: ['AEG'] },
  { id: 'CASP', name: 'Каспийское море', center: [50.5, 42.5], nb: [] },
];

export const SEA: Record<string, SeaDef> = Object.fromEntries(SEAS.map((s) => [s.id, s]));
