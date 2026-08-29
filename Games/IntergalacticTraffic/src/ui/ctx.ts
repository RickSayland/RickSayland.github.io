import type { Sim } from '../sim/engine';
import type { IconName } from './icons';

export type ToastKind = 'good' | 'bad' | 'info';

export interface ModalButton {
  label: string;
  cls?: string;
  /** Return false to keep the modal open. */
  onClick?: () => boolean | void;
}

/** Everything a view is allowed to reach for. Views never import each other. */
export interface UiCtx {
  sim: Sim;
  toast(msg: string, kind?: ToastKind): void;
  /** Routed to an aria-live region for screen readers. */
  announce(msg: string): void;
  /** Force every mounted view to rebuild its structure on the next frame. */
  invalidate(): void;
  openModal(title: string, body: Node | string, buttons: ModalButton[]): void;
  closeModal(): void;
  saveNow(): void;
  goTo(viewId: string): void;
  /** Set by the network view so the map can hand off a clicked endpoint. */
  focusNode(id: string): void;
}

export interface View {
  id: string;
  label: string;
  icon: IconName;
  /** Called once. Build the static skeleton here. */
  mount(root: HTMLElement, ctx: UiCtx): void;
  /** ~10 Hz while visible. Text and class updates only — no structural work. */
  update(ctx: UiCtx): void;
  /** Structure changed (routes added, era advanced, tech bought) or view shown. */
  rebuild?(ctx: UiCtx): void;
  /** Called when the view becomes visible. */
  onShow?(ctx: UiCtx): void;
  /** Called when the view is hidden, so a canvas can stop drawing. */
  onHide?(ctx: UiCtx): void;
}
