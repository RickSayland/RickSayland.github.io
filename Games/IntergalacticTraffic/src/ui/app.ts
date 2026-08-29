import { Decimal } from '../core/num';
import { fmt, fmtPct } from '../core/format';
import { TIME_SCALE, ERA_NAMES } from '../sim/constants';
import { ensureFresh, type Sim } from '../sim/engine';
import { clear, el, on, qs, setClass, setText, button } from './dom';
import { icon } from './icons';
import type { ModalButton, ToastKind, UiCtx, View } from './ctx';

import { routesView } from './routesView';
import { networkView, focusNetworkNode } from './networkView';
import { mapView } from './mapView';
import { upgradesView } from './upgradesView';
import { researchView } from './researchView';
import { statsView } from './statsView';
import { settingsView } from './settingsView';

const VIEWS: View[] = [
  routesView, networkView, mapView, upgradesView, researchView, statsView, settingsView,
];

interface Chip {
  root: HTMLElement;
  val: HTMLElement;
  rate: HTMLElement;
}

const chips: Record<string, Chip> = {};
const mounted = new Set<string>();
let active = 'routes';
let ctx: UiCtx;
let lastStructure = -1;
let toastHost: HTMLElement;
let modalRoot: HTMLElement;
let announcer: HTMLElement;
let eraLabel: HTMLElement;

function makeChip(host: HTMLElement, key: string, label: string, iconName: Parameters<typeof icon>[0]): void {
  const root = el('div', `res res--${key}`);
  const name = el('span', 'res-name');
  name.innerHTML = icon(iconName, 14) + ' ' + label;
  const val = el('span', 'res-val', '0');
  const rate = el('span', 'res-rate', '');
  root.append(name, val, rate);
  host.append(root);
  chips[key] = { root, val, rate };
}

function buildChrome(sim: Sim): void {
  const bar = qs(document, '#resBar');
  clear(bar);
  makeChip(bar, 'credits', 'Credits', 'credits');
  makeChip(bar, 'research', 'Research', 'research');
  makeChip(bar, 'security', 'Security', 'security');
  makeChip(bar, 'exotic', 'Exotic', 'exotic');
  makeChip(bar, 'mandate', 'Mandate', 'mandate');

  const tabs = qs(document, '#tabs');
  clear(tabs);
  VIEWS.forEach((v, i) => {
    const b = button('', 'tab');
    b.id = 'tab-' + v.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'view-' + v.id);
    b.innerHTML = `${icon(v.icon, 15)}<span>${v.label}</span><span class="tab-badge" id="badge-${v.id}"></span>`;
    b.title = `${v.label} (${i + 1})`;
    on(b, 'click', () => show(v.id));
    tabs.append(b);
  });

  eraLabel = qs(document, '#eraLabel');
  toastHost = qs(document, '#toasts');
  modalRoot = qs(document, '#modalRoot');
  announcer = qs(document, '#srAnnounce');

  on(qs(document, '#btnSaveNow'), 'click', () => ctx.saveNow());
  on(qs(document, '#brandHome'), 'click', (e) => {
    e.preventDefault();
    show('routes');
  });

  void sim;
}

function viewRoot(id: string): HTMLElement {
  return qs(document, '#view-' + id);
}

function show(id: string): void {
  const target = VIEWS.find((v) => v.id === id);
  if (!target) return;
  // A view can be shown straight after an action that invalidated the caches
  // (filing a charter, then jumping to the route table). Solve before drawing.
  ensureFresh(ctx.sim);
  const prev = VIEWS.find((v) => v.id === active);
  if (prev && prev.id !== id) prev.onHide?.(ctx);
  active = id;

  for (const v of VIEWS) {
    const root = viewRoot(v.id);
    const on_ = v.id === id;
    root.hidden = !on_;
    const tab = document.getElementById('tab-' + v.id);
    if (tab) {
      setClass(tab, 'is-active', on_);
      tab.setAttribute('aria-selected', on_ ? 'true' : 'false');
      tab.tabIndex = on_ ? 0 : -1;
    }
  }

  // Views are mounted lazily: the map builds a canvas and the network view
  // builds a page of cards, and neither is worth doing before it is looked at.
  if (!mounted.has(id)) {
    mounted.add(id);
    target.mount(viewRoot(id), ctx);
  }
  target.rebuild?.(ctx);
  target.onShow?.(ctx);
  target.update(ctx);
  viewRoot(id).focus({ preventScroll: true });
}

// ---------------------------------------------------------------- toasts ---

function toast(msg: string, kind: ToastKind = 'info'): void {
  const t = el('div', `toast toast--${kind}`);
  t.setAttribute('role', 'status');
  t.textContent = msg;
  toastHost.append(t);
  const life = kind === 'bad' ? 5200 : 3600;
  window.setTimeout(() => t.remove(), life);
  // Never let a burst of failures build an unbounded list.
  while (toastHost.childElementCount > 6) toastHost.firstElementChild?.remove();
}

// ---------------------------------------------------------------- modal ----

let lastFocused: HTMLElement | null = null;

function closeModal(): void {
  clear(modalRoot);
  lastFocused?.focus();
  lastFocused = null;
}

function openModal(title: string, body: Node | string, buttons: ModalButton[]): void {
  lastFocused = document.activeElement as HTMLElement | null;
  clear(modalRoot);
  const back = el('div', 'modal-backdrop');
  const modal = el('div', 'modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', title);

  const head = el('div', 'modal-head');
  head.append(el('h2', 'panel-title', title));
  const bodyEl = el('div', 'modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else bodyEl.append(body);
  const foot = el('div', 'modal-foot');

  for (const b of buttons) {
    const btn = button(b.label, b.cls ?? 'btn');
    on(btn, 'click', () => {
      const keep = b.onClick?.();
      if (keep !== false) closeModal();
    });
    foot.append(btn);
  }
  if (!buttons.length) {
    const btn = button('Close', 'btn');
    on(btn, 'click', closeModal);
    foot.append(btn);
  }

  modal.append(head, bodyEl, foot);
  back.append(modal);
  modalRoot.append(back);

  on(back, 'click', (e) => {
    if (e.target === back) closeModal();
  });
  // A dialog the keyboard can walk out of is not a dialog.
  on(modal, 'keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = Array.from(
      modal.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((n) => !n.hasAttribute('disabled'));
    if (!focusables.length) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  const firstBtn = modal.querySelector<HTMLElement>('.modal-body input, .modal-body textarea, .modal-foot button');
  firstBtn?.focus();
}

// ------------------------------------------------------------- resources ---

function paintResources(sim: Sim): void {
  const s = sim.state;
  const perReal = (d: Decimal): Decimal => d.mul(TIME_SCALE);

  setText(chips['credits']!.val, fmt(s.credits));
  setText(chips['credits']!.rate, '+' + fmt(perReal(sim.totals.credits)) + '/s');

  setText(chips['research']!.val, fmt(s.research));
  setText(chips['research']!.rate, '+' + fmt(perReal(sim.totals.research)) + '/s');

  setText(chips['security']!.val, fmt(perReal(sim.totals.security)) + '/s');
  const worst = worstInterdiction(sim);
  setText(chips['security']!.rate, worst > 0.001 ? `interdiction ×${(1 / (1 + worst)).toFixed(2)}` : 'clear');

  const showExotic = s.era >= 3;
  chips['exotic']!.root.hidden = !showExotic;
  if (showExotic) {
    setText(chips['exotic']!.val, fmt(s.exotic));
    const net = sim.totals.exoticProd.sub(sim.totals.exoticDraw);
    setText(chips['exotic']!.rate, (net.gte(0) ? '+' : '') + fmt(perReal(net)) + '/s'
      + (sim.throttle < 0.999 ? ` · supply ${fmtPct(sim.throttle, 0)}` : ''));
  }

  const showMandate = s.mandate.gt(0) || s.recharters > 0 || s.eraUnlocked > s.era;
  chips['mandate']!.root.hidden = !showMandate;
  if (showMandate) {
    setText(chips['mandate']!.val, fmt(s.mandate));
    setText(chips['mandate']!.rate, s.eraUnlocked > s.era ? 'recharter available' : `${s.recharters} filed`);
  }

  setText(eraLabel, `Era ${s.era} — ${ERA_NAMES[s.era] ?? '—'}`);

  const badge = document.getElementById('badge-stats');
  if (badge) setText(badge, s.eraUnlocked > s.era ? 'ACTION' : '');
  const rbadge = document.getElementById('badge-research');
  if (rbadge) setText(rbadge, '');
}

function worstInterdiction(sim: Sim): number {
  let worst = 0;
  for (const k of Object.keys(sim.state.interdiction)) {
    const v = sim.state.interdiction[k] ?? 0;
    if (v > worst) worst = v;
  }
  return worst;
}

// ----------------------------------------------------------------- setup ---

export interface AppHooks {
  saveNow(): void;
}

export function initApp(sim: Sim, hooks: AppHooks): UiCtx {
  ctx = {
    sim,
    toast,
    announce: (m: string) => setText(announcer, m),
    invalidate: () => {
      lastStructure = -1;
    },
    openModal,
    closeModal,
    saveNow: hooks.saveNow,
    goTo: show,
    focusNode: (id: string) => {
      focusNetworkNode(id);
    },
  };

  buildChrome(sim);
  show('routes');
  bindKeys();
  document.getElementById('app')?.setAttribute('aria-busy', 'false');
  return ctx;
}

/** Swap in a different state object (import, hard reset, recharter). */
export function rebindSim(next: Sim): void {
  ctx.sim = next;
  lastStructure = -1;
  for (const v of VIEWS) {
    if (mounted.has(v.id)) v.rebuild?.(ctx);
  }
}

function bindKeys(): void {
  on(document.body, 'keydown', (e) => {
    const t = e.target as HTMLElement | null;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= VIEWS.length) {
      e.preventDefault();
      show(VIEWS[n - 1]!.id);
      return;
    }
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      ctx.saveNow();
    } else if (e.key === '?') {
      e.preventDefault();
      show('settings');
    }
  });
}

/**
 * Called from the render loop. The resource bar repaints every frame because
 * it is five text nodes; the active view only repaints on `full`, because a
 * five-hundred-row table at 60 Hz is thirty thousand DOM writes a second for
 * digits nobody can read that fast.
 */
export function renderFrame(sim: Sim, full: boolean): void {
  ctx.sim = sim;
  ensureFresh(sim);
  paintResources(sim);
  if (!full) return;
  const v = VIEWS.find((x) => x.id === active);
  if (!v) return;
  if (sim.structureVersion !== lastStructure) {
    lastStructure = sim.structureVersion;
    v.rebuild?.(ctx);
  }
  v.update(ctx);
}

export function appToast(msg: string, kind: ToastKind = 'info'): void {
  toast(msg, kind);
}

export function appModal(title: string, body: Node | string, buttons: ModalButton[]): void {
  openModal(title, body, buttons);
}
