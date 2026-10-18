/**
 * The support email visitors are shown, and when they are shown none.
 *
 * `product.supportEmail` is where people can write when the agent cannot
 * help. The open source build has no inbox and sends nothing, so the address
 * is only ever a `mailto:` link: the person writes from their own mail
 * client, and the founder answers from theirs. The widget shows it under an
 * unresolved answer and on Home; the help centre in its footer and after an
 * article is voted unhelpful.
 *
 * Never when a support extension handles human replies: that extension's own
 * flow (a handoff, a teammate in the thread) is how people reach a person
 * then, and a second way round it would split the conversation. Nor when the
 * setting is not an address, since it lands in an href.
 */

import type { Settings } from './schema.js';

/**
 * A plain address with nothing a `mailto:` link could read as more: no
 * spaces, no `?` headers, no second recipient, no markup.
 */
const ADDRESS = /^[^\s@<>()[\]\\,;:"'?&=/]+@[^\s@<>()[\]\\,;:"'?&=/]+\.[^\s@<>()[\]\\,;:"'?&=/]+$/;

/** The address, when it is one. */
export function supportAddress(value: string | null | undefined): string | null {
  const address = value?.trim() ?? '';
  return address.length <= 254 && ADDRESS.test(address) ? address : null;
}

/**
 * The support email to show visitors, or null: when none is set, when it is
 * not an address, or when `humanSupport` says a support extension answers
 * people for this install.
 */
export function publicSupportEmail(
  settings: Pick<Settings, 'product'>,
  options: { humanSupport: boolean },
): string | null {
  if (options.humanSupport) return null;
  return supportAddress(settings.product.supportEmail);
}
