import { geoArea, geoCentroid, geoConicConformal, geoGraticule10, geoPath, type GeoPath, type GeoProjection } from 'd3-geo';
import { select, type Selection } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import 'd3-transition';
import { feature, merge, neighbors } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { COUNTRY, flagUrl } from '../data/countries';
import { CAPITAL, REGION } from '../data/regions';
import { SEA, SEAS } from '../data/seas';
import type { Unit } from '../game/state';

const SHORT: Record<string, string> = { BA: 'Босния', MK: 'Македония', GB: 'Британия' };

type RegionFeature = Feature<MultiPolygon | Polygon, Record<string, unknown>> & { id: string };

/** What the selected unit can do, drawn as markers on the map. */
export interface Orders {
  moves: string[];
  attacks: { r: string; ch: number; war: boolean }[];
  strikes: string[];
  zones: string[];
}

export interface MapState {
  /** region -> owner country */
  owner: Record<string, string>;
  player: string | null;
  /** regions outlined as selected */
  selected: string[];
  allies?: Set<string>;
  /** current capital of each country */
  capitals?: Record<string, string | null>;
  units?: Unit[];
  selectedUnit?: number | null;
  orders?: Orders | null;
  /** map-mode colours, region -> colour; political colours when absent */
  fill?: Record<string, string> | null;
}

export interface MapEvents {
  region: (id: string | null) => void;
  unit: (id: number) => void;
  zone: (id: string) => void;
}

const UNIT_ICON: Record<string, string> = {
  // infantry: the crossed box of a military map symbol
  army: 'M-5,-3.5 h10 v7 h-10 Z M-5,-3.5 L5,3.5 M5,-3.5 L-5,3.5',
  air: 'M0,-6 L1.3,-1.5 L6,1 L6,2.4 L1.3,1.2 L1,4.2 L2.6,5.4 L2.6,6.3 L0,5.6 L-2.6,6.3 L-2.6,5.4 L-1,4.2 L-1.3,1.2 L-6,2.4 L-6,1 L-1.3,-1.5 Z',
  fleet: 'M-7,1 L7,1 L5,4.5 L-5,4.5 Z M-1,-5 L-1,1 M-1,-5 L4,-1 L-1,-1',
};

export class MapView {
  readonly el: SVGSVGElement;
  private host: HTMLElement;
  private on: MapEvents;
  private topo: Topology<{ land: GeometryCollection }>;
  private regions: RegionFeature[] = [];
  private context: RegionFeature[] = [];
  private byId = new Map<string, RegionFeature>();
  /** label point of each region, lon/lat */
  private anchorLL = new Map<string, [number, number]>();
  private seaLinks: { a: string; b: string; zone: string }[] = [];
  private proj: GeoProjection = geoConicConformal();
  private path: GeoPath = geoPath(this.proj);
  private zoomer: ZoomBehavior<SVGSVGElement, unknown>;
  private t: ZoomTransform = zoomIdentity;
  private w = 0;
  private h = 0;
  private state: MapState = { owner: {}, player: null, selected: [] };

  private root: Selection<SVGGElement, unknown, null, undefined>;
  private gGrid: Selection<SVGPathElement, unknown, null, undefined>;
  private gContext: Selection<SVGGElement, unknown, null, undefined>;
  private gRegions: Selection<SVGGElement, unknown, null, undefined>;
  private gTargets: Selection<SVGGElement, unknown, null, undefined>;
  private gNations: Selection<SVGGElement, unknown, null, undefined>;
  private gSeaNames: Selection<SVGGElement, unknown, null, undefined>;
  private gSea: Selection<SVGGElement, unknown, null, undefined>;
  private pBorder: Selection<SVGPathElement, unknown, null, undefined>;
  private pBorderHalo: Selection<SVGPathElement, unknown, null, undefined>;
  private pSelected: Selection<SVGPathElement, unknown, null, undefined>;
  private gCapitals: Selection<SVGGElement, unknown, null, undefined>;
  private gLabels: Selection<SVGGElement, unknown, null, undefined>;
  private gOrders: Selection<SVGGElement, unknown, null, undefined>;
  private gUnits: Selection<SVGGElement, unknown, null, undefined>;
  private gFx: Selection<SVGGElement, unknown, null, undefined>;

  constructor(host: HTMLElement, topo: unknown, on: MapEvents) {
    this.host = host;
    this.on = on;
    this.topo = topo as Topology<{ land: GeometryCollection }>;
    const fc = feature(this.topo, this.topo.objects.land) as unknown as { features: RegionFeature[] };
    for (const f of fc.features) {
      if (REGION[f.id]) {
        this.regions.push(f);
        this.byId.set(f.id, f);
        this.anchorLL.set(f.id, labelPoint(f));
      } else this.context.push(f);
    }

    this.el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.el.classList.add('map');
    host.append(this.el);
    const svg = select(this.el);

    const defs = svg.append('defs');
    const pat = defs.append('pattern').attr('id', 'hatch').attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 7).attr('height', 7).attr('patternTransform', 'rotate(45)');
    pat.append('rect').attr('width', 2.2).attr('height', 7).attr('fill', 'rgba(255,255,255,0.32)');

    svg.append('rect').attr('class', 'sea').attr('width', '100%').attr('height', '100%')
      .on('click', () => this.on.region(null));
    this.root = svg.append('g');
    this.gGrid = this.root.append('path').attr('class', 'graticule');
    this.gSeaNames = this.root.append('g').attr('class', 'sea-names');
    this.gContext = this.root.append('g').attr('class', 'context');
    this.gRegions = this.root.append('g').attr('class', 'countries');
    this.gTargets = this.root.append('g').attr('class', 'targets');
    this.gNations = this.root.append('g').attr('class', 'nations');
    this.gSea = this.root.append('g').attr('class', 'sea-links');
    this.pBorderHalo = this.root.append('path').attr('class', 'player-halo');
    this.pBorder = this.root.append('path').attr('class', 'player-border');
    this.pSelected = this.root.append('path').attr('class', 'selected');
    this.gCapitals = this.root.append('g').attr('class', 'capitals');
    this.gLabels = this.root.append('g').attr('class', 'labels');
    this.gOrders = this.root.append('g').attr('class', 'orders');
    this.gUnits = this.root.append('g').attr('class', 'units');
    this.gFx = this.root.append('g').attr('class', 'fx');

    this.zoomer = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 16])
      .clickDistance(5)
      .on('zoom', (e) => {
        this.t = e.transform;
        this.root.attr('transform', this.t.toString());
        this.placeOverlays();
      });
    svg.call(this.zoomer).on('dblclick.zoom', null);

    new ResizeObserver(() => this.layout()).observe(host);
    this.layout();
  }

  /** Pairs of regions that share a land border. */
  landPairs(): [string, string][] {
    const geoms = this.topo.objects.land.geometries;
    const nb = neighbors(geoms as never);
    const out: [string, string][] = [];
    geoms.forEach((g, i) => {
      const a = g.id as string;
      if (!REGION[a]) return;
      for (const j of nb[i]) {
        const b = geoms[j].id as string;
        if (REGION[b] && a < b) out.push([a, b]);
      }
    });
    return out;
  }

  centroid = (id: string): [number, number] => this.anchorLL.get(id)!;

  setSeaLinks(links: { a: string; b: string; zone: string }[]) {
    this.seaLinks = links;
    this.drawSeaLinks();
  }

  private layout() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.w = r.width;
    this.h = r.height;
    this.proj = geoConicConformal().parallels([43, 62]).rotate([-15, 0]).fitExtent(
      [[20, 20], [this.w - 20, this.h - 20]],
      { type: 'MultiPoint', coordinates: [[-24, 36], [58, 38], [-24, 66], [58, 66], [20, 71.5], [20, 34]] },
    );
    this.path = geoPath(this.proj);
    this.zoomer.translateExtent([[-this.w * 0.15, -this.h * 0.15], [this.w * 1.15, this.h * 1.15]]);
    this.gGrid.attr('d', this.path(geoGraticule10()));
    this.gContext.selectAll('path').data(this.context).join('path').attr('d', (f) => this.path(f));
    this.gRegions.selectAll<SVGPathElement, RegionFeature>('path').data(this.regions, (f) => f.id)
      .join('path')
      .attr('d', (f) => this.path(f))
      .on('click', (e: MouseEvent, f) => { e.stopPropagation(); this.on.region(f.id); });
    this.gSeaNames.selectAll<SVGGElement, (typeof SEAS)[number]>('g').data(SEAS.filter((z) => z.id !== 'CASP'), (z) => z.id)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'sea-name');
        g.append('text').attr('text-anchor', 'middle').attr('dy', 26).text((z) => z.name);
        return g;
      })
      .attr('data-x', (z) => this.proj(z.center)![0])
      .attr('data-y', (z) => this.proj(z.center)![1]);
    this.drawSeaLinks();
    this.update(this.state);
  }

  private xy(id: string): [number, number] {
    const z = SEA[id];
    return this.proj(z ? z.center : this.anchorLL.get(id)!) as [number, number];
  }

  private drawSeaLinks() {
    if (!this.w) return;
    this.gSea.selectAll('path').data(this.seaLinks).join('path').attr('d', ({ a, b }) => {
      const p = this.xy(a);
      const q = this.xy(b);
      const mx = (p[0] + q[0]) / 2;
      const my = (p[1] + q[1]) / 2;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      return `M${p[0]},${p[1]} Q${mx - dy * 0.15},${my + dx * 0.15} ${q[0]},${q[1]}`;
    });
  }

  update(s: MapState) {
    this.state = s;
    if (!this.w) return;
    const col = (id: string) => s.fill?.[id] ?? COUNTRY[s.owner[id] ?? REGION[id].c]?.color ?? '#555';
    this.gRegions.selectAll<SVGPathElement, RegionFeature>('path')
      .attr('fill', (f) => col(f.id))
      .classed('ally', (f) => !s.fill && !!s.allies?.has(s.owner[f.id]));

    const attackSet = new Set((s.orders?.attacks ?? []).map((a) => a.r));
    this.gTargets.selectAll<SVGPathElement, RegionFeature>('path')
      .data(this.regions.filter((f) => attackSet.has(f.id)), (f) => f.id)
      .join('path').attr('d', (f) => this.path(f));

    // thick borders between owners
    const owners = [...new Set(Object.values(s.owner))];
    const geoms = this.topo.objects.land.geometries;
    const shapes = owners.map((n) => ({
      n,
      d: this.path(merge(this.topo, geoms.filter((g) => s.owner[g.id as string] === n) as never)) ?? '',
    }));
    this.gNations.selectAll<SVGPathElement, { n: string; d: string }>('path').data(shapes, (x) => x.n)
      .join('path').attr('d', (x) => x.d);

    const mine = s.player ? shapes.find((x) => x.n === s.player)?.d ?? null : null;
    this.pBorder.attr('d', mine);
    this.pBorderHalo.attr('d', mine);
    const sel = s.selected.filter((id) => this.byId.has(id));
    this.pSelected.attr('d', sel.length
      ? this.path(merge(this.topo, geoms.filter((g) => sel.includes(g.id as string)) as never))
      : null);

    this.drawCapitals();
    this.drawLabels();
    this.drawOrders();
    this.drawUnits();
  }

  /** Red star on every capital; a moved government gets a hollow one. */
  private drawCapitals() {
    const s = this.state;
    const alive = new Set(Object.values(s.owner));
    const caps = Object.entries(s.capitals ?? CAPITAL).filter((e): e is [string, string] => !!e[1] && alive.has(e[0]) && s.owner[e[1]] === e[0]);
    const g = this.gCapitals.selectAll<SVGGElement, [string, string]>('g.cap').data(caps, (d) => d[0])
      .join((enter) => {
        const e = enter.append('g').attr('class', 'cap');
        e.append('circle').attr('r', 6.5);
        e.append('path').attr('d', starPath(4.2));
        e.append('title');
        return e;
      });
    g.each((d, i, nodes) => {
      const [c, region] = d;
      const node = nodes[i];
      const original = CAPITAL[c] === region;
      const pt = this.proj(original && REGION[region].point ? REGION[region].point! : this.anchorLL.get(region)!) as [number, number];
      node.dataset.x = String(pt[0]);
      node.dataset.y = String(pt[1]);
      node.classList.toggle('temp', !original);
      node.querySelector('title')!.textContent = original
        ? `Столица: ${COUNTRY[c].name}`
        : `Временная столица: ${COUNTRY[c].name}`;
    });
    this.placeOverlays();
  }

  /** One label per country, on its biggest region. */
  private drawLabels() {
    const s = this.state;
    const best = new Map<string, string>();
    for (const f of this.regions) {
      const n = s.owner[f.id] ?? REGION[f.id].c;
      const cur = best.get(n);
      if (!cur || REGION[f.id].area > REGION[cur].area) best.set(n, f.id);
    }
    const data = [...best].map(([n, region]) => ({ n, region }));
    const labels = this.gLabels.selectAll<SVGGElement, { n: string; region: string }>('g').data(data, (d) => d.n)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'label');
        g.append('image').attr('width', 16).attr('height', 12).attr('preserveAspectRatio', 'none');
        g.append('text').attr('dy', '0.35em');
        return g;
      });
    labels.each(function (d) {
      const img = this.querySelector('image')!;
      const text = this.querySelector('text')!;
      img.setAttribute('href', flagUrl(d.n));
      text.textContent = SHORT[d.n] ?? COUNTRY[d.n].name;
      const tw = text.getComputedTextLength() || COUNTRY[d.n].name.length * 7;
      const total = 21 + tw;
      img.setAttribute('x', String(-total / 2));
      img.setAttribute('y', '-6');
      text.setAttribute('x', String(-total / 2 + 21));
      (this as SVGGElement & { _w?: number })._w = total;
    });
    this.placeOverlays();
  }

  /** Where the selected unit can go: green dots to move, % badges to attack, crosshairs to bomb. */
  private drawOrders() {
    const o = this.state.orders;
    type Mark = { key: string; at: string; kind: 'move' | 'attack' | 'strike' | 'zone'; ch?: number; war?: boolean };
    const marks: Mark[] = !o ? [] : [
      ...o.moves.map((r) => ({ key: 'm' + r, at: r, kind: 'move' as const })),
      ...o.attacks.map((a) => ({ key: 'a' + a.r, at: a.r, kind: 'attack' as const, ch: a.ch, war: a.war })),
      ...o.strikes.map((r) => ({ key: 's' + r, at: r, kind: 'strike' as const })),
      ...o.zones.map((z) => ({ key: 'z' + z, at: z, kind: 'zone' as const })),
    ];
    const g = this.gOrders.selectAll<SVGGElement, Mark>('g.order').data(marks, (m) => m.key)
      .join((enter) => {
        const e = enter.append('g').attr('class', (m) => `order ${m.kind}`)
          .on('click', (ev: MouseEvent, m) => {
            ev.stopPropagation();
            if (SEA[m.at]) this.on.zone(m.at); else this.on.region(m.at);
          });
        e.each(function (m) {
          const sel = select(this);
          if (m.kind === 'move') {
            sel.append('circle').attr('r', 9);
            sel.append('path').attr('d', 'M-3,-4 L2,0 L-3,4');
          } else if (m.kind === 'attack') {
            sel.append('rect').attr('x', -19).attr('y', -10).attr('width', 38).attr('height', 20).attr('rx', 10);
            sel.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em');
          } else if (m.kind === 'strike') {
            sel.append('circle').attr('r', 10);
            sel.append('path').attr('d', 'M-6,0 H-2 M2,0 H6 M0,-6 V-2 M0,2 V6');
            sel.append('circle').attr('class', 'dot').attr('r', 1.6);
          } else {
            sel.append('circle').attr('r', 16);
            sel.append('path').attr('d', 'M-3,-4 L2,0 L-3,4');
          }
        });
        return e;
      });
    g.each((m, i, nodes) => {
      const n = nodes[i];
      const [x, y] = this.xy(m.at);
      n.dataset.x = String(x);
      n.dataset.y = String(y);
      if (m.kind === 'attack') {
        const tone = m.ch! >= 65 ? 'good' : m.ch! >= 40 ? 'mid' : 'bad';
        n.setAttribute('class', `order attack ${tone}${m.war ? '' : ' peace'}`);
        n.querySelector('text')!.textContent = `${m.ch}%`;
      }
    });
    this.placeOverlays();
  }

  /** Counters for armies and air wings at their region, fleets at their sea. */
  private drawUnits() {
    const s = this.state;
    const units = s.units ?? [];
    // spread several counters standing in one place side by side
    const slot = new Map<number, { dx: number; dy: number }>();
    const groups = new Map<string, Unit[]>();
    for (const u of units) {
      const key = u.at;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(u);
    }
    for (const [at, list] of groups) {
      list.sort((a, b) => Number(b.owner === s.player) - Number(a.owner === s.player) || a.type.localeCompare(b.type) || a.id - b.id);
      const w = 38;
      list.forEach((u, i) => slot.set(u.id, { dx: (i - (list.length - 1) / 2) * w, dy: SEA[at] ? 0 : -22 }));
    }

    const g = this.gUnits.selectAll<SVGGElement, Unit>('g.unit').data(units, (u) => String(u.id))
      .join((enter) => {
        const e = enter.append('g').attr('class', 'unit')
          .on('click', (ev: MouseEvent, u) => { ev.stopPropagation(); this.on.unit(u.id); });
        const body = e.append('g').attr('class', 'body');
        body.append('rect').attr('class', 'halo').attr('x', -20).attr('y', -12).attr('width', 40).attr('height', 24).attr('rx', 7);
        body.append('rect').attr('class', 'plate').attr('x', -17).attr('y', -10).attr('width', 34).attr('height', 20).attr('rx', 5);
        body.append('path').attr('class', 'glyph').attr('transform', 'translate(-8,0)');
        body.append('text').attr('class', 'num').attr('x', 6).attr('dy', '0.36em').attr('text-anchor', 'middle');
        return e;
      });
    g.each((u, i, nodes) => {
      const n = nodes[i];
      const [x, y] = this.xy(u.at);
      const sl = slot.get(u.id)!;
      n.dataset.x = String(x);
      n.dataset.y = String(y);
      n.dataset.dx = String(sl.dx);
      n.dataset.dy = String(sl.dy);
      n.setAttribute('class', `unit ${u.type}${u.owner === s.player ? ' mine' : ''}${u.acted ? ' acted' : ''}${s.selectedUnit === u.id ? ' sel' : ''}`);
      const plate = n.querySelector<SVGRectElement>('.plate')!;
      plate.style.fill = COUNTRY[u.owner]?.color ?? '#666';
      n.querySelector('.glyph')!.setAttribute('d', UNIT_ICON[u.type]);
      n.querySelector('.num')!.textContent = String(u.str);
      let title = n.querySelector<SVGTitleElement>('title');
      if (!title) { title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); n.append(title); }
      title.textContent = `${COUNTRY[u.owner].name}: ${{ army: 'армия', fleet: 'флот', air: 'авиакрыло' }[u.type]}, сила ${u.str}`;
    });
    this.placeOverlays(true);
  }

  /** Overlays keep their screen size; labels hide where they don't fit. */
  private placeOverlays(animateUnits = false) {
    const k = this.t.k;
    const place = (sel: Selection<SVGGElement, unknown, SVGGElement, unknown>, dy = 0) =>
      sel.each((_, i, nodes) => {
        const n = nodes[i];
        n.setAttribute('transform', `translate(${n.dataset.x},${Number(n.dataset.y) + dy / k}) scale(${1 / k})`);
      });
    place(this.gCapitals.selectAll<SVGGElement, unknown>('g.cap'));
    place(this.gOrders.selectAll<SVGGElement, unknown>('g.order'));
    place(this.gSeaNames.selectAll<SVGGElement, unknown>('g.sea-name'));
    this.gSeaNames.style('display', k >= 1.7 ? 'inline' : 'none');

    const units = this.gUnits.selectAll<SVGGElement, Unit>('g.unit');
    units.each((_, i, nodes) => {
      const n = nodes[i];
      const tf = `translate(${Number(n.dataset.x) + Number(n.dataset.dx) / k},${Number(n.dataset.y) + Number(n.dataset.dy) / k}) scale(${1 / k})`;
      if (animateUnits && n.getAttribute('transform')) select(n).transition().duration(450).attr('transform', tf);
      else n.setAttribute('transform', tf);
    });
    // far away, only the player's own counters are shown
    this.gUnits.classed('far', k < 1.9);

    this.gLabels.selectAll<SVGGElement, { n: string; region: string }>('g').each((d, i, nodes) => {
      const node = nodes[i] as SVGGElement & { _w?: number };
      const f = this.byId.get(d.region)!;
      const a = this.xy(d.region);
      const b = this.path.bounds(f);
      const fits = (b[1][0] - b[0][0]) * k > (node._w ?? 60) * 0.85 && (b[1][1] - b[0][1]) * k > 16;
      node.setAttribute('transform', `translate(${a[0]},${a[1] + 12 / k}) scale(${1 / k})`);
      node.style.display = fits ? '' : 'none';
    });
  }

  /** Zoom so the given regions sit comfortably in view. */
  focus(
    ids: string[],
    opts: { duration?: number; padRight?: number; padBottom?: number; padLeft?: number } = {},
    points: [number, number][] = [],
  ) {
    const fs = ids.map((id) => this.byId.get(id)).filter((f): f is RegionFeature => !!f);
    if (!fs.length || !this.w) return;
    const bs = [...fs.map((f) => this.path.bounds(f)), ...points.map((p) => [p, p] as [number, number][])];
    const x0 = Math.min(...bs.map((b) => b[0][0]));
    const y0 = Math.min(...bs.map((b) => b[0][1]));
    const x1 = Math.max(...bs.map((b) => b[1][0]));
    const y1 = Math.max(...bs.map((b) => b[1][1]));
    const left = opts.padLeft ?? 0;
    const vw = this.w - (opts.padRight ?? 0) - left;
    const vh = this.h - (opts.padBottom ?? 0);
    const bw = Math.max(x1 - x0, 30);
    const bh = Math.max(y1 - y0, 30);
    const k = Math.max(1.6, Math.min(9, Math.min(vw / (bw * 2.6), vh / (bh * 2.6))));
    const t = zoomIdentity.translate(left + vw / 2 - ((x0 + x1) / 2) * k, vh / 2 - ((y0 + y1) / 2) * k).scale(k);
    const svg = select(this.el);
    if (opts.duration === 0) svg.call(this.zoomer.transform, t);
    else svg.transition().duration(opts.duration ?? 800).call(this.zoomer.transform, t);
  }

  /** Zoom to a lon/lat point at a given scale. */
  focusPoint(lonlat: [number, number], k: number, duration = 0, padLeft = 0) {
    const p = this.proj(lonlat);
    if (!p) return;
    const cx = padLeft + (this.w - padLeft) / 2;
    const t = zoomIdentity.translate(cx - p[0] * k, this.h / 2 - p[1] * k).scale(k);
    const svg = select(this.el);
    if (!duration) svg.call(this.zoomer.transform, t);
    else svg.transition().duration(duration).call(this.zoomer.transform, t);
  }

  /** Briefly highlights regions that just changed hands. */
  flash(ids: string[]) {
    if (!ids.length) return;
    const set = new Set(ids);
    const paths = this.gRegions.selectAll<SVGPathElement, RegionFeature>('path').filter((f) => set.has(f.id));
    paths.classed('flash', false);
    void this.el.getBoundingClientRect(); // restart the animation
    paths.classed('flash', true);
    setTimeout(() => paths.classed('flash', false), 2600);
  }

  zoomBy(f: number) {
    select(this.el).transition().duration(250).call(this.zoomer.scaleBy, f);
  }

  /** A short arrow and blast for the player's own attacks and air strikes. */
  async playStrike(from: string, to: string, color: string, kind: 'attack' | 'air') {
    if (!this.w) return;
    const k = this.t.k;
    const p = this.xy(from);
    const q = this.xy(to);
    const c: [number, number] = [(p[0] + q[0]) / 2 - (q[1] - p[1]) * 0.2, (p[1] + q[1]) / 2 + (q[0] - p[0]) * 0.2];
    const g = this.gFx.append('g');
    const d = `M${p[0]},${p[1]} Q${c[0]},${c[1]} ${q[0]},${q[1]}`;
    const outline = g.append('path').attr('class', 'fx-arrow').attr('d', d).attr('stroke', '#0b1424').attr('stroke-width', 8 / k);
    const arrow = g.append('path').attr('class', `fx-arrow${kind === 'air' ? ' air' : ''}`).attr('d', d).attr('stroke', color).attr('stroke-width', 4.5 / k);
    const len = arrow.node()!.getTotalLength();
    for (const line of [outline, arrow]) {
      line.attr('stroke-dasharray', kind === 'air' ? `${6 / k} ${5 / k}` : `${len} ${len}`)
        .attr('stroke-dashoffset', kind === 'air' ? 0 : len)
        .transition().duration(380).attr('stroke-dashoffset', 0);
    }
    await new Promise((r) => setTimeout(r, 380));
    for (let i = 0; i < 2; i++) {
      g.append('circle').attr('class', 'fx-blast').attr('cx', q[0]).attr('cy', q[1]).attr('r', 0)
        .attr('stroke', i ? '#fff' : color).attr('stroke-width', 3 / k)
        .transition().delay(i * 120).duration(520).attr('r', 34 / k).style('opacity', 0);
    }
    await new Promise((r) => setTimeout(r, 450));
    g.transition().duration(250).style('opacity', 0).remove();
  }

  /**
   * Shows an enemy taking a region: the camera flies in, an arrow in the
   * attacker's colour runs from `from` to `to`, a blast hits the region and
   * `onCapture` repaints it. Resolves early once `skip.skipped` is set.
   */
  async playCapture(
    from: string, to: string, color: string, onCapture: () => void, skip: Skip,
    pads: { padRight?: number; padBottom?: number } = {},
  ) {
    if (!this.byId.has(to)) return onCapture();
    this.focus([to], { ...pads, duration: 700 }, this.byId.has(from) ? [this.xy(from)] : []);
    await wait(750, skip);
    if (skip.skipped) return onCapture();

    const k = this.t.k;
    const p = this.byId.has(from) ? this.xy(from) : this.xy(to);
    const q = this.xy(to);
    const c: [number, number] = [(p[0] + q[0]) / 2 - (q[1] - p[1]) * 0.2, (p[1] + q[1]) / 2 + (q[0] - p[0]) * 0.2];
    const g = this.gFx.append('g');
    const d = `M${p[0]},${p[1]} Q${c[0]},${c[1]} ${q[0]},${q[1]}`;
    const outline = g.append('path').attr('class', 'fx-arrow').attr('d', d).attr('stroke', '#0b1424').attr('stroke-width', 9 / k);
    const arrow = g.append('path').attr('class', 'fx-arrow').attr('d', d).attr('stroke', color).attr('stroke-width', 5 / k);
    const len = arrow.node()!.getTotalLength();
    for (const line of [outline, arrow]) {
      line.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
        .transition().duration(700).attr('stroke-dashoffset', 0);
    }
    const a = Math.atan2(q[1] - c[1], q[0] - c[0]);
    const sz = 14 / k;
    const head = [[q[0], q[1]], [q[0] - Math.cos(a - 0.45) * sz, q[1] - Math.sin(a - 0.45) * sz], [q[0] - Math.cos(a + 0.45) * sz, q[1] - Math.sin(a + 0.45) * sz]];
    g.append('path').attr('class', 'fx-head').attr('d', `M${head.join('L')}Z`).attr('fill', color)
      .attr('stroke-width', 1.5 / k).style('opacity', 0)
      .transition().delay(620).duration(120).style('opacity', 1);
    await wait(760, skip);
    if (skip.skipped) { g.remove(); return onCapture(); }

    for (let i = 0; i < 3; i++) {
      g.append('circle').attr('class', 'fx-blast').attr('cx', q[0]).attr('cy', q[1]).attr('r', 0)
        .attr('stroke', i === 1 ? '#fff' : color).attr('stroke-width', 3 / k)
        .transition().delay(i * 160).duration(750).attr('r', 48 / k).style('opacity', 0);
    }
    onCapture();
    this.flash([to]);
    await wait(1200, skip);
    g.transition().duration(300).style('opacity', 0).remove();
  }
}

export interface Skip { skipped: boolean }

/** Timer that ends early when the player skips the cutscene. */
function wait(ms: number, skip: Skip) {
  return new Promise<void>((resolve) => {
    const end = Date.now() + ms;
    const id = setInterval(() => {
      if (skip.skipped || Date.now() >= end) { clearInterval(id); resolve(); }
    }, 40);
  });
}

/** Centre of the biggest piece of a region, so islands don't pull labels into the sea. */
function labelPoint(f: RegionFeature): [number, number] {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = polys[0];
  let bestA = -1;
  for (const p of polys) {
    const a = geoArea({ type: 'Polygon', coordinates: p });
    if (a > bestA) { bestA = a; best = p; }
  }
  return geoCentroid({ type: 'Polygon', coordinates: best }) as [number, number];
}

function starPath(r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(Math.cos(a) * rr).toFixed(2)},${(Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
