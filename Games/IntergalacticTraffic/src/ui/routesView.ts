import { D, safeLog10, type Decimal } from '../core/num';
import { fmt, fmtInt, fmtSI, fmtMass, fmtSimTime, fmtPct } from '../core/format';
import { TIME_SCALE, ERA_NAMES, C as LIGHT } from '../sim/constants';
import { getNode, regionLabel, REGIONS } from '../sim/nodes';
import { routeCap, ensureFresh, type Sim } from '../sim/engine';
import { shipClass } from '../sim/data/ships';
import {
  buyShips, buyShipsMax, buyTier, dissolve, nextShipPrice, nextTierPrice,
  setVelocity, setKind, setShipClass, toggleAuto, upgradeAllAffordable,
  availableClasses,
} from '../sim/actions';
import { optimalBeta } from '../sim/routeMath';
import { clear, el, on, qs, setAttr, setClass, setText, button, esc } from './dom';
import type { UiCtx, View } from './ctx';
import type { RouteKind, RouteState } from '../sim/types';

type SortKey = 'income' | 'name' | 'ships' | 'cycle' | 'payload' | 'dv';

const PAGE = 50;

interface RowRefs {
  tr: HTMLTableRowElement;
  routeId: string;
  name: HTMLElement;
  sub: HTMLElement;
  ships: HTMLElement;
  shipsSub: HTMLElement;
  payload: HTMLElement;
  payloadSub: HTMLElement;
  cycleFill: HTMLElement;
  cycleLabel: HTMLElement;
  cycleSub: HTMLElement;
  income: HTMLElement;
  incomeSub: HTMLElement;
  dv: HTMLElement;
  dvSub: HTMLElement;
  buy1: HTMLButtonElement;
  buy10: HTMLButtonElement;
  buyMax: HTMLButtonElement;
  autoBtn: HTMLButtonElement;
}

const state = {
  sort: 'income' as SortKey,
  desc: true,
  search: '',
  kind: 'all' as RouteKind | 'all',
  region: 'all',
  hideDead: false,
  page: 0,
  selected: '' as string,
};

let rows: RowRefs[] = [];
let visible: number[] = [];
let tbody: HTMLTableSectionElement;
let pagerLabel: HTMLElement;
let countLabel: HTMLElement;
let detailBody: HTMLElement;
let regionSelect: HTMLSelectElement;
let lastStructure = -1;

function perReal(d: Decimal): Decimal {
  return d.mul(TIME_SCALE);
}

function routeLabel(r: RouteState): string {
  const a = getNode(r.from);
  const b = getNode(r.to);
  return `${a ? a.short : r.from} → ${b ? b.short : r.to}`;
}

function matchesFilter(sim: Sim, i: number): boolean {
  const r = sim.state.routes[i];
  const c = sim.caches[i];
  // The engine keeps caches parallel to routes and `ensureFresh` runs before
  // any read, so a hole here means a bug upstream. Skip the row rather than
  // taking the whole table down with it.
  if (!r || !c) return false;
  if (state.kind !== 'all' && r.kind !== state.kind) return false;
  if (state.hideDead && !c.viable) return false;
  if (state.region !== 'all') {
    const a = getNode(r.from);
    const b = getNode(r.to);
    if (a?.region !== state.region && b?.region !== state.region) return false;
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    const a = getNode(r.from);
    const b = getNode(r.to);
    const hay = `${a?.name ?? ''} ${b?.name ?? ''} ${a?.short ?? ''} ${b?.short ?? ''} ${r.kind}`;
    if (!hay.toLowerCase().includes(q)) return false;
  }
  return true;
}

function sortValue(sim: Sim, i: number): number {
  const r = sim.state.routes[i];
  const c = sim.caches[i];
  if (!r || !c) return -Infinity;
  switch (state.sort) {
    case 'income': return safeLog10(c.rate.add(1));
    case 'ships': return safeLog10(r.ships.add(1));
    case 'cycle': return -c.rtt;
    case 'payload': return c.payloadPerShip;
    case 'dv': return -c.deltaV;
    default: return 0;
  }
}

function computeVisible(sim: Sim): void {
  visible.length = 0;
  for (let i = 0; i < sim.state.routes.length; i++) {
    if (matchesFilter(sim, i)) visible.push(i);
  }
  if (state.sort === 'name') {
    visible.sort((x, y) => {
      const a = sim.state.routes[x];
      const b = sim.state.routes[y];
      return a && b ? routeLabel(a).localeCompare(routeLabel(b)) : 0;
    });
  } else {
    visible.sort((x, y) => sortValue(sim, y) - sortValue(sim, x));
  }
  if (!state.desc) visible.reverse();
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  if (state.page >= pages) state.page = pages - 1;
}

// --------------------------------------------------------------- markup ----

const HEAD = `
<div class="panel">
  <div class="panel-head">
    <h2 class="panel-title">Active charters</h2>
    <div class="panel-actions">
      <span class="hint" id="rtCount"></span>
      <button type="button" class="btn btn-sm" id="rtBuyAll">Crew every affordable berth</button>
      <button type="button" class="btn btn-sm btn-primary" id="rtNew">File a charter</button>
    </div>
  </div>
  <div class="panel-body">
    <div class="toolbar">
      <div class="field">
        <label for="rtSearch">Search</label>
        <input type="search" id="rtSearch" placeholder="endpoint or kind" autocomplete="off">
      </div>
      <div class="field">
        <span id="rtKindLabel">Kind</span>
        <div class="seg" role="group" aria-labelledby="rtKindLabel" id="rtKind">
          <button type="button" class="seg-btn is-active" data-kind="all">All</button>
          <button type="button" class="seg-btn" data-kind="trade">Trade</button>
          <button type="button" class="seg-btn" data-kind="science">Science</button>
          <button type="button" class="seg-btn" data-kind="military">Military</button>
        </div>
      </div>
      <div class="field">
        <label for="rtRegion">Region</label>
        <select id="rtRegion"><option value="all">All regions</option></select>
      </div>
      <div class="field">
        <label for="rtHideDead">
          <input type="checkbox" id="rtHideDead"> Hide charters earning nothing
        </label>
      </div>
    </div>

    <div class="tbl-wrap">
      <table class="tbl" id="rtTable">
        <thead>
          <tr>
            <th class="sortable" data-sort="name" scope="col" aria-sort="none">Charter</th>
            <th class="sortable num" data-sort="ships" scope="col" aria-sort="none">Hulls</th>
            <th class="sortable num" data-sort="payload" scope="col" aria-sort="none">Payload / hull</th>
            <th class="sortable" data-sort="cycle" scope="col" aria-sort="none">Round trip</th>
            <th class="sortable num" data-sort="income" scope="col" aria-sort="descending">Income /s</th>
            <th class="sortable num" data-sort="dv" scope="col" aria-sort="none">Δv</th>
            <th scope="col">Tonnage</th>
          </tr>
        </thead>
        <tbody id="rtBody"></tbody>
      </table>
    </div>
    <div class="toolbar">
      <button type="button" class="btn btn-sm" id="rtPrev">Previous</button>
      <span class="hint" id="rtPager"></span>
      <button type="button" class="btn btn-sm" id="rtNext">Next</button>
    </div>
    <p class="panel-note">
      Throughput is <code>wetMass · max(0, e^(−Δv/vₑ) − structural) · hulls ÷ round-trip</code>.
      An engine upgrade is worth an order of magnitude where Δv/vₑ is large and almost nothing where it is small,
      which is why the same purchase transforms one charter and does nothing to another.
    </p>
  </div>
</div>

<div class="panel" id="rtDetailPanel">
  <div class="panel-head"><h2 class="panel-title">Charter detail</h2></div>
  <div class="panel-body" id="rtDetail"></div>
</div>`;

function makeRow(ctx: UiCtx): RowRefs {
  const tr = el('tr', 'row');
  tr.tabIndex = 0;

  const tdName = el('td');
  const name = el('div', 'cell-main');
  const sub = el('div', 'cell-sub');
  tdName.append(name, sub);

  const tdShips = el('td', 'num');
  const ships = el('div', 'cell-main');
  const shipsSub = el('div', 'cell-sub');
  tdShips.append(ships, shipsSub);

  const tdPay = el('td', 'num');
  const payload = el('div', 'cell-main');
  const payloadSub = el('div', 'cell-sub');
  tdPay.append(payload, payloadSub);

  const tdCycle = el('td');
  const bar = el('div', 'bar bar--window');
  const cycleFill = el('div', 'bar-fill');
  const cycleLabel = el('div', 'bar-label');
  bar.append(cycleFill, cycleLabel);
  const cycleSub = el('div', 'cell-sub');
  tdCycle.append(bar, cycleSub);

  const tdInc = el('td', 'num');
  const income = el('div', 'cell-main');
  const incomeSub = el('div', 'cell-sub');
  tdInc.append(income, incomeSub);

  const tdDv = el('td', 'num');
  const dv = el('div', 'cell-main');
  const dvSub = el('div', 'cell-sub');
  tdDv.append(dv, dvSub);

  const tdAct = el('td');
  const buy1 = button('+1', 'btn btn-sm');
  const buy10 = button('+10', 'btn btn-sm');
  const buyMax = button('Max', 'btn btn-sm');
  const autoBtn = button('Auto', 'btn btn-sm btn-ghost');
  tdAct.append(buy1, buy10, buyMax, autoBtn);

  tr.append(tdName, tdShips, tdPay, tdCycle, tdInc, tdDv, tdAct);

  const refs: RowRefs = {
    tr, routeId: '', name, sub, ships, shipsSub, payload, payloadSub,
    cycleFill, cycleLabel, cycleSub, income, incomeSub, dv, dvSub,
    buy1, buy10, buyMax, autoBtn,
  };

  const select = (): void => {
    state.selected = refs.routeId;
    renderDetail(ctx);
    for (const r of rows) setClass(r.tr, 'is-selected', r.routeId === state.selected);
  };
  on(tr, 'click', select);
  on(tr, 'keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select();
    }
  });

  const act = (fn: () => void) => (e: Event) => {
    e.stopPropagation();
    fn();
    select();
  };
  on(buy1, 'click', act(() => report(ctx, buyShips(ctx.sim, refs.routeId, 1))));
  on(buy10, 'click', act(() => report(ctx, buyShips(ctx.sim, refs.routeId, 10))));
  on(buyMax, 'click', act(() => report(ctx, buyShipsMax(ctx.sim, refs.routeId))));
  on(autoBtn, 'click', act(() => toggleAuto(ctx.sim, refs.routeId)));

  return refs;
}

function report(ctx: UiCtx, res: { ok: true } | { ok: false; why: string }): void {
  if (!res.ok) ctx.toast(res.why, 'bad');
}

// ------------------------------------------------------------- detail ------

function renderDetail(ctx: UiCtx): void {
  const sim = ctx.sim;
  // Reached straight from a buy button, so the caches may be a purchase behind.
  ensureFresh(sim);
  clear(detailBody);
  const i = sim.state.routes.findIndex((r) => r.id === state.selected);
  if (i < 0) {
    detailBody.append(el('p', 'empty', 'Select a charter to see how its numbers are arrived at.'));
    return;
  }
  const r = sim.state.routes[i]!;
  const c = sim.caches[i]!;
  const a = getNode(r.from);
  const b = getNode(r.to);
  const sc = shipClass(r.shipClass);
  const m = sim.mods;

  const head = el('div', 'kv');
  const kv = (k: string, v: string): void => {
    const row = el('div', 'kv-row');
    row.append(el('div', 'kv-k', k), el('div', 'kv-v', v));
    head.append(row);
  };

  kv('Charter', `${a?.name ?? r.from} → ${b?.name ?? r.to}`);
  kv('Region', `${regionLabel(a?.region ?? '')} → ${regionLabel(b?.region ?? '')}`);
  kv('Hull', `${sc.name} — ${fmtInt(r.ships)} on strength`);
  kv('Wet mass / hull', fmtMass(sc.wetMass * m.massMult));
  kv('Δv required', fmtSI(c.deltaV, 'm/s'));
  kv('Exhaust velocity', `${fmtSI(m.ve * sc.veMult, 'm/s')} (${m.engineLabel})`);
  kv('e^(−Δv/vₑ)', (Math.exp(-c.deltaV / (m.ve * sc.veMult))).toFixed(4));
  kv('− structural fraction', (sc.structural * m.structMult).toFixed(4));
  kv('= payload fraction', c.payloadFraction > 0 ? fmtPct(c.payloadFraction, 2) : 'none — the hull cannot carry itself there');
  kv('Payload / hull', fmtMass(c.payloadPerShip));
  kv('Distance', fmtSI(c.distance, 'm'));
  kv('Round trip', `${fmtSimTime(c.rtt)} (${(c.rtt / TIME_SCALE).toFixed(1)} s of play)`);
  if (sim.state.era === 1) {
    kv('Window duty', `${fmtPct(c.duty)} — ${fmtPct(m.continuity)} of the wait engineered away`);
  }
  if (sim.state.era >= 2) {
    kv('Velocity', sim.state.era === 2
      ? `${(c.velocity / LIGHT).toFixed(4)} c  (γ = ${c.gamma.toFixed(3)})`
      : `${(c.velocity / LIGHT).toFixed(2)} c apparent`);
    if (sim.state.era === 2) kv('Net of crew and fuel', fmtPct(c.netMult));
  }
  kv('Income', `${fmt(perReal(c.rate))} credits/s`);
  if (c.research.gt(0)) kv('Research', `${fmt(perReal(c.research))} /s`);
  if (c.security.gt(0)) kv('Security', `${fmt(perReal(c.security))} /s`);
  if (!c.exotic.eq(0)) kv('Exotic matter', `${fmt(perReal(c.exotic))} /s`);
  if (c.note) kv('Status', c.note);

  detailBody.append(head);

  // --- controls ---
  const controls = el('div', 'toolbar');

  const kindWrap = el('div', 'field');
  const kindTitle = el('span', '', 'Kind');
  kindTitle.id = 'rtKindTitle-' + r.id;
  kindWrap.append(kindTitle);
  const kindSeg = el('div', 'seg');
  kindSeg.setAttribute('role', 'group');
  kindSeg.setAttribute('aria-labelledby', kindTitle.id);
  for (const k of ['trade', 'science', 'military'] as RouteKind[]) {
    const btn = button(k[0]!.toUpperCase() + k.slice(1), 'seg-btn' + (r.kind === k ? ' is-active' : ''));
    on(btn, 'click', () => {
      setKind(ctx.sim, r.id, k);
      renderDetail(ctx);
    });
    kindSeg.append(btn);
  }
  kindWrap.append(kindSeg);
  controls.append(kindWrap);

  const hullWrap = el('div', 'field');
  const hullId = 'rtHull-' + r.id;
  const hullLabel = el('label', '', 'Hull class');
  hullLabel.htmlFor = hullId;
  const hullSel = el('select');
  hullSel.id = hullId;
  for (const cls of availableClasses(ctx.sim)) {
    const o = el('option', '', `${cls.name}`);
    o.value = cls.id;
    if (cls.id === r.shipClass) o.selected = true;
    hullSel.append(o);
  }
  on(hullSel, 'change', () => {
    if (hullSel.value === r.shipClass) return;
    ctx.openModal(
      'Re-hull this charter?',
      `Switching to ${esc(shipClass(hullSel.value).name)} retires the ${fmtInt(r.ships)} hulls currently on strength. `
      + 'Tonnage is fungible within a class and not across one.',
      [
        { label: 'Cancel', cls: 'btn', onClick: () => { hullSel.value = r.shipClass; } },
        {
          label: 'Re-hull',
          cls: 'btn btn-danger',
          onClick: () => {
            report(ctx, setShipClass(ctx.sim, r.id, hullSel.value));
            renderDetail(ctx);
          },
        },
      ],
    );
  });
  hullWrap.append(hullLabel, hullSel);
  controls.append(hullWrap);

  if (sim.state.era >= 2) {
    const vWrap = el('div', 'field');
    const vid = 'rtV-' + r.id;
    const label = el('label', '', sim.state.era === 2 ? 'Commanded velocity' : 'Warp factor');
    label.htmlFor = vid;
    const slider = el('input', 'slider');
    slider.type = 'range';
    slider.id = vid;
    slider.min = '1';
    slider.max = '1000';
    slider.step = '1';
    slider.value = String(Math.round(r.v * 1000));
    const readout = el('span', 'hint');
    const paint = (): void => {
      const v = Number(slider.value) / 1000;
      const cap = sim.state.era === 2 ? m.betaCap : m.warpCap;
      readout.textContent = sim.state.era === 2
        ? `${(v * cap).toFixed(4)} c of a ${cap.toFixed(4)} c ceiling`
        : `w = ${fmt(D(v * cap), 2)} of ${fmt(D(cap), 2)}`;
    };
    paint();
    on(slider, 'input', () => {
      setVelocity(ctx.sim, r.id, Number(slider.value) / 1000);
      paint();
    });
    on(slider, 'change', () => renderDetail(ctx));
    vWrap.append(label, slider, readout);
    controls.append(vWrap);

    if (sim.state.era === 2) {
      const opt = button('Set to optimum', 'btn btn-sm');
      on(opt, 'click', () => {
        const best = optimalBeta(m.betaCap, m.crewK, m.fuelK);
        setVelocity(ctx.sim, r.id, Math.min(1, best / m.betaCap));
        renderDetail(ctx);
        ctx.toast(`Commanded velocity set to ${(best).toFixed(4)} c.`, 'good');
      });
      controls.append(opt);
    }
  }

  detailBody.append(controls);

  const acts = el('div', 'toolbar');
  const tierBtn = button(`Upgrade charter (tier ${r.tier} → ${r.tier + 1}) — ${fmt(nextTierPrice(r))}`, 'btn');
  setClass(tierBtn, 'is-affordable', sim.state.credits.gte(nextTierPrice(r)));
  on(tierBtn, 'click', () => {
    report(ctx, buyTier(ctx.sim, r.id));
    renderDetail(ctx);
  });
  const dropBtn = button('Dissolve charter', 'btn btn-danger btn-sm');
  on(dropBtn, 'click', () => {
    ctx.openModal(
      'Dissolve this charter?',
      `${esc(routeLabel(r))} and its ${fmtInt(r.ships)} hulls are struck from the register. Filing fees are not refunded.`,
      [
        { label: 'Keep it', cls: 'btn' },
        {
          label: 'Dissolve',
          cls: 'btn btn-danger',
          onClick: () => {
            report(ctx, dissolve(ctx.sim, r.id));
            state.selected = '';
            ctx.invalidate();
          },
        },
      ],
    );
  });
  acts.append(tierBtn, dropBtn);
  detailBody.append(acts);

  const note = el('p', 'panel-note');
  note.textContent = sc.blurb;
  detailBody.append(note);
}

// --------------------------------------------------------------- view ------

export const routesView: View = {
  id: 'routes',
  label: 'Routes',
  icon: 'routes',

  mount(root: HTMLElement, ctx: UiCtx): void {
    root.innerHTML = HEAD;
    tbody = qs<HTMLTableSectionElement>(root, '#rtBody');
    pagerLabel = qs(root, '#rtPager');
    countLabel = qs(root, '#rtCount');
    detailBody = qs(root, '#rtDetail');
    regionSelect = qs<HTMLSelectElement>(root, '#rtRegion');

    const search = qs<HTMLInputElement>(root, '#rtSearch');
    on(search, 'input', () => {
      state.search = search.value.trim();
      state.page = 0;
      lastStructure = -1;
    });

    const kindGroup = qs(root, '#rtKind');
    on(kindGroup, 'click', (e) => {
      const t = (e.target as HTMLElement).closest('.seg-btn') as HTMLElement | null;
      if (!t) return;
      state.kind = (t.dataset.kind ?? 'all') as RouteKind | 'all';
      state.page = 0;
      for (const b of Array.from(kindGroup.querySelectorAll('.seg-btn'))) {
        setClass(b, 'is-active', b === t);
        setAttr(b, 'aria-pressed', b === t ? 'true' : 'false');
      }
      lastStructure = -1;
    });

    on(regionSelect, 'change', () => {
      state.region = regionSelect.value;
      state.page = 0;
      lastStructure = -1;
    });

    const hideDead = qs<HTMLInputElement>(root, '#rtHideDead');
    on(hideDead, 'change', () => {
      state.hideDead = hideDead.checked;
      state.page = 0;
      lastStructure = -1;
    });

    on(qs(root, 'thead'), 'click', (e) => {
      const th = (e.target as HTMLElement).closest('th.sortable') as HTMLElement | null;
      if (!th) return;
      const key = th.dataset.sort as SortKey;
      if (state.sort === key) state.desc = !state.desc;
      else {
        state.sort = key;
        state.desc = true;
      }
      for (const h of Array.from(root.querySelectorAll('th.sortable'))) {
        const active = h === th;
        setClass(h, 'is-sorted-asc', active && !state.desc);
        setClass(h, 'is-sorted-desc', active && state.desc);
        setAttr(h, 'aria-sort', active ? (state.desc ? 'descending' : 'ascending') : 'none');
      }
      lastStructure = -1;
    });

    on(qs(root, '#rtPrev'), 'click', () => {
      state.page = Math.max(0, state.page - 1);
      lastStructure = -1;
    });
    on(qs(root, '#rtNext'), 'click', () => {
      state.page++;
      lastStructure = -1;
    });
    on(qs(root, '#rtNew'), 'click', () => ctx.goTo('network'));
    on(qs(root, '#rtBuyAll'), 'click', () => {
      const n = upgradeAllAffordable(ctx.sim);
      ctx.toast(n ? `${n} hull${n === 1 ? '' : 's'} added to strength.` : 'Nothing affordable.', n ? 'good' : 'info');
    });

    this.rebuild?.(ctx);
  },

  rebuild(ctx: UiCtx): void {
    const sim = ctx.sim;
    // Region filter only offers regions the era has actually reached.
    const want = REGIONS.filter((r) => r.era <= sim.state.era);
    if (regionSelect.options.length !== want.length + 1) {
      clear(regionSelect);
      const all = el('option', '', 'All regions');
      all.value = 'all';
      regionSelect.append(all);
      for (const r of want) {
        const o = el('option', '', r.label);
        o.value = r.id;
        regionSelect.append(o);
      }
      regionSelect.value = state.region;
    }
    lastStructure = -1;
    renderDetail(ctx);
  },

  update(ctx: UiCtx): void {
    const sim = ctx.sim;
    const structural = sim.structureVersion;
    if (structural !== lastStructure) {
      lastStructure = structural;
      computeVisible(sim);
      layoutRows(ctx);
    } else {
      // Sorting by a live figure every frame would make rows swap under the
      // cursor, so the order is only resolved when the structure changes or
      // the player asks for it. Values still update continuously.
      computeVisible(sim);
      if (needsRelayout()) layoutRows(ctx);
    }
    paintRows(ctx);

    const cap = routeCap(sim);
    setText(countLabel, `${sim.state.routes.length} of ${cap} charters · ${sim.totals.liveRoutes} earning · ${ERA_NAMES[sim.state.era]}`);
    const pages = Math.max(1, Math.ceil(visible.length / PAGE));
    setText(pagerLabel, `${visible.length} shown · page ${state.page + 1} of ${pages}`);
  },
};

let lastVisibleKey = '';

function needsRelayout(): boolean {
  const start = state.page * PAGE;
  const slice = visible.slice(start, start + PAGE).join(',');
  if (slice === lastVisibleKey) return false;
  lastVisibleKey = slice;
  return true;
}

function layoutRows(ctx: UiCtx): void {
  const sim = ctx.sim;
  const start = state.page * PAGE;
  const slice = visible.slice(start, start + PAGE);
  lastVisibleKey = slice.join(',');

  while (rows.length < slice.length) {
    const r = makeRow(ctx);
    rows.push(r);
    tbody.append(r.tr);
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (i < slice.length) {
      const idx = slice[i]!;
      row.routeId = sim.state.routes[idx]!.id;
      row.tr.hidden = false;
    } else {
      row.routeId = '';
      row.tr.hidden = true;
    }
  }
  if (!slice.length) {
    // An empty table with no explanation reads as a bug rather than a filter.
    if (!tbody.querySelector('.empty-row')) {
      const tr = el('tr', 'empty-row');
      const td = el('td', 'empty', 'No charters match. File one from the Network tab.');
      td.colSpan = 7;
      tr.append(td);
      tbody.append(tr);
    }
  } else {
    tbody.querySelector('.empty-row')?.remove();
  }
}

function paintRows(ctx: UiCtx): void {
  const sim = ctx.sim;
  const credits = sim.state.credits;
  const totalRate = sim.totals.credits;
  const byId = new Map<string, number>();
  for (let i = 0; i < sim.state.routes.length; i++) byId.set(sim.state.routes[i]!.id, i);

  for (const row of rows) {
    if (!row.routeId) continue;
    const i = byId.get(row.routeId);
    if (i === undefined) continue;
    const r = sim.state.routes[i];
    const c = sim.caches[i];
    if (!r || !c) continue;
    const sc = shipClass(r.shipClass);

    setText(row.name, routeLabel(r));
    const kindTag = r.kind === 'trade' ? 'TRADE' : r.kind === 'science' ? 'SCI' : 'MIL';
    setText(row.sub, `${kindTag} · ${sc.name}${r.tier ? ` · tier ${r.tier}` : ''}${r.auto ? ' · AUTO' : ''}`);

    setText(row.ships, fmtInt(r.ships));
    const price = nextShipPrice(r);
    setText(row.shipsSub, fmt(price));
    setClass(row.buy1, 'is-affordable', credits.gte(price));

    setText(row.payload, c.payloadPerShip > 0 ? fmtMass(c.payloadPerShip) : '—');
    setText(row.payloadSub, c.payloadFraction > 0 ? fmtPct(c.payloadFraction, 1) : c.note || 'no payload');

    const prog = c.rtt > 0 ? Math.min(1, r.phase / c.rtt) : 0;
    row.cycleFill.style.width = (prog * 100).toFixed(1) + '%';
    setText(row.cycleLabel, fmtSimTime(c.rtt));
    setText(row.cycleSub, sim.state.era === 1
      ? `window ${fmtPct(c.duty, 0)}`
      : `${(c.velocity / LIGHT).toFixed(2)} c`);

    setText(row.income, fmt(perReal(c.rate)));
    const share = totalRate.gt(0) ? c.rate.div(totalRate).toNumber() : 0;
    setText(row.incomeSub, c.viable ? fmtPct(share, 1) + ' of total' : c.note || 'idle');

    setText(row.dv, fmtSI(c.deltaV, 'm/s'));
    setText(row.dvSub, fmtSI(c.distance, 'm'));

    setText(row.autoBtn, r.auto ? 'Auto ✓' : 'Auto');
    setAttr(row.autoBtn, 'aria-pressed', r.auto ? 'true' : 'false');
    setClass(row.tr, 'is-dead', !c.viable);
    setClass(row.tr, 'is-selected', row.routeId === state.selected);
  }
}

/** Bulk velocity setter, exported so the app can offer it as a single action. */
export function setAllVelocities(sim: Sim, v: number): void {
  for (const r of sim.state.routes) setVelocity(sim, r.id, v);
}
