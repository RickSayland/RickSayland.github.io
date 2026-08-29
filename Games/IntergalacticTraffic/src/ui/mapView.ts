/**
 * The chart. One canvas, never a DOM node per object.
 *
 * Era 1 is a real orbital diagram — the nodes have semi-major axes and the
 * player is meant to read transfer geometry off it. Era 2+ is the same polar
 * layout driven by heliocentric distance; the era-3 generator already lays its
 * nodes on logarithmic spiral arms, so the arms are the data, not a flourish
 * added here.
 *
 * Read-only. The only things this file is allowed to change are the camera and
 * the two ctx callbacks it fires on a click.
 */

import { fmt } from '../core/format';
import { AU, LY, TIME_SCALE } from '../sim/constants';
import { nodesUpToEra, regionLabel } from '../sim/nodes';
import type { Sim } from '../sim/engine';
import type { RouteKind, WorldNode } from '../sim/types';
import type { UiCtx, View } from './ctx';
import { button, el, esc, on, qs, setClass } from './dom';
import { icon } from './icons';

// --------------------------------------------------------------- tuning ----

/** Innermost plot radius as a fraction of the outermost. The Sun needs room. */
const R_INNER = 0.11;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 60;
const ZOOM_STEP = 1.18;
const HIT_PX = 11;

/**
 * The unsurveyed remainder is scenery. Era 3 alone generates 900 nodes and era
 * 4 another 260; drawing every one as a marker with a label would cost more
 * than everything else on the chart put together, so they go down as a point
 * cloud, sampled to this many and culled to the viewport first.
 */
const CLOUD_CAP = 1500;

/** Ships are decoration. Nothing here is simulated per hull. */
const SHIPS_PER_ROUTE = 12;
const SHIPS_TOTAL = 600;

const PARENT_LABEL: Record<string, string> = {
  earth: 'Earth', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn',
};

// ---------------------------------------------------------------- state ----

/** One mounted instance. Module-level state is honest about that. */
let root: HTMLElement | null = null;
let wrap: HTMLElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let g: CanvasRenderingContext2D | null = null;
let tip: HTMLElement | null = null;
let sim: Sim | null = null;
let uctx: UiCtx | null = null;

let cssW = 0;
let cssH = 0;
let dpr = 1;
let baseR = 200; // world radius of the outermost ring, in CSS px at zoom 1

let zoom = 1;
let panX = 0;
let panY = 0;

let visible = false;
let raf = 0;
let lastFrame = 0;
let needsDraw = true;
let layoutDirty = true;
let viewDirty = true;

/** Sim seconds elapsed since the tick we last observed, for smooth particles. */
let extraSim = 0;
let lastSimT = -1;

let seenStructure = -1;
let seenEra = -1;
let seenSurveyed = -1;
let seenRoutes = -1;

let hoverIdx = -1;
let dragging = false;
let dragMoved = false;
let dragX = 0;
let dragY = 0;
let pointerX = -1;
let pointerY = -1;

// ---- layout products, all rebuilt together ----

/** Full-detail nodes: every era-1 node, or (era 2+) surveyed nodes and route endpoints. */
let full: WorldNode[] = [];
let fullIndex = new Map<string, number>();
let wx = new Float32Array(0);
let wy = new Float32Array(0);
let sx = new Float32Array(0);
let sy = new Float32Array(0);
let isSurveyed = new Uint8Array(0);

/** Point cloud, world coordinates, before culling. */
let cloudWX = new Float32Array(0);
let cloudWY = new Float32Array(0);
let cloudSX = new Float32Array(0);
let cloudSY = new Float32Array(0);
let cloudN = 0;

interface Ring { r: number; label: string }
let rings: Ring[] = [];

interface GroupLabel { r: number; angle: number; text: string }
let groupLabels: GroupLabel[] = [];

/** Radial extent of each region, so interdiction can shade a band. */
let regionBand = new Map<string, { r0: number; r1: number }>();

// ------------------------------------------------------------- palette -----

interface Palette {
  ink: string; dim: string; faint: string; line: string; sunken: string;
  trade: string; science: string; military: string; red: string; amberHi: string;
}
let pal: Palette = {
  ink: '#e7e5df', dim: '#9aa2ab', faint: '#6f7783', line: '#262d36',
  sunken: '#0e1216', trade: '#eab558', science: '#63c2c9', military: '#7f9bb5',
  red: '#d9635b', amberHi: '#f7cd84',
};

function readPalette(): void {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => {
    const s = cs.getPropertyValue(name).trim();
    return s.length ? s : fallback;
  };
  pal = {
    ink: v('--ink', pal.ink),
    dim: v('--ink-dim', pal.dim),
    faint: v('--ink-faint', pal.faint),
    line: v('--line', pal.line),
    sunken: v('--bg-sunken', pal.sunken),
    trade: v('--amber', pal.trade),
    science: v('--teal', pal.science),
    military: v('--steel', pal.military),
    red: v('--red', pal.red),
    amberHi: v('--amber-hi', pal.amberHi),
  };
}

function kindColor(k: RouteKind): string {
  return k === 'trade' ? pal.trade : k === 'science' ? pal.science : pal.military;
}

/**
 * Dash first, colour second. Nothing on this chart may be legible only to
 * someone who can tell amber from teal.
 */
function kindDash(k: RouteKind): number[] {
  return k === 'trade' ? [] : k === 'science' ? [7, 4] : [2, 3];
}

// ------------------------------------------------------------- helpers -----

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function reducedMotion(): boolean {
  if (sim?.state.settings.reducedMotion) return true;
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function distLabel(m: number): string {
  if (m < 0.05 * LY) {
    const au = m / AU;
    return au.toFixed(au < 10 ? 2 : 0) + ' AU';
  }
  const ly = m / LY;
  if (ly < 1e3) return ly.toFixed(ly < 10 ? 1 : 0) + ' ly';
  if (ly < 1e6) return (ly / 1e3).toFixed(1) + ' kly';
  if (ly < 1e9) return (ly / 1e6).toFixed(1) + ' Mly';
  return (ly / 1e9).toFixed(1) + ' Gly';
}

// -------------------------------------------------------------- layout -----

/** The quantity a node's plot radius is derived from. */
function radialValue(n: WorldNode, era: number): number {
  const v = era === 1 ? (n.a ?? n.dist) : n.dist;
  return v > 0 ? v : 1;
}

/**
 * Mercury sits at 0.387 AU and the Oort beacon at 320. Era 4 spans ten orders
 * of magnitude on its own. Nothing but a log radius puts both ends of any era
 * on one screen at once, so: r = R_INNER + K * log(v / vmin).
 */
function buildLayout(s: Sim): void {
  const era = s.state.era;
  const all = nodesUpToEra(era);
  const surveyed = new Set(s.state.surveyed);
  const endpoints = new Set<string>();
  for (const r of s.state.routes) {
    endpoints.add(r.from);
    endpoints.add(r.to);
  }

  const detail: WorldNode[] = [];
  const cloud: WorldNode[] = [];
  for (const n of all) {
    // Era 1 is small enough to draw whole, and it is the diagram the player is
    // meant to plan on. Later eras show what has been surveyed plus whatever a
    // route already touches; everything else is scenery.
    if (era === 1 || surveyed.has(n.id) || endpoints.has(n.id)) detail.push(n);
    else cloud.push(n);
  }

  let vmin = Infinity;
  let vmax = 0;
  for (const n of all) {
    const v = radialValue(n, era);
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  if (!isFinite(vmin) || vmin <= 0) vmin = 1;
  if (vmax <= vmin) vmax = vmin * 10;
  const span = Math.log(vmax / vmin);
  const K = (1 - R_INNER) / span;
  const radiusOf = (n: WorldNode): number =>
    R_INNER + K * Math.log(radialValue(n, era) / vmin);

  full = detail;
  fullIndex = new Map(detail.map((n, i) => [n.id, i]));
  const nf = detail.length;
  wx = new Float32Array(nf);
  wy = new Float32Array(nf);
  sx = new Float32Array(nf);
  sy = new Float32Array(nf);
  isSurveyed = new Uint8Array(nf);

  const angles = new Float64Array(nf);
  const radii = new Float64Array(nf);
  for (let i = 0; i < nf; i++) {
    const n = detail[i]!;
    angles[i] = Math.atan2(n.my, n.mx);
    radii[i] = radiusOf(n);
    isSurveyed[i] = surveyed.has(n.id) ? 1 : 0;
  }

  groupLabels = [];
  if (era === 1) fanParentGroups(detail, angles, radii);

  for (let i = 0; i < nf; i++) {
    const r = radii[i]! * baseR;
    wx[i] = Math.cos(angles[i]!) * r;
    wy[i] = Math.sin(angles[i]!) * r;
  }

  // --- point cloud ---------------------------------------------------------
  cloudN = cloud.length;
  cloudWX = new Float32Array(cloudN);
  cloudWY = new Float32Array(cloudN);
  for (let i = 0; i < cloudN; i++) {
    const n = cloud[i]!;
    const r = radiusOf(n) * baseR;
    const a = Math.atan2(n.my, n.mx);
    cloudWX[i] = Math.cos(a) * r;
    cloudWY[i] = Math.sin(a) * r;
  }
  cloudSX = new Float32Array(Math.min(cloudN, CLOUD_CAP));
  cloudSY = new Float32Array(Math.min(cloudN, CLOUD_CAP));

  // --- rings ---------------------------------------------------------------
  rings = [];
  if (era === 1) {
    // One faint circle per distinct semi-major axis: the orbits themselves.
    const seen = new Set<string>();
    for (const n of all) {
      const v = radialValue(n, 1);
      const key = v.toPrecision(6);
      if (seen.has(key)) continue;
      seen.add(key);
      rings.push({ r: radiusOf(n) * baseR, label: distLabel(v) });
    }
  } else {
    // No orbits out here, so the rings are a decade scale instead.
    const k0 = Math.ceil(Math.log10(vmin));
    const k1 = Math.floor(Math.log10(vmax));
    for (let k = k0; k <= k1; k++) {
      const v = Math.pow(10, k);
      rings.push({
        r: (R_INNER + K * Math.log(v / vmin)) * baseR,
        label: distLabel(v),
      });
    }
  }

  // --- region bands, for the interdiction overlay --------------------------
  regionBand = new Map();
  for (const n of all) {
    const r = radiusOf(n) * baseR;
    const b = regionBand.get(n.region);
    if (!b) regionBand.set(n.region, { r0: r, r1: r });
    else {
      if (r < b.r0) b.r0 = r;
      if (r > b.r1) b.r1 = r;
    }
  }

  layoutDirty = false;
  viewDirty = true;
}

/**
 * Nodes sharing a parent body share a semi-major axis, so they land on exactly
 * the same ring and would draw on top of each other. Spread them apart in
 * angle, keeping the authored order and the group's mean bearing, then label
 * the group by the body it orbits.
 */
function fanParentGroups(
  nodes: WorldNode[], angles: Float64Array, radii: Float64Array,
): void {
  const MIN_SEP = 0.30; // radians, enough at the innermost ring we draw
  const groups = new Map<string, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i]!.parent;
    if (!p || p === 'sun') continue;
    const list = groups.get(p);
    if (list) list.push(i);
    else groups.set(p, [i]);
  }
  for (const [parent, idx] of groups) {
    idx.sort((a, b) => angles[a]! - angles[b]!);
    let mean = 0;
    for (const i of idx) mean += angles[i]!;
    mean /= idx.length;
    if (idx.length > 1) {
      for (let k = 1; k < idx.length; k++) {
        const prev = angles[idx[k - 1]!]!;
        const cur = angles[idx[k]!]!;
        if (cur - prev < MIN_SEP) angles[idx[k]!] = prev + MIN_SEP;
      }
      let mean2 = 0;
      for (const i of idx) mean2 += angles[i]!;
      mean2 /= idx.length;
      const shift = mean - mean2;
      for (const i of idx) angles[i] = angles[i]! + shift;
    }
    const label = PARENT_LABEL[parent];
    if (label && idx.length > 1) {
      groupLabels.push({ r: radii[idx[0]!]! * baseR, angle: mean, text: label });
    }
  }
}

// ---------------------------------------------------------- projection -----

/**
 * Screen positions are recomputed on pan, zoom, resize and structure change —
 * never per frame. At era 4 that is a couple of thousand transforms saved
 * sixty times a second for a camera that is usually standing still.
 */
function project(): void {
  const cx = cssW / 2;
  const cy = cssH / 2;
  for (let i = 0; i < full.length; i++) {
    sx[i] = cx + (wx[i]! + panX) * zoom;
    sy[i] = cy + (wy[i]! + panY) * zoom;
  }

  // Cull first, then sample: taking the first CLOUD_CAP in array order would
  // bias inward, because the generator sorts its nodes by distance.
  const m = 24;
  let visN = 0;
  for (let i = 0; i < cloudN; i++) {
    const px = cx + (cloudWX[i]! + panX) * zoom;
    const py = cy + (cloudWY[i]! + panY) * zoom;
    if (px >= -m && px <= cssW + m && py >= -m && py <= cssH + m) visN++;
  }
  const step = visN > CLOUD_CAP ? Math.ceil(visN / CLOUD_CAP) : 1;
  let seen = 0;
  let out = 0;
  const cap = cloudSX.length;
  for (let i = 0; i < cloudN && out < cap; i++) {
    const px = cx + (cloudWX[i]! + panX) * zoom;
    const py = cy + (cloudWY[i]! + panY) * zoom;
    if (px < -m || px > cssW + m || py < -m || py > cssH + m) continue;
    if (seen++ % step !== 0) continue;
    cloudSX[out] = px;
    cloudSY[out] = py;
    out++;
  }
  cloudDrawn = out;
  viewDirty = false;
}

let cloudDrawn = 0;

function sunScreen(): [number, number] {
  return [cssW / 2 + panX * zoom, cssH / 2 + panY * zoom];
}

// ---------------------------------------------------------------- draw -----

const shipX: number[][] = [[], [], []];
const shipY: number[][] = [[], [], []];
const KINDS: RouteKind[] = ['trade', 'science', 'military'];

function draw(dtReal: number): void {
  const s = sim;
  const c = g;
  if (!s || !c || cssW <= 0 || cssH <= 0) return;
  if (layoutDirty) buildLayout(s);
  if (viewDirty) project();

  // Particle phase. The tick advances route.phase 20 times a second; the frame
  // rate is three times that, so extrapolate from real elapsed time between
  // ticks and reset the moment a new tick lands. Clamped so a paused or
  // backgrounded tab cannot drift the fleet halfway round its route.
  const still = reducedMotion();
  if (still) {
    extraSim = 0;
  } else if (s.state.t !== lastSimT) {
    lastSimT = s.state.t;
    extraSim = 0;
  } else {
    extraSim = Math.min(extraSim + dtReal * TIME_SCALE, TIME_SCALE * 0.15);
  }

  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, cssW, cssH);
  c.lineJoin = 'round';
  c.lineCap = 'round';

  drawRings(c);
  drawInterdiction(c, s);
  drawRoutes(c, s);
  drawShips(c, s, still);
  drawCloud(c);
  drawNodes(c, s);
  drawSun(c);
  drawLabels(c, s);
}

function drawSun(c: CanvasRenderingContext2D): void {
  const [px, py] = sunScreen();
  if (px < -40 || px > cssW + 40 || py < -40 || py > cssH + 40) return;
  c.beginPath();
  c.arc(px, py, 5, 0, Math.PI * 2);
  c.fillStyle = pal.amberHi;
  c.fill();
  c.beginPath();
  c.arc(px, py, 9, 0, Math.PI * 2);
  c.strokeStyle = pal.trade;
  c.globalAlpha = 0.5;
  c.lineWidth = 1;
  c.stroke();
  c.globalAlpha = 1;
}

function drawRings(c: CanvasRenderingContext2D): void {
  const [px, py] = sunScreen();
  c.strokeStyle = pal.line;
  c.lineWidth = 1;
  c.setLineDash([]);
  c.beginPath(); // one path for every ring: the stroke style never changes
  for (const r of rings) {
    const rr = r.r * zoom;
    if (rr < 6 || rr > Math.hypot(cssW, cssH) * 1.4) continue;
    c.moveTo(px + rr, py);
    c.arc(px, py, rr, 0, Math.PI * 2);
  }
  c.stroke();

  c.fillStyle = pal.faint;
  c.font = '10px ui-monospace, Menlo, Consolas, monospace';
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  let lastY = -1e9;
  for (const r of rings) {
    const rr = r.r * zoom;
    if (rr < 22) continue;
    const ly = py - rr;
    if (ly < 12 || ly > cssH - 4) continue;
    if (Math.abs(ly - lastY) < 11) continue; // rings crowd near the centre
    lastY = ly;
    c.fillText(r.label, px - 4, ly);
  }
}

/**
 * Interdiction is a per-region tax, so it shades the region's radial band.
 * The multiplier is written out: a red wash on its own tells a colour-blind
 * player nothing, and tells everyone else nothing quantitative.
 */
function drawInterdiction(c: CanvasRenderingContext2D, s: Sim): void {
  const [px, py] = sunScreen();
  c.setLineDash([]);
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.font = '10px ui-monospace, Menlo, Consolas, monospace';
  for (const [id, band] of regionBand) {
    const I = s.state.interdiction[id] ?? 0;
    if (!(I > 0.02)) continue;
    const r0 = band.r0 * zoom;
    const r1 = band.r1 * zoom;
    const mid = (r0 + r1) / 2;
    const w = Math.max(3, Math.min(r1 - r0, Math.hypot(cssW, cssH)));
    if (mid - w / 2 > Math.hypot(cssW, cssH)) continue;
    c.globalAlpha = Math.min(0.16, 0.05 + I * 0.05);
    c.strokeStyle = pal.red;
    c.lineWidth = w;
    c.beginPath();
    c.arc(px, py, Math.max(1, mid), 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;

    // Label on the up-left diagonal, where routes are least likely to sit.
    const a = -2.36;
    const lx = px + Math.cos(a) * mid;
    const ly = py + Math.sin(a) * mid;
    if (lx < -80 || lx > cssW + 80 || ly < -20 || ly > cssH + 20) continue;
    const mult = 1 / (1 + I);
    c.fillStyle = pal.red;
    c.fillText(`${regionLabel(id)} interdicted ×${mult.toFixed(2)}`, lx + 6, ly);
  }
}

/**
 * Six style buckets — three kinds crossed with viable/not — and one path each.
 * Setting strokeStyle and the dash per route is what makes a 500-route network
 * expensive; the geometry itself is nothing.
 */
function drawRoutes(c: CanvasRenderingContext2D, s: Sim): void {
  const routes = s.state.routes;
  if (!routes.length) return;
  for (let b = 0; b < 6; b++) {
    const kind = KINDS[b % 3]!;
    const viable = b < 3;
    let started = false;
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i]!;
      if (r.kind !== kind) continue;
      const cache = s.caches[i];
      const ok = cache ? cache.viable : false;
      if (ok !== viable) continue;
      const ia = fullIndex.get(r.from);
      const ib = fullIndex.get(r.to);
      if (ia === undefined || ib === undefined) continue;
      if (!started) {
        c.beginPath();
        started = true;
      }
      c.moveTo(sx[ia]!, sy[ia]!);
      c.lineTo(sx[ib]!, sy[ib]!);
    }
    if (!started) continue;
    c.setLineDash(viable ? kindDash(kind) : [1, 4]);
    c.strokeStyle = kindColor(kind);
    c.globalAlpha = viable ? 0.75 : 0.28;
    c.lineWidth = viable ? 1.4 : 1;
    c.stroke();
  }
  c.setLineDash([]);
  c.globalAlpha = 1;
}

function drawShips(c: CanvasRenderingContext2D, s: Sim, still: boolean): void {
  for (let k = 0; k < 3; k++) {
    shipX[k]!.length = 0;
    shipY[k]!.length = 0;
  }
  const routes = s.state.routes;
  let total = 0;
  for (let i = 0; i < routes.length && total < SHIPS_TOTAL; i++) {
    const r = routes[i]!;
    const cache = s.caches[i];
    if (!cache || !cache.viable || cache.rtt <= 0) continue;
    const ia = fullIndex.get(r.from);
    const ib = fullIndex.get(r.to);
    if (ia === undefined || ib === undefined) continue;
    const ax = sx[ia]!;
    const ay = sy[ia]!;
    const bx = sx[ib]!;
    const by = sy[ib]!;
    if (Math.abs(ax - bx) + Math.abs(ay - by) < 4) continue;

    const owned = r.ships.toNumber();
    // Ship counts run to absurd numbers; the dot count is a log of them and
    // then hard-capped, because past a dozen the line just reads as a line.
    const n = isFinite(owned)
      ? clamp(Math.round(Math.log10(owned + 1) * 3) + 1, 1, SHIPS_PER_ROUTE)
      : SHIPS_PER_ROUTE;
    const k = r.kind === 'trade' ? 0 : r.kind === 'science' ? 1 : 2;
    const base = ((r.phase + (still ? 0 : extraSim)) / cache.rtt) % 1;
    for (let j = 0; j < n && total < SHIPS_TOTAL; j++) {
      let t = base + j / n;
      t -= Math.floor(t);
      // The far half of the round trip is the return leg, drawn coming back.
      const u = t < 0.5 ? t * 2 : 2 - t * 2;
      const px = ax + (bx - ax) * u;
      const py = ay + (by - ay) * u;
      if (px < -8 || px > cssW + 8 || py < -8 || py > cssH + 8) continue;
      shipX[k]!.push(px);
      shipY[k]!.push(py);
      total++;
    }
  }
  for (let k = 0; k < 3; k++) {
    const xs = shipX[k]!;
    if (!xs.length) continue;
    const ys = shipY[k]!;
    c.fillStyle = kindColor(KINDS[k]!);
    for (let i = 0; i < xs.length; i++) c.fillRect(xs[i]! - 1, ys[i]! - 1, 2.2, 2.2);
  }
}

function drawCloud(c: CanvasRenderingContext2D): void {
  if (!cloudDrawn) return;
  c.fillStyle = pal.faint;
  c.globalAlpha = 0.5;
  for (let i = 0; i < cloudDrawn; i++) c.fillRect(cloudSX[i]!, cloudSY[i]!, 1.4, 1.4);
  c.globalAlpha = 1;
}

/**
 * Fill is the surveyed/unsurveyed channel — filled disc versus hollow ring —
 * so the distinction survives on a monochrome display.
 */
function drawNodes(c: CanvasRenderingContext2D, s: Sim): void {
  const n = full.length;
  if (!n) return;
  const era = s.state.era;
  const rad = era === 1 ? 3.4 : 2.8;

  c.beginPath();
  for (let i = 0; i < n; i++) {
    if (!isSurveyed[i]) continue;
    const px = sx[i]!;
    const py = sy[i]!;
    if (px < -10 || px > cssW + 10 || py < -10 || py > cssH + 10) continue;
    c.moveTo(px + rad, py);
    c.arc(px, py, rad, 0, Math.PI * 2);
  }
  c.fillStyle = pal.ink;
  c.fill();

  c.beginPath();
  for (let i = 0; i < n; i++) {
    if (isSurveyed[i]) continue;
    const px = sx[i]!;
    const py = sy[i]!;
    if (px < -10 || px > cssW + 10 || py < -10 || py > cssH + 10) continue;
    c.moveTo(px + rad, py);
    c.arc(px, py, rad, 0, Math.PI * 2);
  }
  c.strokeStyle = pal.dim;
  c.lineWidth = 1.2;
  c.setLineDash([]);
  c.stroke();

  if (hoverIdx >= 0 && hoverIdx < n) {
    c.beginPath();
    c.arc(sx[hoverIdx]!, sy[hoverIdx]!, rad + 4.5, 0, Math.PI * 2);
    c.strokeStyle = pal.amberHi;
    c.lineWidth = 1.4;
    c.stroke();
  }
}

function drawLabels(c: CanvasRenderingContext2D, s: Sim): void {
  const era = s.state.era;
  c.font = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  c.textAlign = 'left';
  c.textBaseline = 'middle';

  // Past a couple of hundred markers the labels are a grey smear, so they are
  // spent on what the player has actually surveyed and only when there is room.
  const labelAll = era === 1 || full.length <= 90 || zoom > 2.5;
  c.fillStyle = pal.dim;
  for (let i = 0; i < full.length; i++) {
    if (!labelAll && !isSurveyed[i]) continue;
    const px = sx[i]!;
    const py = sy[i]!;
    if (px < -60 || px > cssW + 10 || py < -10 || py > cssH + 10) continue;
    c.fillText(full[i]!.short, px + 6, py - 6);
  }

  if (era === 1) {
    c.fillStyle = pal.faint;
    c.font = '10px ui-monospace, Menlo, Consolas, monospace';
    const [px, py] = sunScreen();
    for (const gl of groupLabels) {
      const rr = gl.r * zoom + 16;
      const lx = px + Math.cos(gl.angle) * rr;
      const ly = py + Math.sin(gl.angle) * rr;
      if (lx < -40 || lx > cssW + 40 || ly < -10 || ly > cssH + 10) continue;
      c.fillText(gl.text, lx, ly);
    }
  }
}

// ----------------------------------------------------------- interaction ---

function hitTest(px: number, py: number): number {
  let best = -1;
  let bestD = HIT_PX * HIT_PX;
  for (let i = 0; i < full.length; i++) {
    const dx = sx[i]! - px;
    const dy = sy[i]! - py;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function showTip(i: number, px: number, py: number): void {
  if (!tip || !wrap) return;
  const n = full[i];
  if (!n) return;
  const surveyed = isSurveyed[i] === 1;
  const status = surveyed
    ? '<span class="map-tip-ok">Surveyed</span>'
    : `Unsurveyed — survey ${esc(fmt(n.surveyCost))}`;
  tip.innerHTML =
    `<strong>${esc(n.name)}</strong>`
    + `<span class="map-tip-region">${esc(regionLabel(n.region))}</span>`
    + `<span class="map-tip-status">${status}</span>`
    + '<span class="map-tip-hint">Click to open in Network</span>';
  setClass(tip, 'is-on', true);
  // Flip the tip to the other side of the cursor near the right/bottom edge,
  // measured after the content is in so the size is the real one.
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const left = px + 14 + tw > cssW ? px - 14 - tw : px + 14;
  const top = py + 12 + th > cssH ? py - 12 - th : py + 12;
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${Math.max(0, top)}px`;
}

function hideTip(): void {
  if (tip) setClass(tip, 'is-on', false);
}

function setHover(i: number, px: number, py: number): void {
  if (i !== hoverIdx) {
    hoverIdx = i;
    needsDraw = true;
  }
  if (i >= 0) showTip(i, px, py);
  else hideTip();
  if (canvas) canvas.style.cursor = i >= 0 ? 'pointer' : dragging ? 'grabbing' : 'grab';
}

function zoomAbout(px: number, py: number, factor: number): void {
  const next = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (next === zoom) return;
  // Keep the world point under the cursor pinned.
  const worldX = (px - cssW / 2) / zoom - panX;
  const worldY = (py - cssH / 2) / zoom - panY;
  zoom = next;
  panX = (px - cssW / 2) / zoom - worldX;
  panY = (py - cssH / 2) / zoom - worldY;
  clampPan();
  viewDirty = true;
  needsDraw = true;
}

function clampPan(): void {
  const lim = baseR * 4;
  panX = clamp(panX, -lim, lim);
  panY = clamp(panY, -lim, lim);
}

function resetView(): void {
  zoom = 1;
  panX = 0;
  panY = 0;
  viewDirty = true;
  needsDraw = true;
}

function localPoint(e: { clientX: number; clientY: number }): [number, number] {
  const el2 = canvas;
  if (!el2) return [0, 0];
  const r = el2.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function wireEvents(): void {
  const cv = canvas;
  if (!cv) return;

  cv.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const [px, py] = localPoint(e);
    zoomAbout(px, py, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  }, { passive: false });

  cv.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    dragMoved = false;
    const [px, py] = localPoint(e);
    dragX = px;
    dragY = py;
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = 'grabbing';
  });

  cv.addEventListener('pointermove', (e: PointerEvent) => {
    const [px, py] = localPoint(e);
    pointerX = px;
    pointerY = py;
    if (dragging) {
      const dx = px - dragX;
      const dy = py - dragY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
      dragX = px;
      dragY = py;
      panX += dx / zoom;
      panY += dy / zoom;
      clampPan();
      viewDirty = true;
      needsDraw = true;
      hideTip();
      return;
    }
    setHover(hitTest(px, py), px, py);
  });

  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
    cv.style.cursor = hoverIdx >= 0 ? 'pointer' : 'grab';
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  cv.addEventListener('pointerleave', () => {
    pointerX = -1;
    pointerY = -1;
    setHover(-1, 0, 0);
  });

  on(cv, 'click', (e) => {
    if (dragMoved) return; // a pan that happened to end over a node is not a click
    const [px, py] = localPoint(e as MouseEvent);
    const i = hitTest(px, py);
    const n = i >= 0 ? full[i] : undefined;
    if (!n || !uctx) return;
    uctx.focusNode(n.id);
    uctx.goTo('network');
  });

  on(cv, 'keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    const step = 60 / zoom;
    if (k === 'ArrowLeft') panX += step;
    else if (k === 'ArrowRight') panX -= step;
    else if (k === 'ArrowUp') panY += step;
    else if (k === 'ArrowDown') panY -= step;
    else if (k === '+' || k === '=') zoomAbout(cssW / 2, cssH / 2, ZOOM_STEP);
    else if (k === '-' || k === '_') zoomAbout(cssW / 2, cssH / 2, 1 / ZOOM_STEP);
    else if (k === '0') resetView();
    else return; // every other key, Tab included, falls through: no keyboard trap
    e.preventDefault();
    clampPan();
    viewDirty = true;
    needsDraw = true;
  });
}

// --------------------------------------------------------------- sizing ----

function resize(): void {
  const w = wrap;
  const cv = canvas;
  if (!w || !cv) return;
  const r = w.getBoundingClientRect();
  const nw = Math.max(1, Math.round(r.width));
  const nh = Math.max(1, Math.round(r.height));
  const nd = Math.min(2.5, window.devicePixelRatio || 1);
  if (nw === cssW && nh === cssH && nd === dpr) return;
  cssW = nw;
  cssH = nh;
  dpr = nd;
  cv.width = Math.round(nw * nd);
  cv.height = Math.round(nh * nd);
  // Layout radii are expressed in CSS px, so a resize invalidates the layout,
  // not just the projection.
  baseR = Math.min(nw, nh) * 0.44;
  layoutDirty = true;
  needsDraw = true;
}

// ----------------------------------------------------------------- loop ----

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  const dt = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  // With motion off there is nothing to animate, so the loop idles until
  // something actually changes.
  if (reducedMotion() && !needsDraw && !layoutDirty && !viewDirty) return;
  needsDraw = false;
  draw(dt);
}

function startLoop(): void {
  if (raf) return;
  lastFrame = 0;
  raf = requestAnimationFrame(frame);
}

function stopLoop(): void {
  if (!raf) return;
  cancelAnimationFrame(raf);
  raf = 0;
}

// --------------------------------------------------------------- legend ----

function legendItem(label: string, swatch: string): HTMLElement {
  const item = el('div', 'map-legend-item');
  item.innerHTML = `${swatch}<span>${esc(label)}</span>`;
  return item;
}

function dashSwatch(color: string, dash: string, opacity = 1): string {
  return `<svg class="map-swatch" width="26" height="10" viewBox="0 0 26 10" aria-hidden="true" focusable="false">`
    + `<path d="M1 5h24" stroke="${color}" stroke-width="1.6" fill="none"`
    + (dash ? ` stroke-dasharray="${dash}"` : '')
    + ` opacity="${opacity}"/></svg>`;
}

function dotSwatch(fill: boolean): string {
  return '<svg class="map-swatch" width="26" height="10" viewBox="0 0 26 10" aria-hidden="true" focusable="false">'
    + `<circle cx="13" cy="5" r="3.2" fill="${fill ? 'currentColor' : 'none'}" `
    + 'stroke="currentColor" stroke-width="1.2"/></svg>';
}

function buildLegend(): HTMLElement {
  const box = el('div', 'map-legend');
  box.append(
    legendItem('Trade (solid)', dashSwatch('var(--amber, #eab558)', '')),
    legendItem('Science (dashed)', dashSwatch('var(--teal, #63c2c9)', '7 4')),
    legendItem('Military (dotted)', dashSwatch('var(--steel, #7f9bb5)', '2 3')),
    legendItem('Not viable', dashSwatch('currentColor', '1 4', 0.4)),
    legendItem('Surveyed', dotSwatch(true)),
    legendItem('Unsurveyed', dotSwatch(false)),
    legendItem('Interdicted band', dashSwatch('var(--red, #d9635b)', '', 0.55)),
  );
  return box;
}

// ----------------------------------------------------------------- view ----

export const mapView: View = {
  id: 'map',
  label: 'Map',
  icon: 'map',

  mount(host: HTMLElement, ctx: UiCtx): void {
    root = host;
    uctx = ctx;
    sim = ctx.sim;
    readPalette();

    const panel = el('div', 'panel');
    const head = el('div', 'panel-head');
    const title = el('h2', 'panel-title');
    title.innerHTML = `${icon('map', 16)}<span>Traffic Chart</span>`;
    const actions = el('div', 'panel-actions');

    const zoomOut = button('−', 'btn btn--icon', 'Zoom out');
    const zoomIn = button('+', 'btn btn--icon', 'Zoom in');
    const reset = button('Reset view', 'btn', 'Recentre the chart and return to 1×');
    on(zoomOut, 'click', () => zoomAbout(cssW / 2, cssH / 2, 1 / ZOOM_STEP));
    on(zoomIn, 'click', () => zoomAbout(cssW / 2, cssH / 2, ZOOM_STEP));
    on(reset, 'click', () => resetView());
    actions.append(zoomOut, zoomIn, reset);
    head.append(title, actions);

    const body = el('div', 'panel-body');
    const w = el('div', 'map-wrap');
    const cv = el('canvas');
    cv.id = 'mapCanvas';
    cv.tabIndex = 0;
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label',
      'Chart of surveyed nodes and chartered routes. Arrow keys pan, plus and minus zoom. '
      + 'The route table carries the same information as text.');
    const t = el('div', 'map-tip');
    w.append(cv, t);
    body.append(w, buildLegend());
    panel.append(head, body);
    host.append(panel);

    wrap = w;
    canvas = qs<HTMLCanvasElement>(w, '#mapCanvas');
    tip = t;
    g = canvas.getContext('2d');
    canvas.style.cursor = 'grab';

    wireEvents();
    resize();
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => resize()).observe(w);
    } else {
      window.addEventListener('resize', () => resize());
    }
  },

  update(ctx: UiCtx): void {
    sim = ctx.sim;
    const s = ctx.sim;
    // Cheap structure watch: the route list, the survey list and the era are
    // the only things that change which nodes exist on the chart.
    const surveyedN = s.state.surveyed.length;
    const routesN = s.state.routes.length;
    if (s.structureVersion !== seenStructure || s.state.era !== seenEra
      || surveyedN !== seenSurveyed || routesN !== seenRoutes) {
      seenStructure = s.structureVersion;
      seenEra = s.state.era;
      seenSurveyed = surveyedN;
      seenRoutes = routesN;
      layoutDirty = true;
      hoverIdx = -1;
      hideTip();
    }
    needsDraw = true;
  },

  rebuild(ctx: UiCtx): void {
    sim = ctx.sim;
    layoutDirty = true;
    hoverIdx = -1;
    hideTip();
    needsDraw = true;
  },

  onShow(ctx: UiCtx): void {
    sim = ctx.sim;
    uctx = ctx;
    visible = true;
    readPalette();
    // The wrap has no size while the view is display:none, so the observer's
    // first measurement is worthless — take it again now that it is on screen.
    resize();
    layoutDirty = true;
    needsDraw = true;
    startLoop();
  },

  onHide(): void {
    visible = false;
    stopLoop();
    hoverIdx = -1;
    hideTip();
  },
};

/** Kept so the module's own bookkeeping is inspectable from a debugger. */
export function mapViewIsVisible(): boolean {
  return visible && root !== null && pointerX >= -1 && pointerY >= -1;
}
