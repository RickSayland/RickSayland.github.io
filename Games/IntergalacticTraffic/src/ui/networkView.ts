import { D } from '../core/num';
import { fmt, fmtInt, fmtSI, fmtMass, fmtSimTime, fmtPct } from '../core/format';
import { TIME_SCALE, C as LIGHT } from '../sim/constants';
import { getNode, nodesUpToEra, regionLabel, REGIONS } from '../sim/nodes';
import { routeCap } from '../sim/engine';
import { emptyCache, solveRoute } from '../sim/routeMath';
import {
  survey, charter, charterCost, canCharter, isSurveyed, availableClasses,
} from '../sim/actions';
import { makeRoute } from '../sim/state';
import { clear, el, on, qs, setAttr, setClass, setText, button } from './dom';
import type { UiCtx, View } from './ctx';
import type { RouteKind, WorldNode } from '../sim/types';

const PAGE = 24;

interface CardRefs {
  card: HTMLElement;
  nodeId: string;
  name: HTMLElement;
  meta: HTMLElement;
  flavor: HTMLElement;
  action: HTMLButtonElement;
  status: HTMLElement;
}

const ui = {
  search: '',
  region: 'all',
  show: 'unsurveyed' as 'all' | 'surveyed' | 'unsurveyed',
  page: 0,
  from: '',
  to: '',
  kind: 'trade' as RouteKind,
  hull: '',
};

let grid: HTMLElement;
let cards: CardRefs[] = [];
let pagerLabel: HTMLElement;
let headLine: HTMLElement;
let regionSel: HTMLSelectElement;
let fromSel: HTMLSelectElement;
let toSel: HTMLSelectElement;
let hullSel: HTMLSelectElement;
let kindSeg: HTMLElement;
let previewBox: HTMLElement;
let fileBtn: HTMLButtonElement;
let charterHint: HTMLElement;
let filtered: WorldNode[] = [];
let lastSig = '';

const previewCache = emptyCache();

const HTML = `
<div class="panel">
  <div class="panel-head">
    <h2 class="panel-title">File a charter</h2>
    <div class="panel-actions"><span class="hint" id="nwCharterHint"></span></div>
  </div>
  <div class="panel-body">
    <div class="toolbar">
      <div class="field">
        <label for="nwFrom">Origin</label>
        <select id="nwFrom"></select>
      </div>
      <div class="field">
        <label for="nwTo">Destination</label>
        <select id="nwTo"></select>
      </div>
      <div class="field">
        <span id="nwKindTitle">Kind</span>
        <div class="seg" role="group" aria-labelledby="nwKindTitle" id="nwKind">
          <button type="button" class="seg-btn is-active" data-kind="trade" aria-pressed="true">Trade</button>
          <button type="button" class="seg-btn" data-kind="science" aria-pressed="false">Science</button>
          <button type="button" class="seg-btn" data-kind="military" aria-pressed="false">Military</button>
        </div>
      </div>
      <div class="field">
        <label for="nwHull">Hull class</label>
        <select id="nwHull"></select>
      </div>
      <button type="button" class="btn btn-primary" id="nwFile">File charter</button>
    </div>
    <div class="kv" id="nwPreview"></div>
    <p class="panel-note">
      Trade carries credits. Science yields Research, and from the third era exotic matter as well.
      Military yields Security, which is the only thing that holds Interdiction down — and Interdiction
      is a multiplicative penalty on everything else in the region. A network of nothing but trade
      routes converges on paying most of its income to nobody.
    </p>
  </div>
</div>

<div class="panel">
  <div class="panel-head">
    <h2 class="panel-title">Endpoints</h2>
    <div class="panel-actions">
      <span class="hint" id="nwCount"></span>
      <button type="button" class="btn btn-sm" id="nwSurveyCheap">Survey the cheapest affordable</button>
    </div>
  </div>
  <div class="panel-body">
    <div class="toolbar">
      <div class="field">
        <label for="nwSearch">Search</label>
        <input type="search" id="nwSearch" placeholder="endpoint name" autocomplete="off">
      </div>
      <div class="field">
        <label for="nwRegion">Region</label>
        <select id="nwRegion"><option value="all">All regions</option></select>
      </div>
      <div class="field">
        <span id="nwShowTitle">Show</span>
        <div class="seg" role="group" aria-labelledby="nwShowTitle" id="nwShow">
          <button type="button" class="seg-btn" data-show="all" aria-pressed="false">All</button>
          <button type="button" class="seg-btn is-active" data-show="unsurveyed" aria-pressed="true">Unsurveyed</button>
          <button type="button" class="seg-btn" data-show="surveyed" aria-pressed="false">Surveyed</button>
        </div>
      </div>
    </div>
    <div class="node-grid" id="nwGrid"></div>
    <div class="toolbar">
      <button type="button" class="btn btn-sm" id="nwPrev">Previous</button>
      <span class="hint" id="nwPager"></span>
      <button type="button" class="btn btn-sm" id="nwNext">Next</button>
    </div>
  </div>
</div>`;

function applyFilter(ctx: UiCtx): void {
  const sim = ctx.sim;
  const all = nodesUpToEra(sim.state.era);
  const q = ui.search.toLowerCase();
  filtered = all.filter((n) => {
    if (ui.region !== 'all' && n.region !== ui.region) return false;
    const done = isSurveyed(sim, n.id);
    if (ui.show === 'surveyed' && !done) return false;
    if (ui.show === 'unsurveyed' && done) return false;
    if (q && !(`${n.name} ${n.short} ${regionLabel(n.region)}`.toLowerCase().includes(q))) return false;
    return true;
  });
  // Cheapest first: the survey ladder IS the progression, so the next thing
  // the player can afford should always be the next thing on the page.
  filtered.sort((a, b) => (a.surveyCost.lt(b.surveyCost) ? -1 : a.surveyCost.gt(b.surveyCost) ? 1 : 0));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  if (ui.page >= pages) ui.page = pages - 1;
}

function makeCard(ctx: UiCtx): CardRefs {
  const card = el('div', 'node-card');
  const name = el('div', 'node-name');
  const meta = el('div', 'node-meta');
  const flavor = el('div', 'node-flavor');
  const status = el('div', 'node-meta');
  const action = button('Survey', 'btn btn-sm');
  const route = button('Route here', 'btn btn-sm btn-ghost');
  const acts = el('div', 'toolbar');
  acts.append(action, route);
  card.append(name, meta, flavor, status, acts);

  const refs: CardRefs = { card, nodeId: '', name, meta, flavor, action, status };

  on(action, 'click', () => {
    const res = survey(ctx.sim, refs.nodeId);
    if (!res.ok) ctx.toast(res.why, 'bad');
    else {
      const n = getNode(refs.nodeId);
      ctx.toast(`${n?.name ?? refs.nodeId} surveyed and entered on the register.`, 'good');
      ctx.invalidate();
    }
  });
  on(route, 'click', () => {
    ui.to = refs.nodeId;
    syncCharterForm(ctx);
    toSel.focus();
  });

  return refs;
}

function paintCards(ctx: UiCtx): void {
  const sim = ctx.sim;
  const start = ui.page * PAGE;
  const slice = filtered.slice(start, start + PAGE);
  const sig = `${slice.map((n) => n.id).join(',')}|${sim.structureVersion}`;
  const structural = sig !== lastSig;
  if (structural) lastSig = sig;

  while (cards.length < slice.length) {
    const c = makeCard(ctx);
    cards.push(c);
    grid.append(c.card);
  }

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]!;
    const n = slice[i];
    if (!n) {
      c.card.hidden = true;
      c.nodeId = '';
      continue;
    }
    c.card.hidden = false;
    c.nodeId = n.id;
    const done = isSurveyed(sim, n.id);
    if (structural) {
      setText(c.name, n.name);
      setText(c.flavor, n.flavor);
      setText(c.meta, [
        regionLabel(n.region),
        `Δv ${fmtSI(n.dv, 'm/s')} from LEO`,
        `${fmtSI(n.dist, 'm')} from Sol`,
        `value ×${n.valueMult.toPrecision(3)}`,
        `research ×${n.researchMult.toPrecision(3)}`,
        `hazard ${fmtPct(n.hazard, 0)}`,
      ].join(' · '));
    }
    setClass(c.card, 'is-surveyed', done);
    setClass(c.card, 'is-locked', !done && sim.state.credits.lt(n.surveyCost));
    setText(c.status, done ? 'SURVEYED — available as an endpoint' : `Survey fee ${fmt(n.surveyCost)}`);
    c.action.disabled = done || sim.state.credits.lt(n.surveyCost);
    setText(c.action, done ? 'On the register' : `Survey — ${fmt(n.surveyCost)}`);
    setAttr(c.action, 'aria-label', done ? `${n.name} already surveyed` : `Survey ${n.name} for ${fmt(n.surveyCost)} credits`);
    setClass(c.action, 'is-affordable', !done && sim.state.credits.gte(n.surveyCost));
  }
}

// ------------------------------------------------------------- charter -----

function syncCharterForm(ctx: UiCtx): void {
  const sim = ctx.sim;
  const surveyed = sim.state.surveyed
    .map((id) => getNode(id))
    .filter((n): n is WorldNode => !!n)
    .sort((a, b) => a.dist - b.dist);

  for (const [sel, key] of [[fromSel, 'from'], [toSel, 'to']] as const) {
    const want = surveyed.map((n) => n.id).join(',');
    if (sel.dataset.sig !== want) {
      sel.dataset.sig = want;
      clear(sel);
      for (const n of surveyed) {
        const o = el('option', '', `${n.short} — ${regionLabel(n.region)}`);
        o.value = n.id;
        sel.append(o);
      }
    }
    const cur = key === 'from' ? ui.from : ui.to;
    if (cur && surveyed.some((n) => n.id === cur)) sel.value = cur;
    else if (surveyed.length) {
      const fallback = key === 'from' ? surveyed[0]!.id : (surveyed[1] ?? surveyed[0])!.id;
      sel.value = fallback;
      if (key === 'from') ui.from = fallback;
      else ui.to = fallback;
    }
  }

  const classes = availableClasses(sim);
  const sig = classes.map((c) => c.id).join(',');
  if (hullSel.dataset.sig !== sig) {
    hullSel.dataset.sig = sig;
    clear(hullSel);
    for (const c of classes) {
      const o = el('option', '', c.name);
      o.value = c.id;
      hullSel.append(o);
    }
  }
  if (!classes.some((c) => c.id === ui.hull)) ui.hull = classes[0]?.id ?? 'lighter';
  hullSel.value = ui.hull;

  paintPreview(ctx);
}

/**
 * Solve the route the player is about to file, before they file it. A charter
 * is a real cost and the numbers that decide whether it is worth paying are
 * already computable, so there is no reason to make them guess.
 */
function paintPreview(ctx: UiCtx): void {
  const sim = ctx.sim;
  clear(previewBox);
  const a = getNode(ui.from);
  const b = getNode(ui.to);
  const row = (k: string, v: string): void => {
    const r = el('div', 'kv-row');
    r.append(el('div', 'kv-k', k), el('div', 'kv-v', v));
    previewBox.append(r);
  };

  if (!a || !b || a.id === b.id) {
    row('Preview', 'Choose two distinct surveyed endpoints.');
    fileBtn.disabled = true;
    return;
  }

  const probe = makeRoute(a.id, b.id, ui.kind, ui.hull);
  probe.ships = D(1);
  solveRoute(probe, a, b, sim.mods, sim.state.era, previewCache);
  const c = previewCache;
  const fee = charterCost(a.id, b.id);
  const check = canCharter(sim, a.id, b.id);

  row('Filing fee', fmt(fee));
  row('Δv', fmtSI(c.deltaV, 'm/s'));
  row('Distance', fmtSI(c.distance, 'm'));
  row('Payload per hull', c.payloadFraction > 0 ? fmtMass(c.payloadPerShip) : 'none at this Δv');
  row('Round trip', fmtSimTime(c.rtt));
  if (sim.state.era === 1) row('Transfer window', `${fmtPct(c.duty)} of the cycle`);
  if (sim.state.era >= 2) row('Velocity', `${(c.velocity / LIGHT).toFixed(3)} c`);
  row('Income at one hull', `${fmt(c.rate.mul(TIME_SCALE))} credits/s`);
  if (c.research.gt(0)) row('Research at one hull', `${fmt(c.research.mul(TIME_SCALE))} /s`);
  if (c.security.gt(0)) row('Security at one hull', `${fmt(c.security.mul(TIME_SCALE))} /s`);
  if (c.note) row('Note', c.note);
  if (!check.ok) row('Blocked', check.why);

  fileBtn.disabled = !check.ok;
  setClass(fileBtn, 'is-affordable', check.ok);
}

// ---------------------------------------------------------------- view -----

export const networkView: View = {
  id: 'network',
  label: 'Network',
  icon: 'network',

  mount(root: HTMLElement, ctx: UiCtx): void {
    root.innerHTML = HTML;
    grid = qs(root, '#nwGrid');
    pagerLabel = qs(root, '#nwPager');
    headLine = qs(root, '#nwCount');
    regionSel = qs<HTMLSelectElement>(root, '#nwRegion');
    fromSel = qs<HTMLSelectElement>(root, '#nwFrom');
    toSel = qs<HTMLSelectElement>(root, '#nwTo');
    hullSel = qs<HTMLSelectElement>(root, '#nwHull');
    kindSeg = qs(root, '#nwKind');
    previewBox = qs(root, '#nwPreview');
    fileBtn = qs<HTMLButtonElement>(root, '#nwFile');
    charterHint = qs(root, '#nwCharterHint');

    const search = qs<HTMLInputElement>(root, '#nwSearch');
    on(search, 'input', () => {
      ui.search = search.value.trim();
      ui.page = 0;
      lastSig = '';
    });
    on(regionSel, 'change', () => {
      ui.region = regionSel.value;
      ui.page = 0;
      lastSig = '';
    });
    on(qs(root, '#nwShow'), 'click', (e) => {
      const t = (e.target as HTMLElement).closest('.seg-btn') as HTMLElement | null;
      if (!t) return;
      ui.show = (t.dataset.show ?? 'all') as typeof ui.show;
      ui.page = 0;
      lastSig = '';
      for (const b of Array.from(t.parentElement!.children)) {
        setClass(b, 'is-active', b === t);
        setAttr(b, 'aria-pressed', b === t ? 'true' : 'false');
      }
    });
    on(qs(root, '#nwPrev'), 'click', () => {
      ui.page = Math.max(0, ui.page - 1);
      lastSig = '';
    });
    on(qs(root, '#nwNext'), 'click', () => {
      ui.page++;
      lastSig = '';
    });

    on(qs(root, '#nwSurveyCheap'), 'click', () => {
      const sim = ctx.sim;
      const next = nodesUpToEra(sim.state.era)
        .filter((n) => !isSurveyed(sim, n.id) && sim.state.credits.gte(n.surveyCost))
        .sort((a, b) => (a.surveyCost.lt(b.surveyCost) ? -1 : 1))[0];
      if (!next) {
        ctx.toast('Nothing on the register is affordable yet.', 'info');
        return;
      }
      const res = survey(sim, next.id);
      if (!res.ok) ctx.toast(res.why, 'bad');
      else {
        ctx.toast(`${next.name} surveyed.`, 'good');
        ctx.invalidate();
      }
    });

    on(fromSel, 'change', () => {
      ui.from = fromSel.value;
      paintPreview(ctx);
    });
    on(toSel, 'change', () => {
      ui.to = toSel.value;
      paintPreview(ctx);
    });
    on(hullSel, 'change', () => {
      ui.hull = hullSel.value;
      paintPreview(ctx);
    });
    on(kindSeg, 'click', (e) => {
      const t = (e.target as HTMLElement).closest('.seg-btn') as HTMLElement | null;
      if (!t) return;
      ui.kind = (t.dataset.kind ?? 'trade') as RouteKind;
      for (const b of Array.from(kindSeg.children)) {
        setClass(b, 'is-active', b === t);
        setAttr(b, 'aria-pressed', b === t ? 'true' : 'false');
      }
      paintPreview(ctx);
    });

    on(fileBtn, 'click', () => {
      const res = charter(ctx.sim, ui.from, ui.to, ui.kind, ui.hull);
      if (!res.ok) {
        ctx.toast(res.why, 'bad');
        return;
      }
      ctx.toast('Charter filed. It carries nothing until you crew it.', 'good');
      ctx.invalidate();
      ctx.goTo('routes');
    });

    this.rebuild?.(ctx);
  },

  rebuild(ctx: UiCtx): void {
    const want = REGIONS.filter((r) => r.era <= ctx.sim.state.era);
    if (regionSel.options.length !== want.length + 1) {
      clear(regionSel);
      const all = el('option', '', 'All regions');
      all.value = 'all';
      regionSel.append(all);
      for (const r of want) {
        const o = el('option', '', r.label);
        o.value = r.id;
        regionSel.append(o);
      }
      regionSel.value = ui.region;
    }
    lastSig = '';
    syncCharterForm(ctx);
  },

  onShow(ctx: UiCtx): void {
    syncCharterForm(ctx);
  },

  update(ctx: UiCtx): void {
    const sim = ctx.sim;
    applyFilter(ctx);
    paintCards(ctx);
    const total = nodesUpToEra(sim.state.era).length;
    setText(headLine, `${sim.state.surveyed.length} of ${fmtInt(total)} endpoints on the register`);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
    setText(pagerLabel, `${fmtInt(filtered.length)} listed · page ${ui.page + 1} of ${pages}`);
    setText(charterHint, `${sim.state.routes.length} of ${routeCap(sim)} charters filed`);
  },
};

/** Called by the map when the player clicks an endpoint. */
export function focusNetworkNode(id: string): void {
  ui.to = id;
  ui.search = '';
  ui.page = 0;
  lastSig = '';
}
