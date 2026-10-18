/**
 * A ~40 line DOM helper.
 *
 * The widget renders on someone else's page, so shipping a framework is a cost
 * their users pay. Plain elements keep the bundle small and make the motion
 * work easier to reason about, since every transition is on a real node.
 */

type Child = Node | string | number | null | undefined | false;

export interface Attrs {
  class?: string;
  text?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  /** Event handlers, e.g. `{ click: () => ... }`. */
  on?: Record<string, (event: never) => void>;
  [key: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

export function svg(markup: string, className?: string): SVGElement {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = markup.trim();
  const node = wrapper.firstElementChild as SVGElement;
  if (className) node.setAttribute('class', className);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

function applyAttrs(el: HTMLElement, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    switch (key) {
      case 'class':
        el.className = String(value);
        break;
      case 'text':
        el.textContent = String(value);
        break;
      case 'html':
        el.innerHTML = String(value);
        break;
      case 'style':
        if (typeof value === 'string') el.setAttribute('style', value);
        else Object.assign(el.style, value);
        break;
      case 'on':
        for (const [event, handler] of Object.entries(value as Record<string, EventListener>)) {
          el.addEventListener(event, handler);
        }
        break;
      default:
        el.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

/** Replace everything inside a node in one go. */
export function replace(parent: Element, ...children: Child[]): void {
  parent.textContent = '';
  append(parent, children);
}

/**
 * A search snippet, ready for innerHTML.
 *
 * The API escapes the whole snippet itself and puts back only the `<mark>`
 * tags around the matches, so escaping it again here would turn `&amp;` into
 * `&amp;amp;`. It goes in as it came; the one thing done to it is that any
 * other tag, or a `<mark>` carrying attributes, is dropped, so the trust
 * extends to exactly those two tags and no further.
 */
export function markedSnippet(snippet: string): string {
  return snippet.replace(/<(?!\/?mark>)[^>]*>/g, '');
}
