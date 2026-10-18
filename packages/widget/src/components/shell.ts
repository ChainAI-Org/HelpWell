/**
 * The panel: header, the current view, the tab bar and the credit line.
 *
 * Rendering is view-at-a-time rather than diffed. The whole panel is at most a
 * few hundred nodes, and rebuilding one view is what makes the page transition
 * a real animation on a real element instead of a CSS class fight.
 */

import type { ViewContext } from '../context.js';
import { h, replace, svg } from '../dom.js';
import { fillGreeting } from '../greeting.js';
import { icons, wordmark } from '../icons.js';
import { tabFor, unreadBadge, type View } from '../state.js';
import { agentAvatar, agentOf } from './agent.js';
import { chatView } from './chat.js';
import { iconEl, titleCase } from './common.js';
import { articleView, collectionView, helpView } from './help.js';
import { homeView } from './home.js';
import { messagesView } from './messages.js';
import { roadmapView } from './roadmap.js';
import { entryView, updatesView } from './updates.js';

const TABS = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'messages', label: 'Messages', icon: 'message' },
  { key: 'help', label: 'Help', icon: 'help' },
  { key: 'updates', label: 'Updates', icon: 'updates' },
  { key: 'roadmap', label: 'Roadmap', icon: 'roadmap' },
] as const;

/** The body's id: every tab points at it, and it points back at the selected tab. */
const TABPANEL_ID = 'hw-tabpanel';
const tabId = (key: string) => `hw-tab-${key}`;

export function renderPanel(panel: HTMLElement, context: ViewContext): void {
  const { state } = context;
  const view = state.view;

  const body = bodyFor(context, view);
  const tabs = tabBar(context);
  if (tabs) {
    // The body is the panel of whichever tab is selected.
    body.setAttribute('role', 'tabpanel');
    body.id = TABPANEL_ID;
    body.setAttribute('aria-labelledby', tabId(tabFor(view)));
  }

  replace(
    panel,
    header(context),
    body,
    tabs,
    state.config?.helpCenter.poweredBy !== false ? creditLine() : null,
  );
}

/* --------------------------------------------------------------- header */

function header(context: ViewContext): HTMLElement {
  const { state } = context;
  const view = state.view;
  const product = state.config?.product.name ?? 'Support';
  const appearance = state.config?.widget.appearance;

  const detail = titleFor(view, product, state.firstName ?? null, state.config?.widget.greeting);
  const canGoBack = view.name === 'article' || view.name === 'entry' || view.name === 'collection';

  const row = h('div', { class: 'panel__headerRow' });
  if (canGoBack) {
    const back = h('button', {
      class: 'panel__back',
      type: 'button',
      'aria-label': 'Back',
      on: { click: () => context.back() },
    });
    back.appendChild(iconEl('back'));
    row.appendChild(back);
  }
  if (view.name === 'chat') {
    // In a conversation the header says who is answering: the agent's
    // avatar and name from Settings.
    const agent = agentOf(state.config);
    row.appendChild(
      h(
        'div',
        { class: 'panel__agent' },
        agentAvatar(state.config, 32, { onAccent: true }),
        h(
          'div',
          { class: 'panel__agentText' },
          h('h2', { class: 'panel__title', text: agent.name }),
          h('span', { class: 'panel__agentRole', text: 'AI agent' }),
        ),
      ),
    );
  } else {
    row.appendChild(h('h2', { class: 'panel__title', text: detail.title }));
  }

  const close = h('button', {
    class: 'panel__back',
    type: 'button',
    'aria-label': 'Close',
    style: { marginInlineStart: 'auto' },
    on: { click: () => context.close() },
  });
  close.appendChild(iconEl('close'));
  row.appendChild(close);

  // A plain header on reading views, so the article is the loudest thing.
  const plain = canGoBack;
  const el = h('div', { class: `panel__header${plain ? ' panel__header--plain' : ''}` });

  if (!plain && appearance?.pattern && appearance.pattern !== 'none') {
    el.appendChild(patternLayer(appearance.pattern, appearance.patternImageUrl));
  }
  el.appendChild(row);
  if (detail.subtitle) el.appendChild(h('p', { class: 'panel__subtitle', text: detail.subtitle }));

  return el;
}

/**
 * The header's words for a view. Home greets a visitor the host app
 * identified by their first name, when it sent one; everyone else is "there".
 * The owner can replace either line (`widget.greeting`): unset keeps these,
 * and `{{ product.name }}` and `{{ contact.first_name }}` (or the original
 * `{product}` and `{first_name}`) in what they wrote are filled in
 * (../greeting.ts).
 */
function titleFor(
  view: View,
  product: string,
  firstName: string | null,
  greeting?: { title?: string; subtitle?: string },
): { title: string; subtitle?: string } {
  const fill = (text: string) => fillGreeting(text, { product, firstName });
  switch (view.name) {
    case 'home': {
      const title = typeof greeting?.title === 'string' ? greeting.title.trim() : '';
      const subtitle = typeof greeting?.subtitle === 'string' ? greeting.subtitle.trim() : '';
      return {
        title: title ? fill(title) : `Hi ${firstName ?? 'there'}`,
        subtitle: subtitle ? fill(subtitle) : `How can we help with ${product}?`,
      };
    }
    case 'messages':
      return { title: 'Messages' };
    case 'chat':
      return { title: 'Ask us anything' };
    case 'help':
      return { title: 'Help center' };
    case 'collection':
      return { title: view.title ?? titleCase(view.collection) };
    case 'article':
      return { title: 'Article' };
    case 'updates':
      return { title: "What's new" };
    case 'entry':
      return { title: 'Update' };
    case 'roadmap':
      return { title: 'Roadmap' };
  }
}

/**
 * The decorative header wash. Drawn rather than loaded, so it costs nothing
 * and cannot fail to arrive.
 */
function patternLayer(pattern: string, imageUrl: string | null): HTMLElement {
  if (pattern === 'image' && imageUrl) {
    return h('div', {
      class: 'panel__pattern',
      style: {
        backgroundImage: `url(${JSON.stringify(imageUrl)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      },
    });
  }

  const fills: Record<string, string> = {
    dots: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,.35) 1px, transparent 0)',
    grid: 'linear-gradient(rgba(255,255,255,.18) 1px, transparent 0), linear-gradient(90deg, rgba(255,255,255,.18) 1px, transparent 0)',
    waves: 'radial-gradient(120% 80% at 80% -20%, rgba(255,255,255,.28), transparent 60%)',
  };

  return h('div', {
    class: 'panel__pattern',
    style: {
      backgroundImage: fills[pattern] ?? fills.waves!,
      backgroundSize: pattern === 'grid' ? '18px 18px' : pattern === 'dots' ? '14px 14px' : 'auto',
    },
  });
}

/* ----------------------------------------------------------------- body */

function bodyFor(context: ViewContext, view: View): HTMLElement {
  // Chat brings its own body and composer, because the composer is pinned
  // outside the scrolling area.
  if (view.name === 'chat') return chatView(context);

  const body = h('div', { class: 'panel__body' });
  switch (view.name) {
    case 'home':
      body.appendChild(homeView(context));
      break;
    case 'messages':
      body.appendChild(messagesView(context));
      break;
    case 'help':
      body.appendChild(helpView(context));
      break;
    case 'collection':
      body.appendChild(collectionView(context, view.collection));
      break;
    case 'article':
      body.appendChild(articleView(context, view.slug));
      break;
    case 'updates':
      body.appendChild(updatesView(context));
      break;
    case 'entry':
      body.appendChild(entryView(context, view.id));
      break;
    case 'roadmap':
      body.appendChild(roadmapView(context));
      break;
  }
  return body;
}

/* ----------------------------------------------------------------- tabs */

/**
 * The tab bar, as the ARIA tabs pattern: one tab in the Tab order, the arrow
 * keys move focus between them, and Enter or Space (a button's own keys)
 * opens one. Activation is deliberate rather than on focus, because every tab
 * fetches something.
 */
function tabBar(context: ViewContext): HTMLElement | null {
  const config = context.state.config;
  if (!config) return null;

  const enabled = TABS.filter((tab) => {
    if (!config.widget.tabs[tab.key]) return false;
    if (tab.key === 'updates' && !config.changelog.widgetTab) return false;
    if (tab.key === 'roadmap' && !config.changelog.roadmapEnabled) return false;
    return true;
  });

  // One tab is not a tab bar.
  if (enabled.length < 2) return null;

  const current = tabFor(context.state.view);
  const focusable = Math.max(
    0,
    enabled.findIndex((tab) => tab.key === current),
  );
  const bar = h('div', { class: 'tabbar', role: 'tablist', 'aria-label': 'Sections' });

  const buttons = enabled.map((tab, index) => {
    const button = h('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      id: tabId(tab.key),
      'aria-selected': String(current === tab.key),
      'aria-controls': TABPANEL_ID,
      tabindex: index === focusable ? '0' : '-1',
      on: { click: () => context.go(viewForTab(tab.key, context)) },
    });
    button.appendChild(svg(icons[tab.icon]));
    button.appendChild(h('span', { text: tab.label }));
    if (tab.key === 'updates' && unreadBadge(context.state) > 0) {
      button.appendChild(h('span', { class: 'tab__dot' }));
    }
    return button;
  });

  bar.addEventListener('keydown', (event: KeyboardEvent) => {
    const from = buttons.indexOf(event.target as HTMLButtonElement);
    if (from < 0) return;
    const count = buttons.length;
    let to: number;
    switch (event.key) {
      case 'ArrowRight':
        to = (from + 1) % count;
        break;
      case 'ArrowLeft':
        to = (from - 1 + count) % count;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    buttons[from]!.tabIndex = -1;
    buttons[to]!.tabIndex = 0;
    buttons[to]!.focus();
  });

  bar.append(...buttons);
  return bar;
}

function viewForTab(key: (typeof TABS)[number]['key'], context: ViewContext): View {
  if (key === 'messages') {
    // Straight back into the open conversation rather than a list of one.
    const id = context.state.conversationId;
    return id ? { name: 'chat', conversationId: id } : { name: 'messages' };
  }
  return { name: key } as View;
}

/* --------------------------------------------------------------- footer */

// The credit link keeps the referrer (the host page's own referrer policy
// decides how much; browsers default to the origin only), so helpwell.ai can
// see which site a click came from. The widget itself still sends nothing.
const CREDIT_URL = 'https://helpwell.ai/?utm_source=helpwell-widget&utm_medium=powered-by';

function creditLine(): HTMLElement {
  const link = h('a', {
    href: CREDIT_URL,
    target: '_blank',
    rel: 'noopener',
  });
  link.appendChild(document.createTextNode('Powered by '));
  link.appendChild(svg(wordmark('currentColor', 'hw-credit')));
  return h('div', { class: 'poweredBy' }, link);
}
