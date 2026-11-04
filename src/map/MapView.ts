import { geoArea, geoCentroid, geoConicConformal, geoGraticule10, geoPath, type GeoPath, type GeoProjection } from 'd3-geo';
import { select, type Selection } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import 'd3-transition';
import { feature, merge, neighbors } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { COUNTRY, flagUrl } from '../data/countries';
import { CAPITAL, REGION } from '../data/regions';

const SHORT: Record<string, string> = { BA: 'Босния', MK: 'Македония', GB: 'Британия' };

type RegionFeature = Feature<MultiPolygon | Polygon, Record<string, unknown>> & { id: string };

export interface MapState {
  /** region -> owner country */
  owner: Record<string, string>;
  player: string | null;
  /** regions outlined as selected */
  selected: string[];
  /** regions the player can attack right now */
  targets: Set<string>;
  /** countries allied with the player */
  allies?: Set<string>;
  /** occupied capitals: country -> turns held */
  capHold?: Record<string, { by: string; turns: number }>;
  capitulateAfter?: number;
}

export class MapView {
  readonly el: SVGSVGElement;
  private host: HTMLElement;
  private onSelect: (region: string | null) => void;
  private topo: Topology<{ land: GeometryCollection }>;
  private regions: RegionFeature[] = [];
  private context: RegionFeature[] = [];
  private byId = new Map<string, RegionFeature>();
  /** label point of each region, lon/lat */
  private anchorLL = new Map<string, [number, number]>();
  private seaLinks: [string, string][] = [];
  private proj: GeoProjection = geoConicConformal();
  private path: GeoPath = geoPath(this.proj);
  private zoomer: ZoomBehavior<SVGSVGElement, unknown>;
  private t: ZoomTransform = zoomIdentity;
  private w = 0;
  private h = 0;
  private state: MapState = { owner: {}, player: null, selected: [], targets: new Set() };

  private root: Selection<SVGGElement, unknown, null, undefined>;
  private gGrid: Selection<SVGPathElement, unknown, null, undefined>;
  private gContext: Selection<SVGGElement, unknown, null, undefined>;
  private gRegions: Selection<SVGGElement, unknown, null, undefined>;
  private gTargets: Selection<SVGGElement, unknown, null, undefined>;
  private gNations: Selection<SVGGElement, unknown, null, undefined>;
  private gSea: Selection<SVGGElement, unknown, null, undefined>;
  private pBorder: Selection<SVGPathElement, unknown, null, undefined>;
  private pBorderHalo: Selection<SVGPathElement, unknown, null, undefined>;
  private pSelected: Selection<SVGPathElement, unknown, null, undefined>;
  private gCapitals: Selection<SVGGElement, unknown, null, undefined>;
  private gYields: Selection<SVGGElement, unknown, null, undefined>;
  private gLabels: Selection<SVGGElement, unknown, null, undefined>;
  private gFx: Selection<SVGGElement, unknown, null, undefined>;

  constructor(host: HTMLElement, topo: unknown, onSelect: (region: string | null) => void) {
    this.host = host;
    this.onSelect = onSelect;
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

    const pat = svg.append('defs').append('pattern').attr('id', 'hatch').attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 7).attr('height', 7).attr('patternTransform', 'rotate(45)');
    pat.append('rect').attr('width', 2.2).attr('height', 7).attr('fill', 'rgba(255,255,255,0.32)');

    svg.append('rect').attr('class', 'sea').attr('width', '100%').attr('height', '100%')
      .on('click', () => this.onSelect(null));
    this.root = svg.append('g');
    this.gGrid = this.root.append('path').attr('class', 'graticule');
    this.gContext = this.root.append('g').attr('class', 'context');
    this.gRegions = this.root.append('g').attr('class', 'countries');
    this.gTargets = this.root.append('g').attr('class', 'targets');
    this.gNations = this.root.append('g').attr('class', 'nations');
    this.gSea = this.root.append('g').attr('class', 'sea-links');
    this.pBorderHalo = this.root.append('path').attr('class', 'player-halo');
    this.pBorder = this.root.append('path').attr('class', 'player-border');
    this.pSelected = this.root.append('path').attr('class', 'selected');
    this.gYields = this.root.append('g').attr('class', 'yields');
    this.gCapitals = this.root.append('g').attr('class', 'capitals');
    this.gLabels = this.root.append('g').attr('class', 'labels');
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

  setSeaLinks(pairs: [string, string][]) {
    this.seaLinks = pairs;
    this.drawSeaLinks();
  }

  private layout() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.w = r.width;
    this.h = r.height;
    // all of playable Europe fits at zoom 1
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
      .on('click', (e: MouseEvent, f) => { e.stopPropagation(); this.onSelect(f.id); });
    this.drawSeaLinks();
    this.drawYields();
    this.update(this.state);
  }

  /** What each region gives: gold coin for money, red chevron for soldiers. */
  private drawYields() {
    const g = this.gYields.selectAll<SVGGElement, RegionFeature>('g.yield').data(this.regions, (f) => f.id)
      .join((enter) => {
        const e = enter.append('g').attr('class', 'yield');
        e.each(function (f) {
          const r = REGION[f.id];
          const icons: string[] = [];
          if (r.kind !== 'manpower') icons.push('money');
          if (r.men > 0) icons.push('men');
          const sel = select(this);
          icons.forEach((kind, i) => {
            const x = (i - (icons.length - 1) / 2) * 13;
            const ic = sel.append('g').attr('class', `y-${kind}`).attr('transform', `translate(${x},0)`);
            ic.append('circle').attr('r', 5.5);
            if (kind === 'money') ic.append('circle').attr('class', 'inner').attr('r', 2.6);
            else ic.append('path').attr('d', 'M-3,-0.5 L0,-3 L3,-0.5 M-3,2.5 L0,0 L3,2.5');
          });
          sel.append('title').text(`${r.name}: ${r.eco} денег и ${r.men} солдат за ход`);
        });
        return e;
      });
    g.each((f, i, nodes) => {
      const [x, y] = this.xy(f.id);
      nodes[i].dataset.x = String(x);
      nodes[i].dataset.y = String(y);
    });
  }

  private xy(id: string) {
    return this.proj(this.anchorLL.get(id)!) as [number, number];
  }

  private drawSeaLinks() {
    if (!this.w) return;
    this.gSea.selectAll('path').data(this.seaLinks).join('path').attr('d', ([a, b]) => {
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
    const col = (id: string) => COUNTRY[s.owner[id] ?? REGION[id].c]?.color ?? '#555';
    this.gRegions.selectAll<SVGPathElement, RegionFeature>('path')
      .attr('fill', (f) => col(f.id))
      .classed('ally', (f) => !!s.allies?.has(s.owner[f.id]));

    this.gTargets.selectAll<SVGPathElement, RegionFeature>('path')
      .data(this.regions.filter((f) => s.targets.has(f.id)), (f) => f.id)
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

    this.gSea.selectAll<SVGPathElement, [string, string]>('path').classed('active', ([a, b]) =>
      !!s.player && ((s.owner[a] === s.player && s.targets.has(b)) || (s.owner[b] === s.player && s.targets.has(a))));

    const mine = s.player ? shapes.find((x) => x.n === s.player)?.d ?? null : null;
    this.pBorder.attr('d', mine);
    this.pBorderHalo.attr('d', mine);
    const sel = s.selected.filter((id) => this.byId.has(id));
    this.pSelected.attr('d', sel.length
      ? this.path(merge(this.topo, geoms.filter((g) => sel.includes(g.id as string)) as never))
      : null);

    this.drawCapitals();
    this.drawLabels();
  }

  /** Red star on every capital; occupied ones show turns left before surrender. */
  private drawCapitals() {
    const s = this.state;
    const alive = new Set(Object.values(s.owner));
    const caps = Object.entries(CAPITAL).filter(([c]) => alive.has(c));
    const g = this.gCapitals.selectAll<SVGGElement, [string, string]>('g.cap').data(caps, (d) => d[0])
      .join((enter) => {
        const e = enter.append('g').attr('class', 'cap');
        e.append('circle').attr('r', 6.5);
        e.append('path').attr('d', starPath(4.2));
        e.append('text').attr('class', 'cap-left').attr('x', 9).attr('y', -5);
        e.append('title');
        return e;
      });
    g.each((d, i, nodes) => {
      const [c, region] = d;
      const node = nodes[i];
      const pt = this.proj(REGION[region].point ?? this.anchorLL.get(region)!) as [number, number];
      node.dataset.x = String(pt[0]);
      node.dataset.y = String(pt[1]);
      const hold = s.owner[region] !== c ? s.capHold?.[c] : undefined;
      const left = hold ? (s.capitulateAfter ?? 3) - hold.turns : null;
      node.classList.toggle('occupied', left !== null);
      node.querySelector('text')!.textContent = left !== null ? String(left) : '';
      node.querySelector('title')!.textContent = left !== null
        ? `Столица страны ${COUNTRY[c].name} занята. Капитуляция через ${left} ход.`
        : `Столица страны ${COUNTRY[c].name}`;
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

  /** Overlays keep their screen size; labels hide where they don't fit. */
  private placeOverlays() {
    const k = this.t.k;
    // yields only when zoomed in enough to read them
    const showYields = k >= 2.2;
    this.gYields.style('display', showYields ? 'inline' : 'none');
    if (showYields) {
      this.gYields.selectAll<SVGGElement, unknown>('g.yield').each((_, i, nodes) => {
        const n = nodes[i];
        n.setAttribute('transform', `translate(${n.dataset.x},${Number(n.dataset.y) - 6 / k}) scale(${1 / k})`);
      });
    }
    this.gCapitals.selectAll<SVGGElement, unknown>('g.cap').each((_, i, nodes) => {
      const n = nodes[i];
      n.setAttribute('transform', `translate(${n.dataset.x},${n.dataset.y}) scale(${1 / k})`);
    });
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
    // frame the target and the point the arrow starts from, not the attacker's whole region
    this.focus([to], { ...pads, duration: 700 }, this.byId.has(from) ? [this.xy(from)] : []);
    await wait(750, skip);
    if (skip.skipped) return onCapture();

    const k = this.t.k;
    const p = this.byId.has(from) ? this.xy(from) : this.xy(to);
    const q = this.xy(to);
    const c: [number, number] = [(p[0] + q[0]) / 2 - (q[1] - p[1]) * 0.2, (p[1] + q[1]) / 2 + (q[0] - p[0]) * 0.2];
    const g = this.gFx.append('g');

    // dark outline under the coloured arrow so it reads on any country
    const d = `M${p[0]},${p[1]} Q${c[0]},${c[1]} ${q[0]},${q[1]}`;
    const outline = g.append('path').attr('class', 'fx-arrow').attr('d', d).attr('stroke', '#0b1424').attr('stroke-width', 9 / k);
    const arrow = g.append('path').attr('class', 'fx-arrow').attr('d', d).attr('stroke', color).attr('stroke-width', 5 / k);
    const len = arrow.node()!.getTotalLength();
    for (const line of [outline, arrow]) {
      line.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
        .transition().duration(700).attr('stroke-dashoffset', 0);
    }
    // arrow head, pointing along the end of the curve
    const a = Math.atan2(q[1] - c[1], q[0] - c[0]);
    const s = 14 / k;
    const head = [[q[0], q[1]], [q[0] - Math.cos(a - 0.45) * s, q[1] - Math.sin(a - 0.45) * s], [q[0] - Math.cos(a + 0.45) * s, q[1] - Math.sin(a + 0.45) * s]];
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
