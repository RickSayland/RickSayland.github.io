import { fmt, fmtInt, fmtMult, fmtPct, fmtSI } from '../core/format';
import {
  buyAllAffordableUpgrades, buyInstitution, buyUpgrade, institutionCost,
  upgradeAvailable, upgradeCost, upgradeMax, type ActionResult,
} from '../sim/actions';
import { getTech } from '../sim/data/tech';
import {
  INSTITUTIONS, UPGRADES, type Bucket, type Institution, type Upgrade,
} from '../sim/data/upgrades';
import { button, clear, el, on, setAttr, setClass, setText } from './dom';
import { icon, type IconName } from './icons';
import type { UiCtx, View } from './ctx';

interface UpRefs {
  u: Upgrade;
  card: HTMLElement;
  level: HTMLElement;
  cost: HTMLElement;
  buy1: HTMLButtonElement;
  buy10: HTMLButtonElement;
  buyMax: HTMLButtonElement;
  /** A locked card is inert until a rebuild; update skips it entirely. */
  locked: boolean;
}

interface InstRefs {
  inst: Institution;
  card: HTMLElement;
  level: HTMLElement;
  cost: HTMLElement;
  buy: HTMLButtonElement;
}

const BUCKETS: { id: Bucket; title: string; ic: IconName; note: string }[] = [
  {
    id: 'propulsion', title: 'Propulsion', ic: 'engine',
    note: 'Moves the exponent in exp(−Δv/vₑ). Transformative where Δv/vₑ is large, barely measurable where it is small.',
  },
  {
    id: 'structures', title: 'Structures', ic: 'hull',
    note: 'Moves the term subtracted from it, and the mass it multiplies. The only lever that helps a hull already carrying nothing.',
  },
  {
    id: 'logistics', title: 'Logistics', ic: 'routes',
    note: 'Moves the denominator: berth time, return windows, and the paperwork ceiling on concurrent charters.',
  },
  {
    id: 'markets', title: 'Markets', ic: 'market',
    note: 'Moves what a kilogram is worth on arrival. Buys no tonnage and moves no hull.',
  },
];

let rootEl: HTMLElement;
let upCards: UpRefs[] = [];
let instCards: InstRefs[] = [];
let kvVals = new Map<string, HTMLElement>();
let creditsLabel: HTMLElement;
let mandateLabel: HTMLElement;

function report(ctx: UiCtx, res: ActionResult): void {
  if (!res.ok) ctx.toast(res.why, 'bad');
}

function panel(ic: IconName, title: string): { root: HTMLElement; actions: HTMLElement; body: HTMLElement } {
  const root = el('section', 'panel');
  const head = el('div', 'panel-head');
  const h = el('h2', 'panel-title');
  const mark = el('span', 'panel-icon');
  mark.innerHTML = icon(ic, 16);
  h.append(mark, document.createTextNode(title));
  const actions = el('div', 'panel-actions');
  head.append(h, actions);
  const body = el('div', 'panel-body');
  root.append(head, body);
  return { root, actions, body };
}

function kvRow(host: HTMLElement, key: string, label: string): void {
  const row = el('div', 'kv-row');
  const v = el('div', 'kv-v', '—');
  row.append(el('div', 'kv-k', label), v);
  host.append(row);
  kvVals.set(key, v);
}

function kvSet(key: string, text: string): void {
  const n = kvVals.get(key);
  if (n) setText(n, text);
}

// ---------------------------------------------------------------- cards ----

function makeUpgradeCard(ctx: UiCtx, u: Upgrade, lockedBy: string): UpRefs {
  const card = el('div', 'up-card');
  const name = el('div', 'up-name');
  name.append(el('span', '', u.name));
  const level = el('span', 'up-level', '');
  name.append(level);

  const cost = el('div', 'up-cost', '');
  const bar = el('div', 'toolbar');
  const buy1 = button('×1', 'btn btn-sm');
  const buy10 = button('×10', 'btn btn-sm');
  const buyMax = button('Max', 'btn btn-sm');
  setAttr(buy1, 'aria-label', `Buy one level of ${u.name}`);
  setAttr(buy10, 'aria-label', `Buy ten levels of ${u.name}`);
  setAttr(buyMax, 'aria-label', `Buy as many levels of ${u.name} as credits allow`);
  bar.append(buy1, buy10, buyMax);

  card.append(name, el('p', 'up-desc', u.desc), el('div', 'hint', `Per level: ${u.step}`), cost, bar);

  const locked = lockedBy !== '';
  if (locked) {
    setClass(card, 'is-locked', true);
    setText(level, 'LOCKED');
    setText(cost, `Locked — requires ${lockedBy}`);
    for (const b of [buy1, buy10, buyMax]) b.disabled = true;
  } else {
    on(buy1, 'click', () => report(ctx, buyUpgrade(ctx.sim, u.id, 1)));
    on(buy10, 'click', () => report(ctx, buyUpgrade(ctx.sim, u.id, 10)));
    on(buyMax, 'click', () => {
      const n = upgradeMax(ctx.sim, u.id);
      if (n <= 0) {
        ctx.toast('Insufficient credits for a further level.', 'bad');
        return;
      }
      report(ctx, buyUpgrade(ctx.sim, u.id, n));
    });
  }

  return { u, card, level, cost, buy1, buy10, buyMax, locked };
}

function makeInstitutionCard(ctx: UiCtx, inst: Institution): InstRefs {
  const card = el('div', 'up-card');
  const name = el('div', 'up-name');
  name.append(el('span', '', inst.name));
  const level = el('span', 'up-level', '');
  name.append(level);

  const cost = el('div', 'up-cost', '');
  const bar = el('div', 'toolbar');
  const buy = button('File', 'btn btn-sm');
  setAttr(buy, 'aria-label', `Buy one level of ${inst.name} with Mandate`);
  bar.append(buy);

  card.append(name, el('p', 'up-desc', inst.desc), el('div', 'hint', `Per level: ${inst.step}`), cost, bar);

  on(buy, 'click', () => report(ctx, buyInstitution(ctx.sim, inst.id)));

  return { inst, card, level, cost, buy };
}

// ----------------------------------------------------------------- view ----

export const upgradesView: View = {
  id: 'upgrades',
  label: 'Upgrades',
  icon: 'upgrades',

  mount(root: HTMLElement, ctx: UiCtx): void {
    rootEl = root;
    this.rebuild?.(ctx);
  },

  rebuild(ctx: UiCtx): void {
    const sim = ctx.sim;
    clear(rootEl);
    upCards = [];
    instCards = [];
    kvVals = new Map();

    // --- derived figures -----------------------------------------------------
    const head = panel('stats', 'Standing figures');
    creditsLabel = el('span', 'hint', '');
    const buyAll = button('Buy every affordable level', 'btn btn-sm');
    setAttr(buyAll, 'aria-label', 'Buy every affordable level of every available upgrade');
    on(buyAll, 'click', () => {
      const n = buyAllAffordableUpgrades(ctx.sim);
      ctx.toast(
        n ? `${fmtInt(n)} level${n === 1 ? '' : 's'} entered on the schedule.` : 'Nothing affordable.',
        n ? 'good' : 'info',
      );
    });
    head.actions.append(creditsLabel, buyAll);

    const kv = el('div', 'kv');
    kvRow(kv, 've', 'Exhaust velocity');
    kvRow(kv, 'struct', 'Structural multiplier');
    kvRow(kv, 'mass', 'Wet-mass multiplier');
    kvRow(kv, 'overhead', 'Overhead multiplier');
    kvRow(kv, 'continuity', 'Return window engineered away');
    kvRow(kv, 'smooth', 'Continuity of income');
    kvRow(kv, 'value', 'Value multiplier');
    if (sim.state.era >= 2) kvRow(kv, 'beta', 'Certified velocity ceiling');
    if (sim.state.era >= 3) kvRow(kv, 'warp', 'Maximum warp factor');
    head.body.append(kv);
    head.body.append(el(
      'p', 'panel-note',
      'The figures above are what every purchase on this page resolves to. The four schedules below are '
      + 'multiplicatively independent, which is the only reason it is possible to say which one moved.',
    ));
    rootEl.append(head.root);

    // --- repeatables, one panel per bucket -----------------------------------
    for (const b of BUCKETS) {
      const p = panel(b.ic, b.title);
      const grid = el('div', 'up-grid');
      let shown = 0;
      for (const u of UPGRADES) {
        if (u.bucket !== b.id) continue;
        // Above the current era it does not exist yet as far as the player is
        // concerned; gated on a technology it exists and is merely unavailable.
        if (u.era > sim.state.era) continue;
        let lockedBy = '';
        if (!upgradeAvailable(sim, u.id) && u.tech) {
          lockedBy = getTech(u.tech)?.name ?? u.tech;
        }
        const refs = makeUpgradeCard(ctx, u, lockedBy);
        upCards.push(refs);
        grid.append(refs.card);
        shown++;
      }
      if (!shown) continue;
      p.body.append(grid, el('p', 'panel-note', b.note));
      rootEl.append(p.root);
    }

    // --- institutions --------------------------------------------------------
    const ip = panel('institution', 'Institutions');
    mandateLabel = el('span', 'hint', '');
    ip.actions.append(mandateLabel);
    const igrid = el('div', 'up-grid');
    for (const inst of INSTITUTIONS) {
      const refs = makeInstitutionCard(ctx, inst);
      instCards.push(refs);
      igrid.append(refs.card);
    }
    ip.body.append(igrid, el(
      'p', 'panel-note',
      'Bought with Mandate and entered permanently on the register. Institutions survive a Recharter; '
      + 'everything above this panel is struck out with the charter that bought it.',
    ));
    rootEl.append(ip.root);
  },

  update(ctx: UiCtx): void {
    const sim = ctx.sim;
    const s = sim.state;
    const m = sim.mods;

    setText(creditsLabel, `${fmt(s.credits)} credits on hand`);
    setText(mandateLabel, `${fmt(s.mandate)} Mandate held`);

    kvSet('ve', `${fmtSI(m.ve, 'm/s')} — ${m.engineLabel}`);
    kvSet('struct', fmtMult(m.structMult));
    kvSet('mass', fmtMult(m.massMult));
    kvSet('overhead', fmtMult(m.overheadMult));
    kvSet('continuity', fmtPct(m.continuity));
    kvSet('smooth', fmtPct(m.smoothness));
    kvSet('value', fmtMult(m.valueMult));
    kvSet('beta', `${fmtPct(m.betaCap, 2)} of c`);
    kvSet('warp', `w = ${fmt(m.warpCap)}`);

    const credits = s.credits;
    for (const r of upCards) {
      if (r.locked) continue;
      const owned = s.up[r.u.id] ?? 0;
      const maxed = owned >= r.u.max;
      setText(r.level, `Lv ${fmtInt(owned)} / ${fmtInt(r.u.max)}`);
      setClass(r.card, 'is-max', maxed);

      if (maxed) {
        setText(r.cost, 'Schedule complete');
        r.buy1.disabled = true;
        r.buy10.disabled = true;
        r.buyMax.disabled = true;
        setClass(r.buy1, 'is-affordable', false);
        setClass(r.buy10, 'is-affordable', false);
        setClass(r.buyMax, 'is-affordable', false);
        setText(r.buyMax, 'Max');
        continue;
      }

      const c1 = upgradeCost(sim, r.u.id, 1);
      const c10 = upgradeCost(sim, r.u.id, 10);
      const n = upgradeMax(sim, r.u.id);
      setText(r.cost, `${fmt(c1)} credits`);
      r.buy1.disabled = false;
      r.buy10.disabled = false;
      r.buyMax.disabled = false;
      setClass(r.buy1, 'is-affordable', credits.gte(c1));
      setClass(r.buy10, 'is-affordable', credits.gte(c10));
      setClass(r.buyMax, 'is-affordable', n > 0);
      setText(r.buyMax, n > 0 ? `Max ×${fmtInt(n)}` : 'Max');
      setAttr(r.buy10, 'aria-label', `Buy ten levels of ${r.u.name} for ${fmt(c10)} credits`);
      setAttr(
        r.buyMax, 'aria-label',
        n > 0
          ? `Buy ${fmtInt(n)} levels of ${r.u.name}, everything credits allow`
          : `Buy as many levels of ${r.u.name} as credits allow`,
      );
    }

    const mandate = s.mandate;
    for (const r of instCards) {
      const owned = s.inst[r.inst.id] ?? 0;
      const maxed = owned >= r.inst.max;
      setText(r.level, `Lv ${fmtInt(owned)} / ${fmtInt(r.inst.max)}`);
      setClass(r.card, 'is-max', maxed);
      if (maxed) {
        setText(r.cost, 'Schedule complete');
        r.buy.disabled = true;
        setClass(r.buy, 'is-affordable', false);
        continue;
      }
      const price = institutionCost(sim, r.inst.id);
      setText(r.cost, `${fmt(price)} Mandate`);
      r.buy.disabled = false;
      setClass(r.buy, 'is-affordable', mandate.gte(price));
      setAttr(r.buy, 'aria-label', `Buy one level of ${r.inst.name} for ${fmt(price)} Mandate`);
    }
  },
};
