import { geoArea, geoCentroid, geoConicConformal, geoGraticule10, geoPath, type GeoPath, type GeoProjection } from 'd3-geo';
import { select, type Selection } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import 'd3-transition';
import { feature, merge, neighbors } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { COUNTRY, SEA_LINKS, flagUrl } from '../data/countries';

const SVG = 'http://www.w3.org/2000/svg';
const SHORT: Record<string, string> = { BA: 'Босния', MK: 'Македония', GB: 'Британия' };

type CountryFeature = Feature<MultiPolygon | Polygon, { name?: string }> & { id: string };

export interface MapState {
  owner: Record<string, string>;
  player: string | null;
  selected: string | null;
  /** territories the player can attack right now */
  targets: Set<string>;
  /** countries allied with the player */
  allies?: Set<string>;
}

export class MapView {
  readonly el: SVGSVGElement;
  private topo: Topology<{ land: GeometryCollection }>;
  private playable: CountryFeature[] = [];
  private context: CountryFeature[] = [];
  private byCode = new Map<string, CountryFeature>();
  private anchor = new Map<string, [number, number]>();
  private proj: GeoProjection = geoConicConformal();
  private path: GeoPath = geoPath(this.proj);
  private zoomer: ZoomBehavior<SVGSVGElement, unknown>;
  private t: ZoomTransform = zoomIdentity;
  private w = 0;
  private h = 0;
  private state: MapState = { owner: {}, player: null, selected: null, targets: new Set() };

  private root: Selection<SVGGElement, unknown, null, undefined>;
  private gGrid!: Selection<SVGPathElement, unknown, null, undefined>;
  private gContext!: Selection<SVGGElement, unknown, null, undefined>;
  private gCountries!: Selection<SVGGElement, unknown, null, undefined>;
  private gTargets!: Selection<SVGGElement, unknown, null, undefined>;
  private gSea!: Selection<SVGGElement, unknown, null, undefined>;
  private pBorder!: Selection<SVGPathElement, unknown, null, undefined>;
  private pBorderHalo!: Selection<SVGPathElement, unknown, null, undefined>;
  private pSelected!: Selection<SVGPathElement, unknown, null, undefined>;
  private gLabels!: Selection<SVGGElement, unknown, null, undefined>;

  private host: HTMLElement;
  private onSelect: (code: string | null) => void;

  constructor(host: HTMLElement, topo: unknown, onSelect: (code: string | null) => void) {
    this.host = host;
    this.onSelect = onSelect;
    this.topo = topo as Topology<{ land: GeometryCollection }>;
    const fc = feature(this.topo, this.topo.objects.land) as unknown as { features: CountryFeature[] };
    for (const f of fc.features) {
      if (COUNTRY[f.id]) {
        this.playable.push(f);
        this.byCode.set(f.id, f);
      } else this.context.push(f);
    }

    this.el = document.createElementNS(SVG, 'svg');
    this.el.classList.add('map');
    host.append(this.el);
    const svg = select(this.el);

    const defs = svg.append('defs');
    const pat = defs.append('pattern').attr('id', 'hatch').attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 7).attr('height', 7).attr('patternTransform', 'rotate(45)');
    pat.append('rect').attr('width', 2.2).attr('height', 7).attr('fill', 'rgba(255,255,255,0.32)');

    svg.append('rect').attr('class', 'sea').attr('width', '100%').attr('height', '100%')
      .on('click', () => this.onSelect(null));
    this.root = svg.append('g');
    this.gGrid = this.root.append('path').attr('class', 'graticule');
    this.gContext = this.root.append('g').attr('class', 'context');
    this.gCountries = this.root.append('g').attr('class', 'countries');
    this.gTargets = this.root.append('g').attr('class', 'targets');
    this.gSea = this.root.append('g').attr('class', 'sea-links');
    this.pBorderHalo = this.root.append('path').attr('class', 'player-halo');
    this.pBorder = this.root.append('path').attr('class', 'player-border');
    this.pSelected = this.root.append('path').attr('class', 'selected');
    this.gLabels = this.root.append('g').attr('class', 'labels');

    this.zoomer = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 14])
      .clickDistance(5)
      .on('zoom', (e) => {
        this.t = e.transform;
        this.root.attr('transform', this.t.toString());
        this.updateLabels();
      });
    svg.call(this.zoomer).on('dblclick.zoom', null);

    new ResizeObserver(() => this.layout()).observe(host);
    this.layout();
  }

  /** Pairs of codes that share a land border. */
  landPairs(): [string, string][] {
    const geoms = this.topo.objects.land.geometries;
    const nb = neighbors(geoms as never);
    const out: [string, string][] = [];
    geoms.forEach((g, i) => {
      const a = g.id as string;
      if (!COUNTRY[a]) return;
      for (const j of nb[i]) {
        const b = geoms[j].id as string;
        if (COUNTRY[b] && a < b) out.push([a, b]);
      }
    });
    return out;
  }

  private layout() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.w = r.width;
    this.h = r.height;
    // whole playable Europe fits at zoom 1
    this.proj = geoConicConformal().parallels([43, 62]).rotate([-15, 0]).fitExtent(
      [[20, 20], [this.w - 20, this.h - 20]],
      { type: 'MultiPoint', coordinates: [[-24, 36], [58, 38], [-24, 66], [58, 66], [20, 71.5], [20, 34]] },
    );
    this.path = geoPath(this.proj);
    this.zoomer.translateExtent([[-this.w * 0.15, -this.h * 0.15], [this.w * 1.15, this.h * 1.15]]);
    this.gGrid.attr('d', this.path(geoGraticule10()));
    this.computeAnchors();
    this.drawShapes();
    this.update(this.state);
  }

  private computeAnchors() {
    for (const f of this.playable) {
      const def = COUNTRY[f.id];
      let lonlat = def.label;
      if (!lonlat) {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        let best = polys[0];
        let bestA = -1;
        for (const p of polys) {
          const a = geoArea({ type: 'Polygon', coordinates: p });
          if (a > bestA) { bestA = a; best = p; }
        }
        lonlat = geoCentroid({ type: 'Polygon', coordinates: best }) as [number, number];
      }
      this.anchor.set(f.id, this.proj(lonlat) as [number, number]);
    }
  }

  private drawShapes() {
    this.gContext.selectAll('path').data(this.context).join('path').attr('d', (f) => this.path(f));
    this.gCountries.selectAll<SVGPathElement, CountryFeature>('path').data(this.playable, (f) => f.id)
      .join('path')
      .attr('d', (f) => this.path(f))
      .on('click', (e: MouseEvent, f) => { e.stopPropagation(); this.onSelect(f.id); });

    this.gSea.selectAll('path').data(SEA_LINKS).join('path').attr('d', ([a, b]) => {
      const p = this.anchor.get(a)!;
      const q = this.anchor.get(b)!;
      const mx = (p[0] + q[0]) / 2;
      const my = (p[1] + q[1]) / 2;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      return `M${p[0]},${p[1]} Q${mx - dy * 0.15},${my + dx * 0.15} ${q[0]},${q[1]}`;
    });

    const labels = this.gLabels.selectAll<SVGGElement, CountryFeature>('g').data(this.playable, (f) => f.id)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'label');
        g.append('image').attr('href', (f) => flagUrl(f.id)).attr('width', 16).attr('height', 12)
          .attr('preserveAspectRatio', 'none');
        g.append('text').attr('dy', '0.35em').text((f) => SHORT[f.id] ?? COUNTRY[f.id].name);
        return g;
      });
    labels.each(function (f) {
      const text = this.querySelector('text')!;
      const tw = text.getComputedTextLength() || COUNTRY[f.id].name.length * 7;
      const total = 16 + 5 + tw;
      this.querySelector('image')!.setAttribute('x', String(-total / 2));
      this.querySelector('image')!.setAttribute('y', '-6');
      text.setAttribute('x', String(-total / 2 + 21));
      (this as SVGGElement & { _w?: number })._w = total;
    });
    this.updateLabels();
  }

  /** Labels keep their screen size and hide when the country is too small for them. */
  private updateLabels() {
    const k = this.t.k;
    this.gLabels.selectAll<SVGGElement, CountryFeature>('g').each((f, i, nodes) => {
      const node = nodes[i] as SVGGElement & { _w?: number };
      const a = this.anchor.get(f.id)!;
      const b = this.path.bounds(f);
      const fits = (b[1][0] - b[0][0]) * k > (node._w ?? 60) * 0.85 && (b[1][1] - b[0][1]) * k > 16;
      node.setAttribute('transform', `translate(${a[0]},${a[1]}) scale(${1 / k})`);
      node.style.display = fits || f.id === this.state.selected ? '' : 'none';
    });
  }

  update(s: MapState) {
    this.state = s;
    const col = (code: string) => COUNTRY[s.owner[code] ?? code]?.color ?? '#555';
    this.gCountries.selectAll<SVGPathElement, CountryFeature>('path')
      .attr('fill', (f) => col(f.id))
      .classed('mine', (f) => s.owner[f.id] === s.player)
      .classed('ally', (f) => !!s.allies?.has(s.owner[f.id]));

    this.gTargets.selectAll<SVGPathElement, CountryFeature>('path')
      .data(this.playable.filter((f) => s.targets.has(f.id)), (f) => f.id)
      .join('path').attr('d', (f) => this.path(f));

    this.gSea.selectAll<SVGPathElement, [string, string]>('path').classed('active', ([a, b]) =>
      !!s.player && ((s.owner[a] === s.player && s.targets.has(b)) || (s.owner[b] === s.player && s.targets.has(a))));

    if (s.player) {
      const geoms = this.topo.objects.land.geometries.filter((g) => s.owner[g.id as string] === s.player);
      const d = this.path(merge(this.topo, geoms as never)) ?? '';
      this.pBorder.attr('d', d);
      this.pBorderHalo.attr('d', d);
    } else {
      this.pBorder.attr('d', null);
      this.pBorderHalo.attr('d', null);
    }
    const sel = s.selected ? this.byCode.get(s.selected) : null;
    this.pSelected.attr('d', sel ? this.path(sel) : null);
    this.updateLabels();
  }

  /** Zoom so a country sits comfortably in view. */
  focus(code: string, opts: { duration?: number; padRight?: number; padBottom?: number; padLeft?: number } = {}) {
    const f = this.byCode.get(code);
    if (!f || !this.w) return;
    const [[x0, y0], [x1, y1]] = this.path.bounds(f);
    const left = opts.padLeft ?? 0;
    const vw = this.w - (opts.padRight ?? 0) - left;
    const vh = this.h - (opts.padBottom ?? 0);
    const bw = Math.max(x1 - x0, 30);
    const bh = Math.max(y1 - y0, 30);
    const k = Math.max(1.6, Math.min(8, Math.min(vw / (bw * 3), vh / (bh * 3))));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const t = zoomIdentity.translate(left + vw / 2 - cx * k, vh / 2 - cy * k).scale(k);
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

  /** Briefly highlights territories that just changed hands. */
  flash(codes: string[]) {
    if (!codes.length) return;
    const set = new Set(codes);
    const paths = this.gCountries.selectAll<SVGPathElement, CountryFeature>('path').filter((f) => set.has(f.id));
    paths.classed('flash', false);
    void this.el.getBoundingClientRect(); // restart the animation
    paths.classed('flash', true);
    setTimeout(() => paths.classed('flash', false), 2600);
  }

  zoomBy(f: number) {
    select(this.el).transition().duration(250).call(this.zoomer.scaleBy, f);
  }
}
