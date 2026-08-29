import { fmt } from '../core/format';
import { availableTechs, buyTech, techState, type ActionResult } from '../sim/actions';
import { ERA_NAMES, TIME_SCALE } from '../sim/constants';
import { getTech, type Tech, type TechCat } from '../sim/data/tech';
import { button, clear, el, on, setAttr, setClass, setText } from './dom';
import { icon, type IconName } from './icons';
import type { UiCtx, View } from './ctx';

interface TechRefs {
  t: Tech;
  card: HTMLElement;
  badge: HTMLElement;
  req: HTMLElement;
  cost: HTMLElement;
  buy: HTMLButtonElement;
  /** Only the four era gates carry one; hidden until the Recharter is due. */
  cta: HTMLButtonElement | null;
}

const CATS: { id: TechCat; title: string; ic: IconName; note: string }[] = [
  {
    id: 'propulsion', title: 'Propulsion', ic: 'engine',
    note: 'Each entry raises the exhaust-velocity floor. The repeatable schedule stacks on top of whichever floor is current.',
  },
  {
    id: 'ships', title: 'Hull certifications', ic: 'hull',
    note: 'A certification licenses a class. It does not issue tonnage; charters still have to be crewed.',
  },
  {
    id: 'operations', title: 'Operations', ic: 'routes',
    note: 'Scheduling, trajectories and windows. None of it moves a kilogram further — it moves them more often.',
  },
  {
    id: 'markets', title: 'Markets', ic: 'market',
    note: 'What the authority is permitted to price, and how finely.',
  },
  {
    id: 'security', title: 'Security', ic: 'security',
    note: 'Interdiction is a penalty on the whole economy. These are the only two filings that hold it down.',
  },
  {
    id: 'automation', title: 'Automation', ic: 'settings',
    note: 'Delegations of authority. Each acts at the rate Delegated Scheduling has been bought up to, and no faster.',
  },
];

let rootEl: HTMLElement;
let cards: TechRefs[] = [];
let balanceLabel: HTMLElement;

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

/** Why a card is locked, in the words the player needs to act on it. */
function reqText(ctx: UiCtx, t: Tech): string {
  const s = ctx.sim.state;
  if (s.tech.includes(t.id)) return 'Researched';
  const unmet = t.req.filter((r) => !s.tech.includes(r)).map((r) => getTech(r)?.name ?? r);
  if (t.era > s.era) {
    const era = ERA_NAMES[t.era] ?? `era ${t.era}`;
    return unmet.length
      ? `Requires the ${era} charter, and: ${unmet.join(', ')}`
      : `Requires the ${era} charter`;
  }
  if (unmet.length) return `Requires: ${unmet.join(', ')}`;
  return 'Prerequisites met';
}

function makeCard(ctx: UiCtx, t: Tech): TechRefs {
  const card = el('div', 'tech-card');
  const name = el('div', 'up-name');
  name.append(el('span', '', t.name));
  const badge = el('span', 'up-level', '');
  name.append(badge);

  const req = el('div', 'tech-req', '');
  const cost = el('div', 'up-cost', '');
  const bar = el('div', 'toolbar');
  const buy = button('Research', 'btn btn-sm');
  setAttr(buy, 'aria-label', `Research ${t.name} for ${fmt(t.cost)} Research`);
  bar.append(buy);
  on(buy, 'click', () => {
    const res = buyTech(ctx.sim, t.id);
    report(ctx, res);
    // A technology changes what every other view may offer, so the whole UI
    // has to be rebuilt rather than merely repainted.
    if (res.ok) {
      ctx.toast(`${t.name} entered on the register.`, 'good');
      ctx.invalidate();
    }
  });

  let cta: HTMLButtonElement | null = null;
  if (t.unlocksEra !== undefined) {
    cta = button('File a Recharter in Stats', 'btn btn-sm btn-primary');
    setAttr(cta, 'aria-label', `Go to the Stats view to file a Recharter into ${ERA_NAMES[t.unlocksEra] ?? 'the next era'}`);
    cta.hidden = true;
    on(cta, 'click', () => ctx.goTo('stats'));
    bar.append(cta);
  }

  card.append(name, el('p', 'up-desc', t.desc), req, cost, bar);
  return { t, card, badge, req, cost, buy, cta };
}

// ----------------------------------------------------------------- view ----

export const researchView: View = {
  id: 'research',
  label: 'Research',
  icon: 'tech',

  mount(root: HTMLElement, ctx: UiCtx): void {
    rootEl = root;
    this.rebuild?.(ctx);
  },

  rebuild(ctx: UiCtx): void {
    const sim = ctx.sim;
    clear(rootEl);
    cards = [];

    const offered = availableTechs(sim);

    // --- era gates, first and on their own ------------------------------------
    const ep = panel('recharter', 'Era authorisations');
    balanceLabel = el('span', 'hint', '');
    ep.actions.append(balanceLabel);
    const egrid = el('div', 'tech-grid');
    let eraShown = 0;
    for (const t of offered) {
      if (t.cat !== 'era') continue;
      const refs = makeCard(ctx, t);
      cards.push(refs);
      egrid.append(refs.card);
      eraShown++;
    }
    if (eraShown) {
      ep.body.append(egrid, el(
        'p', 'panel-note',
        'Researching one of these authorises the next charter; it does not begin it. The authority operates '
        + 'under the era it filed for until a Recharter is filed from the Stats view.',
      ));
    } else {
      ep.body.append(el('p', 'empty', 'No further authorisation is on offer at this era.'));
    }
    rootEl.append(ep.root);

    // --- everything else, by category -----------------------------------------
    for (const c of CATS) {
      const p = panel(c.ic, c.title);
      const grid = el('div', 'tech-grid');
      let shown = 0;
      for (const t of offered) {
        if (t.cat !== c.id) continue;
        const refs = makeCard(ctx, t);
        cards.push(refs);
        grid.append(refs.card);
        shown++;
      }
      if (!shown) continue;
      p.body.append(grid, el('p', 'panel-note', c.note));
      rootEl.append(p.root);
    }
  },

  update(ctx: UiCtx): void {
    const sim = ctx.sim;
    const s = sim.state;
    // totals.research is per SIM second; the header quotes what the player sees.
    const perReal = sim.totals.research.mul(TIME_SCALE);
    setText(balanceLabel, `${fmt(s.research)} Research held · ${fmt(perReal)} /s`);

    for (const r of cards) {
      const st = techState(sim, r.t.id);
      const owned = st === 'owned';
      const locked = st === 'locked';
      setClass(r.card, 'is-owned', owned);
      setClass(r.card, 'is-locked', locked);
      setText(r.badge, owned ? 'RESEARCHED' : locked ? 'LOCKED' : 'AVAILABLE');
      setText(r.req, reqText(ctx, r.t));
      setText(r.cost, owned ? `Paid — ${fmt(r.t.cost)} Research` : `${fmt(r.t.cost)} Research`);

      r.buy.disabled = st !== 'available';
      setClass(r.buy, 'is-affordable', st === 'available' && s.research.gte(r.t.cost));
      setText(r.buy, owned ? 'Researched' : 'Research');

      if (r.cta) {
        const due = owned
          && r.t.unlocksEra !== undefined
          && r.t.unlocksEra > s.era
          && s.eraUnlocked > s.era;
        r.cta.hidden = !due;
        if (due) {
          const era = ERA_NAMES[r.t.unlocksEra ?? 0] ?? 'the next era';
          setText(r.cta, `Authorised — file a Recharter for ${era}`);
        }
      }
    }
  },
};
