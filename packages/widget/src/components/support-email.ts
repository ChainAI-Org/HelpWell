/**
 * "Email us at …": where a visitor can write when the agent cannot help.
 *
 * The open source build has no inbox and sends nothing, so this is only ever
 * a `mailto:` link: the visitor writes from their own mail client and the
 * team answers from theirs. It is quiet on purpose, a line of muted text
 * rather than a button, because the answer the visitor wanted is still the
 * docs, and the email is the way out when those fall short.
 *
 * The server sends the address only when no support extension handles human
 * replies (then the extension's own flow is how people reach a person), and
 * the views check `config.support` again, so the two can never both show.
 */

import type { WidgetConfig } from '../api.js';
import { h } from '../dom.js';

/** A plain address, with nothing a mailto link could read as more. */
const ADDRESS = /^[^\s@<>()[\]\\,;:"'?&=/]+@[^\s@<>()[\]\\,;:"'?&=/]+\.[^\s@<>()[\]\\,;:"'?&=/]+$/;

/** The address to offer, or null: none set, not an address, or a support extension answers. */
export function supportEmailOf(config: WidgetConfig | null | undefined): string | null {
  if (!config || config.support) return null;
  const address = config.product.supportEmail?.trim() ?? '';
  return address.length <= 254 && ADDRESS.test(address) ? address : null;
}

/** The line itself: "Email us at support@acme.com", the address a mailto link. */
export function supportEmailLine(address: string, className = ''): HTMLElement {
  return h(
    'p',
    { class: `supportEmail${className ? ` ${className}` : ''}` },
    h('span', { text: 'Email us at ' }),
    h('a', { href: `mailto:${address}`, text: address }),
  );
}
