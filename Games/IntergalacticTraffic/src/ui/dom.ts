/** Small DOM helpers. There is no framework here on purpose: the route table
 *  updates 10 times a second and reconciling it would cost more than it saves. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function frag(html: string): DocumentFragment {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content;
}

export function clear(n: Element): void {
  while (n.firstChild) n.removeChild(n.firstChild);
}

export function qs<T extends Element = HTMLElement>(root: ParentNode, sel: string): T {
  const n = root.querySelector(sel);
  if (!n) throw new Error(`missing element ${sel}`);
  return n as unknown as T;
}

export function on<K extends keyof HTMLElementEventMap>(
  n: Element, ev: K, fn: (e: HTMLElementEventMap[K]) => void,
): void {
  n.addEventListener(ev, fn as EventListener);
}

/** Only touches the DOM when the value actually changed. */
export function setText(n: Node & { textContent: string | null }, v: string): void {
  if (n.textContent !== v) n.textContent = v;
}

export function setClass(n: Element, cls: string, want: boolean): void {
  if (n.classList.contains(cls) !== want) n.classList.toggle(cls, want);
}

export function setAttr(n: Element, name: string, v: string | null): void {
  if (v === null) {
    if (n.hasAttribute(name)) n.removeAttribute(name);
  } else if (n.getAttribute(name) !== v) {
    n.setAttribute(name, v);
  }
}

/** Escapes text destined for an innerHTML template literal. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;'
      : c === '"' ? '&quot;' : '&#39;'
  ));
}

export function button(label: string, cls = 'btn', title?: string): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  if (title) b.title = title;
  return b;
}
