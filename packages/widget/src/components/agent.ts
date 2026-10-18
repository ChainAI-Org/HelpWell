/**
 * Who answers: the agent's name and avatar, from Settings.
 *
 * One setting, drawn wherever the agent speaks: beside its replies and in
 * the chat header (design/GUIDE.md, "Agent identity"). The default is the
 * HelpWell mark itself, bare: never inside a circle. A custom image is built
 * as an element from a checked URL, never as markup.
 */

import type { WidgetConfig } from '../api.js';
import { h, svg } from '../dom.js';
import { widgetMark } from '../icons.js';
import { safeAccent, safeHttpUrl } from '../sanitize.js';

export interface AgentIdentity {
  name: string;
  avatarUrl: string | null;
}

/** The agent from config; an older server sends none, which means "Fern" and the mark. */
export function agentOf(config: WidgetConfig | null | undefined): AgentIdentity {
  const agent = config?.agent;
  const name = typeof agent?.name === 'string' && agent.name.trim() ? agent.name.trim() : 'Fern';
  return { name: name.slice(0, 60), avatarUrl: safeHttpUrl(agent?.avatarUrl ?? null) };
}

/**
 * The avatar at `size` pixels. Decorative: the name is always said beside it.
 * `onAccent` draws the mark reversed, white, for the accent-coloured header,
 * where the purple mark would vanish into its own background.
 */
export function agentAvatar(
  config: WidgetConfig | null | undefined,
  size: number,
  options: { onAccent?: boolean } = {},
): HTMLElement {
  const { avatarUrl } = agentOf(config);
  const holder = h('span', {
    class: `agentAvatar${avatarUrl ? '' : ' agentAvatar--mark'}`,
    'aria-hidden': 'true',
    style: { width: `${size}px`, height: `${size}px` },
  });
  if (avatarUrl) {
    holder.appendChild(
      h('img', { src: avatarUrl, alt: '', width: String(size), height: String(size) }),
    );
  } else {
    const accent = safeAccent(config?.widget.appearance.accent);
    const mark = svg(
      options.onAccent ? widgetMark('#FFFFFF', '#FFFFFF', accent) : widgetMark(accent),
    );
    // The mark's own label is for the launcher; here it is decoration.
    mark.removeAttribute('role');
    mark.removeAttribute('aria-label');
    holder.appendChild(mark);
  }
  return holder;
}
