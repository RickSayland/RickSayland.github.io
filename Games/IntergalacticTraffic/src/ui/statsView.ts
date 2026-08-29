import { fmt, fmtInt, fmtMass, fmtMult, fmtPct, fmtSimTime, fmtTime } from '../core/format';
import { ERA_NAMES, TIME_SCALE } from '../sim/constants';
import { REGIONS } from '../sim/nodes';
import { routeCap } from '../sim/engine';
import { canRecharter, mandateGain, recharter } from '../sim/actions';
import { TECHS } from '../sim/data/tech';
import { button, clear, el, on, qs, setAttr, setText } from './dom';
import { icon } from './icons';
import { endingPlate, eraEmblem } from './art';
import type { Decimal } from '../core/num';
import type { UiCtx, View } from './ctx';

/** One region's Interdiction readout. Rebuilt only when the era changes. */
interface RegionRow {
  id: string;
  mult: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
}

interface RcRefs {
  era: HTMLElement;
  auth: HTMLElement;
  gain: HTMLElement;
  held: HTMLElement;
}

interface OpsRefs {
  age: HTMLElement;
  credits: HTMLElement;
  research: HTMLElement;
  throughput: HTMLElement;
  charters: HTMLElement;
  live: HTMLElement;
  // Era 3+ only. Null before the metric is being engineered, because there is
  // no exotic matter economy to report on.
  exotic: HTMLElement | null;
  exoticProd: HTMLElement | null;
  exoticDraw: HTMLElement | null;
  throttle: HTMLElement | null;
  throttleWarn: HTMLElement | null;
}

interface LedgerRefs {
  lifetime: HTMLElement;
  total: HTMLElement;
  recharters: HTMLElement;
  best: HTMLElement;
  hulls: HTMLElement;
  charters: HTMLElement;
  played: HTMLElement;
}

let endingPanel: HTMLElement;
let plateBox: HTMLElement;
let eraPill: HTMLElement;
let emblemBox: HTMLElement;
let rcBody: HTMLElement;
let keepLoseBox: HTMLElement;
let rc: RcRefs;
let rcWhy: HTMLElement;
let rcBtn: HTMLButtonElement;
let interBody: HTMLElement;
let interRows: RegionRow[] = [];
let opsBody: HTMLElement;
let ops: OpsRefs;
let ledgerBody: HTMLElement;
let ledger: LedgerRefs;

/** Structure version the current DOM was built against. -1 forces a rebuild. */
let built = -1;

// ---------------------------------------------------------------- helpers ---

/** Every total in `sim.totals` is per SIM second; play is quoted per real one. */
function perReal(d: Decimal): Decimal {
  return d.mul(TIME_SCALE);
}

/** Mass that falls back to plain kilograms once tonnes overflow a float. */
function mass(d: Decimal): string {
  const n = d.toNumber();
  return isFinite(n) ? fmtMass(n) : `${fmt(d)} kg`;
}

function eraName(era: number): string {
  return ERA_NAMES[era] ?? `Era ${era}`;
}

/** The art set only has five seals; a state from a newer build gets the last. */
function sealEra(era: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.floor(era))) as 1 | 2 | 3 | 4 | 5;
}

/** The technology that authorises the era after `era`, if there is one. */
function eraGate(era: number): { id: string; name: string } | undefined {
  return TECHS.find((t) => t.unlocksEra === era + 1);
}

function kvBlock(parent: HTMLElement): (k: string) => HTMLElement {
  const block = el('div', 'kv');
  parent.append(block);
  return (k: string): HTMLElement => {
    const row = el('div', 'kv-row');
    const v = el('div', 'kv-v');
    row.append(el('div', 'kv-k', k), v);
    block.append(row);
    return v;
  };
}

/**
 * Kept-versus-lost, built fresh each time because it is shown in two places at
 * once: the panel and the confirmation modal, and a node cannot be in both.
 * `mandateLine` differs between them — the modal can quote the exact award
 * because it is built at the moment of asking; the panel copy would go stale.
 */
function keepLoseNode(mandateLine: string): HTMLElement {
  const wrap = el('div', 'toolbar');

  const col = (title: string, items: string[]): void => {
    const field = el('div', 'field');
    field.append(el('strong', '', title));
    const list = el('ul', 'hint');
    for (const item of items) list.append(el('li', '', item));
    field.append(list);
    wrap.append(field);
  };

  col('Carried over', [
    'Research, and every technology bought with it.',
    'Era authorisations already granted.',
    mandateLine,
    'Institutions bought with Mandate.',
    'Career credit total, Recharters filed, time at the desk.',
    'Interface settings.',
  ]);
  col('Struck from the register', [
    'Credits on hand.',
    'Every charter, and the hulls on strength against it.',
    'Every survey, less those restored by the Standing Survey Record.',
    'Every repeatable upgrade bought with credits.',
    'Interdiction, in all regions, back to nothing.',
    'Exotic matter in store.',
    "This charter's lifetime credits and best rate.",
  ]);
  return wrap;
}

// ----------------------------------------------------------------- markup ---

const HEAD = `
<div class="panel" id="stEnding" hidden>
  <div class="panel-head">
    <h2 class="panel-title">${icon('check', 18)} Terminus filed</h2>
    <div class="panel-actions"><span class="pill pill--ok">Charter concluded</span></div>
  </div>
  <div class="panel-body">
    <div id="stPlate"></div>
    <p class="panel-note">
      The schedule is complete. Every lane from Sol to the adjacent manifolds has been surveyed,
      chartered and licensed, and the file is closed in perpetuity. The office does not close with it:
      traffic continues, the ledger continues, and you may keep operating for as long as it interests you.
      Nothing further is required of you, which is a different thing from nothing further being possible.
    </p>
  </div>
</div>

<div class="panel">
  <div class="panel-head">
    <h2 class="panel-title">${icon('recharter', 18)} Recharter</h2>
    <div class="panel-actions"><span class="pill pill--era" id="stEraPill"></span></div>
  </div>
  <div class="panel-body">
    <div class="toolbar">
      <div id="stEmblem"></div>
      <div id="stRcKv"></div>
    </div>
    <div id="stKeepLose"></div>
    <p class="warn" id="stRcWhy" hidden></p>
    <div class="toolbar" id="stRcActions"></div>
    <p class="panel-note">
      A Recharter surrenders the current charter and issues the next one under the authority of a wider
      era. It is the only way to operate beyond the region you are licensed for. Nothing listed under
      <em>Carried over</em> is at risk; everything listed under <em>Struck from the register</em> is gone
      the moment the filing is stamped.
    </p>
  </div>
</div>

<div class="panel">
  <div class="panel-head">
    <h2 class="panel-title">${icon('blocked', 18)} Interdiction</h2>
  </div>
  <div class="panel-body">
    <div id="stInter"></div>
    <p class="panel-note">
      Interdiction rises with a region's total throughput and is suppressed by the Security that military
      charters generate there. Income in a region is multiplied by <code>1 / (1 + I)</code>, so an economy
      that grows unpoliced is taxed by piracy, salvage claims and unlicensed traffic until it stops growing.
      This is the reason a network of nothing but trade routes stalls.
    </p>
  </div>
</div>

<div class="panel">
  <div class="panel-head">
    <h2 class="panel-title">${icon('stats', 18)} Operations</h2>
  </div>
  <div class="panel-body" id="stOps"></div>
</div>

<div class="panel">
  <div class="panel-head">
    <h2 class="panel-title">${icon('credits', 18)} Ledger</h2>
  </div>
  <div class="panel-body" id="stLedger"></div>
</div>`;

// ------------------------------------------------------------- recharter ----

function fileRecharter(ctx: UiCtx): void {
  const res = recharter(ctx.sim);
  if (!res.ok) {
    ctx.toast(res.why, 'bad');
    return;
  }
  built = -1;
  ctx.invalidate();
  ctx.toast(`Recharter filed. Operating under ${eraName(ctx.sim.state.era)} authority.`, 'good');
  ctx.announce(`Recharter filed. Now operating under ${eraName(ctx.sim.state.era)} authority.`);
  ctx.goTo('routes');
}

function askRecharter(ctx: UiCtx): void {
  const sim = ctx.sim;
  const check = canRecharter(sim);
  if (!check.ok) {
    ctx.toast(check.why, 'bad');
    return;
  }
  if (!sim.state.settings.confirmRecharter) {
    fileRecharter(ctx);
    return;
  }

  const gain = mandateGain(sim);
  const body = el('div');
  const lead = el('p', '');
  lead.textContent =
    `The ${eraName(sim.state.era)} charter is surrendered and a ${eraName(sim.state.era + 1)} charter `
    + `is issued in its place, awarding ${fmt(gain)} Mandate. This cannot be reversed.`;
  body.append(lead, keepLoseNode(`Mandate, plus the ${fmt(gain)} this filing awards.`));

  ctx.openModal('File a Recharter?', body, [
    { label: 'Not yet', cls: 'btn' },
    { label: 'File the Recharter', cls: 'btn btn-primary', onClick: () => fileRecharter(ctx) },
  ]);
}

// ------------------------------------------------------------------ view ----

export const statsView: View = {
  id: 'stats',
  label: 'Stats',
  icon: 'stats',

  mount(root: HTMLElement, ctx: UiCtx): void {
    root.innerHTML = HEAD;
    endingPanel = qs(root, '#stEnding');
    plateBox = qs(root, '#stPlate');
    eraPill = qs(root, '#stEraPill');
    emblemBox = qs(root, '#stEmblem');
    rcBody = qs(root, '#stRcKv');
    keepLoseBox = qs(root, '#stKeepLose');
    rcWhy = qs(root, '#stRcWhy');
    interBody = qs(root, '#stInter');
    opsBody = qs(root, '#stOps');
    ledgerBody = qs(root, '#stLedger');

    rcBtn = button('File a Recharter', 'btn btn-primary');
    // The button carries the whole action, so its name has to make sense read
    // on its own by a screen reader that never saw the panel heading.
    rcBtn.setAttribute('aria-label', 'File a Recharter');
    on(rcBtn, 'click', () => askRecharter(ctx));
    qs(root, '#stRcActions').append(rcBtn);

    built = -1;
    this.rebuild?.(ctx);
  },

  rebuild(ctx: UiCtx): void {
    const sim = ctx.sim;
    const s = sim.state;
    built = sim.structureVersion;

    // --- ending ------------------------------------------------------------
    const done = s.tech.includes('terminus');
    setAttr(endingPanel, 'hidden', done ? null : '');
    if (done && !plateBox.firstChild) {
      // endingPlate returns SVG markup rather than nodes, so this is the one
      // place in the view that writes HTML.
      plateBox.innerHTML = endingPlate(400);
    }

    // --- recharter ---------------------------------------------------------
    emblemBox.innerHTML = eraEmblem(sealEra(s.era), 96);
    clear(rcBody);
    const kv = kvBlock(rcBody);
    rc = {
      era: kv('Operating era'),
      auth: kv('Authorised to'),
      gain: kv('Mandate on filing'),
      held: kv('Mandate held'),
    };

    clear(keepLoseBox);
    keepLoseBox.append(keepLoseNode('Mandate, plus the award listed above.'));

    // --- interdiction ------------------------------------------------------
    clear(interBody);
    interRows = [];
    for (const region of REGIONS) {
      if (region.era > s.era) continue;
      const row = el('div', 'kv-row');
      const k = el('div', 'kv-k', region.label);
      const v = el('div', 'kv-v');
      const mult = el('span', 'pill');
      const bar = el('div', 'bar bar--interdiction');
      const fill = el('div', 'bar-fill');
      const label = el('div', 'bar-label');
      bar.append(fill, label);
      v.append(mult, bar);
      row.append(k, v);
      interBody.append(row);
      interRows.push({ id: region.id, mult, fill, label });
    }
    if (!interRows.length) {
      interBody.append(el('p', 'empty', 'No region is licensed yet.'));
    }

    // --- operations --------------------------------------------------------
    clear(opsBody);
    const op = kvBlock(opsBody);
    const base: OpsRefs = {
      age: op('Charter age'),
      credits: op('Credits'),
      research: op('Research'),
      throughput: op('Throughput'),
      charters: op('Charters'),
      live: op('Earning'),
      exotic: null,
      exoticProd: null,
      exoticDraw: null,
      throttle: null,
      throttleWarn: null,
    };
    if (s.era >= 3) {
      base.exotic = op('Exotic matter in store');
      base.exoticProd = op('Exotic production');
      base.exoticDraw = op('Exotic draw');
      base.throttle = op('Supply');
      const warn = el('p', 'warn');
      warn.hidden = true;
      opsBody.append(warn);
      base.throttleWarn = warn;
    }
    ops = base;

    // --- ledger ------------------------------------------------------------
    clear(ledgerBody);
    const lg = kvBlock(ledgerBody);
    ledger = {
      lifetime: lg('Credits this charter'),
      total: lg('Credits, all charters'),
      recharters: lg('Recharters filed'),
      best: lg('Best credits per second'),
      hulls: lg('Hulls bought'),
      charters: lg('Charters filed'),
      played: lg('Time at the desk'),
    };
  },

  update(ctx: UiCtx): void {
    const sim = ctx.sim;
    const s = sim.state;
    if (sim.structureVersion !== built) this.rebuild?.(ctx);

    // --- recharter ---------------------------------------------------------
    const gain = mandateGain(sim);
    const check = canRecharter(sim);
    setText(eraPill, `Era ${s.era} · ${eraName(s.era)}`);
    setText(rc.era, `${eraName(s.era)} (era ${s.era})`);
    setText(rc.auth, s.eraUnlocked > s.era
      ? `${eraName(s.eraUnlocked)} (era ${s.eraUnlocked})`
      : 'Nothing beyond the current era');
    setText(rc.gain, `${fmt(gain)} Mandate`);
    setText(rc.held, `${fmt(s.mandate)} Mandate`);

    if (check.ok) {
      setAttr(rcWhy, 'hidden', '');
      setAttr(rcBtn, 'disabled', null);
      const label = `File a Recharter — ${eraName(s.era + 1)}, +${fmt(gain)} Mandate`;
      setText(rcBtn, label);
      setAttr(rcBtn, 'aria-label', label);
    } else {
      const gate = eraGate(s.era);
      const owned = gate ? s.tech.includes(gate.id) : false;
      const why = gate && !owned
        ? `${check.why} Research ${gate.name} on the Tech tab to authorise ${eraName(s.era + 1)}.`
        : `${check.why} There is no further era to be authorised: this is the last one.`;
      setText(rcWhy, why);
      setAttr(rcWhy, 'hidden', null);
      setAttr(rcBtn, 'disabled', '');
      setText(rcBtn, 'Recharter unavailable');
      setAttr(rcBtn, 'aria-label', 'File a Recharter — unavailable');
    }

    // --- interdiction ------------------------------------------------------
    for (const row of interRows) {
      const I = Math.max(0, s.interdiction[row.id] ?? 0);
      const mult = 1 / (1 + I);
      setText(row.mult, fmtMult(mult));
      // The bar shows what Interdiction takes, not what survives it: a full bar
      // is unambiguously bad, and the text beside it says so in words.
      const lost = 1 - mult;
      row.fill.style.width = `${(lost * 100).toFixed(1)}%`;
      setText(row.label, I <= 0
        ? 'clear'
        : `I = ${I.toFixed(2)} · ${fmtPct(lost, 0)} of income lost`);
    }

    // --- operations --------------------------------------------------------
    setText(ops.age, `${fmtSimTime(s.t)} of sim time`);
    setText(ops.credits, `${fmt(perReal(sim.totals.credits))} /s of play `
      + `(${fmt(sim.totals.credits)} per sim second)`);
    setText(ops.research, `${fmt(perReal(sim.totals.research))} /s of play `
      + `(${fmt(sim.totals.research)} per sim second)`);
    setText(ops.throughput, `${mass(perReal(sim.totals.throughput))} /s of play`);
    setText(ops.charters, `${fmtInt(s.routes.length)} of ${fmtInt(routeCap(sim))} filed`);
    setText(ops.live, `${fmtInt(sim.totals.liveRoutes)} charters earning`);

    if (ops.exotic && ops.exoticProd && ops.exoticDraw && ops.throttle && ops.throttleWarn) {
      setText(ops.exotic, fmt(s.exotic));
      setText(ops.exoticProd, `${fmt(perReal(sim.totals.exoticProd))} /s of play`);
      setText(ops.exoticDraw, `${fmt(perReal(sim.totals.exoticDraw))} /s of play`);
      const th = sim.throttle;
      setText(ops.throttle, th >= 1
        ? `${fmtPct(th, 0)} — demand met in full`
        : `${fmtPct(th, 1)} of demanded exotic matter supplied`);
      const short = th < 0.999;
      setText(ops.throttleWarn, short
        ? `THROTTLED — the network is running at ${fmtPct(th, 1)} of commanded output because exotic `
          + 'matter production does not meet bubble upkeep. Charter more science routes, or drop warp '
          + 'factors until supply catches up.'
        : '');
      ops.throttleWarn.hidden = !short;
    }

    // --- ledger ------------------------------------------------------------
    setText(ledger.lifetime, fmt(s.lifetimeCredits));
    setText(ledger.total, fmt(s.totalCredits));
    setText(ledger.recharters, fmtInt(s.recharters));
    setText(ledger.best, `${fmt(s.stats.bestRate)} /s of play`);
    setText(ledger.hulls, fmtInt(s.stats.shipsBought));
    setText(ledger.charters, fmtInt(s.stats.routesChartered));
    setText(ledger.played, fmtTime(s.stats.playMs / 1000));
  },
};
