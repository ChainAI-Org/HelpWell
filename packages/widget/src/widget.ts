/**
 * The widget itself: one custom element holding one shadow root.
 *
 * Shadow DOM is not a preference here. The widget renders on pages whose CSS
 * it has never seen, and a shadow root is the only way to be sure a global
 * `button { }` rule on the host page does not reshape support (WG-01).
 */

import { Api, type WidgetConfig } from './api.js';
import { type Announcer, mountAnnouncements } from './changelog-notify.js';
import { renderPanel } from './components/shell.js';
import type { ViewContext } from './context.js';
import { h, svg } from './dom.js';
import { type Draggable, makeDraggable } from './drag.js';
import { type Engagements, mountEngagements } from './engage/index.js';
import { trapTab } from './focus.js';
import { registerWidgetFonts } from './fonts.js';
import { formsForHome, useFormsForHome } from './forms/home.js';
import { type Forms, type FormsListener, mountForms } from './forms/runtime.js';
import { icons, widgetMark } from './icons.js';
import { trustMediaOrigin } from './media.js';
import { watchNavigation } from './navigation.js';
import { createPreview, type WidgetPreview } from './preview-states.js';
import { mountProactive, type Proactive } from './proactive.js';
import { PROACTIVE_CSS } from './proactive-styles.js';
import { safeAccent, safeHttpUrl } from './sanitize.js';
import { launcherBadge, refreshUnread, type State, Store, shouldShow, type View } from './state.js';
import { incidentLevel, loadStatus } from './status.js';
import { widgetStyles } from './styles.js';

export interface WidgetOptions {
  /** Where the HelpWell API is mounted. Defaults to `/api/helpwell`. */
  apiUrl?: string;
  /** A signed identify token, from the host app's server. */
  token?: string;
  /** Open the panel as soon as it is ready. */
  open?: boolean;
  /** Force a theme rather than following the customer's setting. */
  theme?: 'light' | 'dark' | 'system';
  /**
   * `forms`: forms only, for a site that wants embeds and popups but no
   * chat. No launcher and no panel; everything else about forms works.
   * The loader sets it from `data-mode="forms"`.
   */
  mode?: 'full' | 'forms';
  fetch?: typeof globalThis.fetch;
}

const HOST_TAG = 'helpwell-widget';
/** The panel's id, which the launcher points at with aria-controls. */
export const PANEL_ID = 'hw-panel';
/** The breakpoint at which the panel becomes the whole screen (see styles). */
const PHONE = '(max-width: 480px)';

export class Widget {
  readonly api: Api;
  readonly store: Store;

  #host: HTMLElement | null = null;
  #root: ShadowRoot | null = null;
  #panel: HTMLElement | null = null;
  #launcher: HTMLElement | null = null;
  #engagements: Engagements | null = null;
  /** Messages a support extension wants shown (proactive.ts), when it offers any. */
  #proactive: Proactive | null = null;
  #announcer: Announcer | null = null;
  /** Embeds, popups and two-step buttons on the page (forms/runtime.ts). */
  #forms: Forms | null = null;
  /** Aborted whenever the view is replaced, so the old view stops working. */
  #render: AbortController | null = null;
  #history: View[] = [];
  #options: WidgetOptions;
  #teardown: (() => void)[] = [];
  #preview: WidgetPreview | null = null;
  /** With the Draggable placement: the visitor moving the launcher (drag.ts). */
  #drag: Draggable | null = null;
  /** Whether the display rules allow the widget on the current page. */
  #shown = false;
  #warned = false;

  constructor(options: WidgetOptions = {}) {
    this.#options = options;
    this.api = new Api({
      baseUrl: options.apiUrl ?? '/api/helpwell',
      fetch: options.fetch,
    });
    // Article images come from this API, by its full address.
    trustMediaOrigin(options.apiUrl ?? '/api/helpwell');
    this.store = new Store();
  }

  async mount(): Promise<void> {
    if (this.#host || this.#forms) return;

    let config: WidgetConfig | null;
    try {
      config = await this.api.config();
    } catch {
      // Without config there is nothing to render, and a broken support widget
      // must never break the page it is on.
      return;
    }
    // A 200 whose body is not a config (an HTML error page, say) is no config.
    if (!isConfig(config)) return;

    if (this.#options.token) {
      try {
        const result = await this.api.identify(this.#options.token);
        this.store.set({ identified: result.identified, firstName: firstNameOf(result) });
      } catch {
        // An invalid token means an anonymous visitor, not a failure.
      }
    }

    this.store.set({ config, unread: typeof config.unread === 'number' ? config.unread : 0 });

    // Forms run wherever the page has one, whether or not the chat shows.
    this.#mountForms(config);
    if (this.#options.mode === 'forms') {
      this.#teardown.push(watchNavigation(() => this.#forms?.refresh()));
      return;
    }

    this.#build(config);
    this.#subscribe();
    this.#syncVisibility();

    // A single-page app changes route without a reload. The display rules and
    // the engagements are per page, so they follow it (WG-09).
    this.#teardown.push(
      watchNavigation(() => {
        this.#syncVisibility();
        this.#engagements?.refresh();
        this.#proactive?.refresh();
        this.#forms?.refresh();
      }),
    );

    if (this.#options.open) this.open();

    void refreshUnread(this.api, this.store);
    void loadStatus(this.api, this.store);
    // New changelog entries, in whichever style Settings pick (CL-07), and
    // any inline feed the page has placed.
    if (this.#root) {
      this.#announcer = mountAnnouncements({
        api: this.api,
        store: this.store,
        root: this.#root,
        shown: () => this.#shown,
        open: (view) => this.open(view),
      });
    }
  }

  /* ------------------------------------------------------------ lifecycle */

  #mountForms(config: WidgetConfig): void {
    const formsOnly = this.#options.mode === 'forms';
    const forms = mountForms({
      api: this.api,
      apiUrl: this.#options.apiUrl ?? '/api/helpwell',
      config,
      openChat: formsOnly
        ? undefined
        : () => this.open({ name: 'chat', conversationId: this.store.state.conversationId }),
    });
    this.#forms = forms;
    // The Home tab's `form` block draws with this runtime (forms/home.ts).
    useFormsForHome(forms);
  }

  #visibleHere(config: WidgetConfig): boolean {
    return shouldShow(config.widget.displayRules, {
      path: location.pathname,
      identified: this.store.state.identified,
      isMobile: matchMedia('(max-width: 767px)').matches,
    });
  }

  /**
   * Put the widget on the page, or take it off, as the display rules say for
   * where the visitor is now. The element is built once and kept.
   */
  #syncVisibility(): void {
    const config = this.store.state.config;
    const host = this.#host;
    if (!config || !host) return;

    const shown = this.#visibleHere(config);
    if (shown === this.#shown) return;
    this.#shown = shown;

    if (shown) {
      document.body.appendChild(host);
      this.#engagements = mountEngagements(this);
      this.#mountProactive(config);
    } else {
      if (this.store.state.open) this.close();
      this.#engagements?.destroy();
      this.#engagements = null;
      this.#unmountProactive();
      host.remove();
    }
  }

  /** Only with a support extension that offers messages: nothing is asked for otherwise. */
  #mountProactive(config: WidgetConfig): void {
    if (!config.support?.proactive || !this.#root || this.#proactive) return;
    this.#proactive = mountProactive({
      api: this.api,
      store: this.store,
      container: this.#root,
      open: (view) => this.open(view),
      // Its pop-ups, banners and tours go to the one engage controller, to
      // take turns with Settings engagements (engage/index.ts).
      presentEngagement: (item, fields) => this.#engagements?.offer(item.engagement, fields),
      showEngagement: (id) => this.engage.show(id),
    });
  }

  #unmountProactive(): void {
    this.#proactive?.destroy();
    this.#proactive = null;
  }

  #build(config: WidgetConfig): void {
    const host = document.createElement(HOST_TAG);
    const appearance = config.widget.appearance;
    const theme = this.#options.theme ?? appearance.theme;
    const left = config.widget.position === 'bottom-left';
    // Draggable starts in the bottom-right corner, then goes where the visitor puts it.
    const draggable = config.widget.position === 'draggable';

    host.dataset.position = left ? 'bottom-left' : 'bottom-right';
    if (theme === 'light' || theme === 'dark') host.dataset.hwTheme = theme;

    const offset = config.widget.offset;
    Object.assign(host.style, {
      position: 'fixed',
      bottom: px(offset?.y, 24),
      zIndex: String(Number.isFinite(config.widget.zIndex) ? config.widget.zIndex : 2147483000),
      [left ? 'left' : 'right']: px(offset?.x, 24),
    });

    const root = host.attachShadow({ mode: 'open' });
    // The widget's own type, for a page that does not have it (fonts.ts).
    registerWidgetFonts(this.#options.apiUrl ?? '/api/helpwell');
    const style = document.createElement('style');
    style.textContent =
      widgetStyles({
        accent: appearance.accent,
        font: appearance.font,
        radius: appearance.radius,
        bubbleStyle: appearance.bubbleStyle,
      }) + (config.support?.proactive ? PROACTIVE_CSS : '');
    root.appendChild(style);

    const panel = h('div', {
      class: 'panel',
      id: PANEL_ID,
      role: 'dialog',
      'aria-label': 'Support',
      'aria-modal': 'false',
      'data-open': 'false',
      // Focus lands on the panel itself when it opens (A1).
      tabindex: '-1',
    });
    const launcher = this.#buildLauncher(config, left);
    root.append(panel, launcher);
    if (draggable) {
      this.#drag = makeDraggable({
        host,
        launcher,
        start: { h: 'right', x: offsetPx(offset?.x), v: 'bottom', y: offsetPx(offset?.y) },
      });
      this.#teardown.push(() => {
        this.#drag?.destroy();
        this.#drag = null;
      });
    }

    this.#host = host;
    this.#root = root;
    this.#panel = panel;
    this.#launcher = launcher;
    this.#syncBadge(this.store.state);

    // Escape closes, which people try before they look for the button, and
    // Tab stays inside the panel while focus is in it.
    const onKey = (event: KeyboardEvent) => {
      if (!this.store.state.open) return;
      if (event.key === 'Escape') this.close();
      else if (event.key === 'Tab') trapTab(event, panel, root.activeElement);
    };
    document.addEventListener('keydown', onKey);
    this.#teardown.push(() => document.removeEventListener('keydown', onKey));

    // On a phone the panel is the screen, so it has to make room for the
    // keyboard: the visual viewport is what shrinks when the keys come up.
    const viewport = window.visualViewport;
    if (viewport) {
      const fit = () => this.#fitViewport();
      viewport.addEventListener('resize', fit);
      viewport.addEventListener('scroll', fit);
      this.#teardown.push(() => {
        viewport.removeEventListener('resize', fit);
        viewport.removeEventListener('scroll', fit);
      });
    }
  }

  #buildLauncher(config: WidgetConfig, left: boolean): HTMLElement {
    const button = h('button', {
      class: 'launcher launcher--mark',
      type: 'button',
      'aria-label': 'Open support',
      'aria-expanded': 'false',
      'aria-controls': PANEL_ID,
      'data-open': 'false',
      style: { [left ? 'left' : 'right']: '0' },
    });

    // The mark IS the launcher. It is never set inside another circle. A
    // custom image is built as an element, never as markup: its URL and the
    // accent both come from settings, and neither is trusted as HTML.
    const open = h('span', { class: 'launcher__open' });
    const iconUrl = safeHttpUrl(config.widget.appearance.launcherIconUrl);
    open.appendChild(
      iconUrl
        ? h('img', { src: iconUrl, alt: '', width: '56', height: '56' })
        : svg(widgetMark(safeAccent(config.widget.appearance.accent))),
    );

    const close = h('span', { class: 'launcher__close' });
    close.appendChild(svg(icons.close));

    button.append(open, close);
    button.addEventListener('click', () => {
      // Letting go of a drag is not a request to open the panel.
      if (this.#drag?.endedDrag()) return;
      this.toggle();
    });
    return button;
  }

  #subscribe(): void {
    let lastView: View | null = null;
    let lastOpen = false;
    /** Who Home last greeted, so signing in or out while it shows re-greets. */
    let lastFirstName: string | null = null;

    this.#teardown.push(
      this.store.subscribe((state) => {
        // Rendering runs inside the host page's own event handlers, so a bug
        // here is reported once and never thrown at the page.
        try {
          if (!this.#panel || !this.#launcher) return;

          if (state.open !== lastOpen) {
            lastOpen = state.open;
            this.#setOpen(state.open);
          }

          // Re-render only when the view actually changed: chat manages its own
          // thread and must not be rebuilt under the person typing in it.
          const regreet = state.view.name === 'home' && state.firstName !== lastFirstName;
          if (state.open && (!sameView(state.view, lastView) || regreet)) {
            lastView = state.view;
            lastFirstName = state.firstName;
            this.#renderView();
          }

          this.#syncBadge(state);
        } catch (error) {
          this.#warn(error);
        }
      }),
    );
  }

  #setOpen(open: boolean): void {
    const panel = this.#panel;
    const launcher = this.#launcher;
    if (!panel || !launcher) return;
    panel.dataset.open = String(open);
    launcher.dataset.open = String(open);
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? 'Close support' : 'Open support');
    // Full-screen on a phone, with nothing behind it reachable: say so.
    panel.setAttribute('aria-modal', String(open && matchMedia(PHONE).matches));
    if (open) this.#fitViewport();
    else this.#host?.style.removeProperty('--hw-panel-height');
  }

  #fitViewport(): void {
    const viewport = window.visualViewport;
    if (!viewport || !this.#host || !this.store.state.open) return;
    this.#host.style.setProperty('--hw-panel-height', `${Math.round(viewport.height)}px`);
  }

  #renderView(): void {
    if (!this.#panel) return;
    this.#render?.abort();
    this.#render = new AbortController();
    renderPanel(this.#panel, this.#context(this.#render.signal));
  }

  #syncBadge(state: State): void {
    if (!this.#launcher) return;
    this.#syncStatusDot(state);
    const count = launcherBadge(state);
    const existing = this.#launcher.querySelector('.launcher__badge');
    if (count > 0 && !state.open) {
      if (existing) existing.textContent = badgeText(count);
      else
        this.#launcher.appendChild(h('span', { class: 'launcher__badge', text: badgeText(count) }));
    } else {
      existing?.remove();
    }
  }

  /** A small dot on the launcher while the status page reports a problem (WG-11). */
  #syncStatusDot(state: State): void {
    const level = incidentLevel(state.status);
    const existing = this.#launcher?.querySelector<HTMLElement>('.launcher__status');
    if (!level || state.open) {
      existing?.remove();
      return;
    }
    if (existing) {
      existing.dataset.level = level;
      return;
    }
    this.#launcher?.appendChild(
      h('span', { class: 'launcher__status', 'data-level': level, 'aria-hidden': 'true' }),
    );
  }

  #context(signal: AbortSignal): ViewContext {
    const store = this.store;
    return {
      api: this.api,
      store,
      // A getter, so a handler that runs later reads the state of that moment
      // rather than the snapshot the view was rendered from.
      get state() {
        return store.state;
      },
      signal,
      go: (view) => this.go(view),
      back: () => this.back(),
      close: () => this.close(),
      path: () => location.pathname + location.search,
    };
  }

  #warn(error: unknown): void {
    if (this.#warned) return;
    this.#warned = true;
    console.warn('helpwell: the widget hit an error while rendering.', error);
  }

  /* -------------------------------------------------------------- public */

  open(view?: View): void {
    if (!this.#shown) return;
    // The subscriber renders; setting state is the only thing open() does.
    this.store.set({ open: true, ...(view ? { view } : {}) });
    // Focus follows the panel in, and goes back to the launcher on close.
    this.#panel?.focus();
    void refreshUnread(this.api, this.store);
  }

  close(): void {
    // The host element is where the document sees focus while it is anywhere
    // inside the shadow root. Focus that is elsewhere on the page is left be.
    const hadFocus = document.activeElement === this.#host;
    this.store.set({ open: false });
    if (hadFocus) this.#launcher?.focus();
  }

  toggle(): void {
    if (this.store.state.open) this.close();
    else this.open();
  }

  go(view: View): void {
    this.#history.push(this.store.state.view);
    // Going to chat with no conversation is a deliberate fresh start, from
    // "Ask something else" or "New conversation": the old thread is let go,
    // so the first message does not land in it.
    if (view.name === 'chat' && view.conversationId === null) {
      this.store.set({
        view,
        conversationId: null,
        messages: [],
        sending: false,
        emailAsk: null,
        botVerified: false,
        proactiveId: null,
      });
      return;
    }
    this.store.set({ view });
  }

  back(): void {
    const previous = this.#history.pop();
    const view = this.store.state.view;
    // An article remembers where it was opened from, so the back button goes
    // to the search results rather than to the top of the help centre.
    if (view.name === 'article') {
      this.store.set({ view: view.from });
      return;
    }
    this.store.set({ view: previous ?? { name: 'home' } });
  }

  /** Attach a signed identity after mount, e.g. once the user signs in. */
  async identify(token: string): Promise<void> {
    const result = await this.api.identify(token);
    this.store.set({ identified: result.identified, firstName: firstNameOf(result) });
    this.#syncVisibility();
    void refreshUnread(this.api, this.store);
    this.#announcer?.refresh();
  }

  /**
   * Forget who this is: the visitor cookie on the server, and the thread and
   * identity here. For sign-out, so the next person at a shared computer does
   * not pick up someone else's conversation.
   */
  async reset(): Promise<void> {
    try {
      await this.api.resetVisitor();
    } finally {
      this.store.set({
        conversationId: null,
        messages: [],
        sending: false,
        identified: false,
        firstName: null,
        preChatDone: false,
        contact: { email: null, name: null },
        emailAsk: null,
        botVerified: false,
        proactiveId: null,
        view: { name: 'home' },
      });
      this.#history = [];
      this.#syncVisibility();
    }
  }

  track(name: string, props?: Record<string, unknown>): void {
    void this.api.track(name, props, location.pathname).catch(() => {
      // Analytics must never surface an error to a visitor.
    });
    // An engagement can be waiting for this event (its trigger is `event`).
    this.#engagements?.event(name);
    this.#proactive?.event(name);
    this.#forms?.event(name);
  }

  /** `helpwell.engage.show(id)` and `.hide()`: engagements on demand, from the page's code. */
  /** `helpwell.forms.show(id)`, `.on('submit', cb)` and `.off`: forms from the page's code. */
  readonly forms = {
    show: (id: string): void => this.#forms?.show(id),
    on: (event: string, listener: FormsListener): (() => void) =>
      this.#forms?.on(event, listener) ?? (() => {}),
    off: (event: string, listener: FormsListener): void => this.#forms?.off(event, listener),
  };

  readonly engage = {
    show: (id: string): void => this.#engagements?.show(id),
    hide: (): void => this.#engagements?.hide(),
  };

  /**
   * `helpwell.widget.preview.show(state)`: the widget in a state that is hard to wait for (a
   * message over the launcher, an answer with its source, the email card, a banner), drawn from
   * made-up local data. Nothing is fetched, sent or stored; `reset()` puts everything back. See
   * preview-states.ts.
   */
  get preview(): WidgetPreview {
    this.#preview ??= createPreview({
      store: this.store,
      root: () => this.#root,
      open: (view) => this.open(view),
      suspendLive: () => {
        this.#unmountProactive();
        this.#engagements?.hide();
      },
      resumeLive: () => {
        const config = this.store.state.config;
        if (config && this.#shown) this.#mountProactive(config);
      },
    });
    return this.#preview;
  }

  destroy(): void {
    this.#preview?.destroy();
    this.#preview = null;
    for (const fn of this.#teardown.splice(0)) fn();
    this.#render?.abort();
    this.#render = null;
    this.#engagements?.destroy();
    this.#engagements = null;
    this.#unmountProactive();
    this.#announcer?.destroy();
    if (this.#forms && formsForHome() === this.#forms) useFormsForHome(null);
    this.#forms?.destroy();
    this.#forms = null;
    this.#announcer = null;
    this.#host?.remove();
    this.#host = null;
    this.#root = null;
    this.#panel = null;
    this.#launcher = null;
    this.#shown = false;
  }

  get shadowRoot(): ShadowRoot | null {
    return this.#root;
  }
}

function sameView(a: View, b: View | null): boolean {
  if (!b) return false;
  if (a.name !== b.name) return false;
  if (a.name === 'article' && b.name === 'article') return a.slug === b.slug;
  if (a.name === 'entry' && b.name === 'entry') return a.id === b.id;
  if (a.name === 'collection' && b.name === 'collection') return a.collection === b.collection;
  if (a.name === 'chat' && b.name === 'chat') return a.conversationId === b.conversationId;
  return true;
}

/** What the launcher's badge says: the count, and "9+" past nine. */
export function badgeText(count: number): string {
  return count > 9 ? '9+' : String(count);
}

/** A pixel length from settings, or the fallback when it is not a number. */
function px(value: unknown, fallback: number): string {
  return `${offsetPx(value, fallback)}px`;
}

function offsetPx(value: unknown, fallback = 24): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Whether a `/config` body is one. The client returns whatever parsed, which
 * for a misrouted request can be null or a page of HTML, and the widget
 * should quietly not mount rather than throw at the host page.
 */
/** What to greet a signed-in visitor by: a short plain name, or nothing. */
function firstNameOf(result: { identified: boolean; firstName?: unknown }): string | null {
  if (!result.identified || typeof result.firstName !== 'string') return null;
  const name = result.firstName.trim();
  return name && name.length <= 40 ? name : null;
}

function isConfig(value: unknown): value is WidgetConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  const widget = config.widget as Record<string, unknown> | undefined;
  return (
    isObject(config.product) &&
    isObject(widget) &&
    isObject(widget.appearance) &&
    isObject(widget.displayRules) &&
    isObject(config.helpCenter) &&
    isObject(config.changelog)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
