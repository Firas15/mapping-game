import { PARTIES, PARTY_ORDER, type PartyId } from '../data/countries';
import type { Parties } from '../game/state';

/** Donut chart of party popularity with the ruling party in the middle. */
export function politicsBlock(p: Parties, ruling: PartyId, gov: 'republic' | 'monarchy', note = ''): string {
  const r = 34;
  const len = 2 * Math.PI * r;
  let offset = 0;
  const arcs = PARTY_ORDER.map((id, i) => {
    const part = (p[i] / 100) * len;
    const arc = `<circle r="${r}" cx="44" cy="44" fill="none" stroke="${PARTIES[id].color}" stroke-width="14"
      stroke-dasharray="${part} ${len - part}" stroke-dashoffset="${-offset}" transform="rotate(-90 44 44)"/>`;
    offset += part;
    return arc;
  }).join('');
  const legend = PARTY_ORDER.map((id, i) => `
    <li class="${id === ruling ? 'ruling' : ''}">
      <span class="dot" style="background:${PARTIES[id].color}"></span>
      <span class="pname">${PARTIES[id].name}</span>
      <span class="pval">${p[i]}%</span>
    </li>`).join('');
  return `
    <div class="politics">
      <div class="politics-head">
        <span>Внутренняя политика</span>
        <span class="muted">${gov === 'monarchy' ? 'Конституционная монархия' : 'Республика'}</span>
      </div>
      <div class="politics-body">
        <svg viewBox="0 0 88 88" class="donut" role="img" aria-label="Популярность партий">${arcs}
          <text x="44" y="41" text-anchor="middle" class="donut-k">У власти</text>
          <text x="44" y="55" text-anchor="middle" class="donut-v" fill="${PARTIES[ruling].color}">${p[PARTY_ORDER.indexOf(ruling)]}%</text>
        </svg>
        <ul class="legend">${legend}</ul>
      </div>
      <div class="ruling-effect"><b style="color:${PARTIES[ruling].color}">${PARTIES[ruling].name}:</b> ${PARTIES[ruling].effect}</div>
      ${note ? `<div class="muted small">${note}</div>` : ''}
    </div>`;
}
