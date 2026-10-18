/**
 * Forms on the host page: embeds, the ones a trigger pops up, two-step
 * buttons, `helpwell.forms.show(id)`, and the widget's Home tab.
 *
 * It runs whether or not the chat widget is showing: a marketing site can
 * load the script with `data-mode="forms"` for forms alone, and a page the
 * widget's display rules exclude can still carry an embed. The flow:
 *
 *   Embeds     every `[data-helpwell-form="id"]` on the page, including ones
 *              a single-page app adds later, is drawn in place
 *              (`POST /forms/:id/render`, placement `inline`).
 *   Triggered  `GET /forms/display` lists what this page view could pop up,
 *              and each arms its trigger with engage's own `armTrigger`.
 *              When one fires, it is claimed and drawn (placement `popup`,
 *              `slidein`, `bar` or `welcome`); the server applies the
 *              frequency rule and the global cap it shares with engagements.
 *              One modal form at a time.
 *   Two-step   any `[data-helpwell-form-open="id"]` opens that form as a popup.
 *
 * Every drawing comes with a signed render token, which its submission
 * carries back. Drawing never throws at the page: a form that cannot be
 * drawn is simply not there.
 */

import type { Api, WidgetConfig } from '../api.js';
import { ApiError } from '../api.js';
import { armTrigger, EventHub } from '../engage/triggers.js';
import { sessionId, visitParams } from '../engage/visit.js';
import { browserId } from '../proactive.js';
import { safeAccent } from '../sanitize.js';
import { humanCheck } from '../turnstile.js';
import { normalizeForm } from './normalize.js';
import { drawForm, type FormHost } from './render.js';
import { applyFormStyles } from './styles.js';
import {
  embedRoot,
  isModal,
  type Mounted,
  mountInline,
  mountOverlay,
  overlayLayer,
} from './surfaces.js';
import type {
  EntryState,
  FormPlacement,
  FormSubmitEvent,
  SubmitBody,
  SubmitResult,
  TriggeredPlacement,
  WidgetForm,
} from './types.js';

export interface FormsOptions {
  api: Api;
  /** Where the API is, for the download links a submission returns. */
  apiUrl: string;
  config: WidgetConfig | null;
  /** Open the support chat; absent in forms-only mode, where there is none. */
  openChat?: () => void;
}

export type FormsListener = (event: FormSubmitEvent) => void;

export interface Forms {
  /** Look for embeds again (the runtime also watches the page for new ones). */
  scan(): void;
  /** The page moved on: take down the triggered ones and ask again. */
  refresh(): void;
  /** `helpwell.forms.show(id)`: open a form as a popup now. */
  show(id: string): void;
  /** `helpwell.forms.on('submit', cb)`. Returns a function that stops listening. */
  on(event: string, listener: FormsListener): () => void;
  off(event: string, listener: FormsListener): void;
  /** `helpwell('track', name)`: fire the triggers waiting for that event. */
  event(name: string): void;
  /** Draw a form into the widget's Home tab. */
  homeBlock(formId: string, signal: AbortSignal): HTMLElement;
  destroy(): void;
}

interface RenderResponse {
  shown?: boolean;
  reason?: string;
  form?: unknown;
  variant?: string;
  placement?: FormPlacement;
  token?: string;
  state?: { submitted?: boolean; giveaway?: EntryState | null };
}

const EMBED = '[data-helpwell-form]';
const OPENER = '[data-helpwell-form-open]';
const DONE = 'hw:forms:done:';
const ENTRY = 'hw:forms:entry:';
const REF = 'hw:forms:ref';

export function mountForms(options: FormsOptions): Forms {
  const { api } = options;
  const accent = safeAccent(options.config?.widget?.appearance?.accent);
  const events = new EventHub();
  const listeners = new Set<FormsListener>();
  const embeds = new WeakMap<Element, string>();
  const disarms: (() => void)[] = [];
  let overlay: { root: ShadowRoot; host: HTMLElement } | null = null;
  let open: Mounted | null = null;
  const onScreen = new Map<string, Mounted>();
  let generation = 0;
  let stopped = false;
  let warned = false;
  rememberReferral();

  const warn = (error: unknown) => {
    if (warned) return;
    warned = true;
    console.warn('helpwell: a form could not be shown.', error);
  };

  const render = (id: string, placement: FormPlacement, manual = false) =>
    api.request<RenderResponse>(`/forms/${encodeURIComponent(id)}/render`, {
      method: 'POST',
      json: {
        placement,
        manual,
        visitor: browserId(),
        session: sessionId(),
        page: { ...page(), ...deviceAndLanguage() },
        entryKey: read('local', `${ENTRY}${id}`) ?? undefined,
      },
    });

  /** The host a drawn form talks through, for one drawing and its token. */
  const hostFor = (
    form: WidgetForm,
    placement: FormPlacement,
    variant: string,
    token: string,
    replace: (formId: string) => void,
  ): FormHost => {
    const siteKey = options.config?.botCheck?.siteKey;
    let check: ReturnType<typeof humanCheck> | null = null;
    return {
      preview: false,
      apiUrl: options.apiUrl,
      submit: (body) =>
        api.request<SubmitResult>(`/forms/${encodeURIComponent(form.id)}/submit`, {
          method: 'POST',
          json: { ...body, token } satisfies SubmitBody,
        }),
      humanToken: siteKey
        ? async (container) => {
            check ??= humanCheck(siteKey, container);
            return check.token();
          }
        : undefined,
      claimAction: async (entryKey, actionId) => {
        const result = await api.request<{ giveaway: EntryState }>(
          `/forms/${encodeURIComponent(form.id)}/giveaway/action`,
          { method: 'POST', json: { entryKey, actionId } },
        );
        return result.giveaway;
      },
      act: (action, value) => {
        if (action === 'chat') options.openChat?.();
        else if (action === 'form' && value) replace(value);
      },
      submitted: (result, answers, email) => {
        if (result.status !== 'received') write('local', `${DONE}${form.id}`, '1');
        if (result.giveaway?.entryKey)
          write('local', `${ENTRY}${form.id}`, result.giveaway.entryKey);
        const event: FormSubmitEvent = {
          formId: form.id,
          submissionId: result.submissionId,
          placement,
          variant,
          status: result.status,
          email,
          fields: answers,
        };
        for (const listener of [...listeners]) {
          try {
            listener(event);
          } catch (error) {
            console.warn('helpwell: a forms.on("submit") listener threw.', error);
          }
        }
        window.dispatchEvent(new CustomEvent('helpwell:form-submit', { detail: event }));
      },
      referral: () => read('session', REF),
      page,
    };
  };

  /** Draw a render answer into a surface. Returns false when there is nothing to draw. */
  const draw = (
    response: RenderResponse,
    placement: FormPlacement,
    mount: (form: WidgetForm) => Mounted,
    onDismiss?: () => void,
  ): Mounted | null => {
    const form = normalizeForm(response.form);
    if (!form || !response.token) return null;
    const mounted = mount(form);
    const variant = response.variant ?? 'a';
    const replace = (next: string) => {
      void render(next, placement === 'home' ? 'home' : 'inline', true)
        .then((answer) => {
          if (!answer?.shown) return;
          const nextForm = normalizeForm(answer.form);
          if (!nextForm || !answer.token) return;
          const drawn = drawForm(
            nextForm,
            hostFor(nextForm, placement, answer.variant ?? 'a', answer.token, replace),
            {
              placement,
              accent,
              onClose: onDismiss ? () => mounted.dismiss() : undefined,
            },
          );
          mounted.slot.replaceChildren(drawn.el);
          drawn.focus();
        })
        .catch(warn);
    };
    const drawn = drawForm(form, hostFor(form, placement, variant, response.token, replace), {
      placement,
      accent,
      onClose: onDismiss ? () => mounted.dismiss() : undefined,
      done: response.state?.submitted ? { giveaway: response.state.giveaway ?? null } : null,
    });
    mounted.slot.appendChild(drawn.el);
    return mounted;
  };

  const layer = () => {
    overlay ??= overlayLayer();
    overlay.host.style.setProperty('--hw-engage-accent', accent);
    return overlay.root;
  };

  /** Open a form over the page, if nothing modal is already open. */
  const present = async (id: string, placement: TriggeredPlacement | 'button', manual: boolean) => {
    if (stopped || onScreen.has(id)) return;
    if (isModal(placement) && open) return;
    const mine = generation;
    let response: RenderResponse;
    try {
      response = await render(id, placement, manual);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) warn(error);
      return;
    }
    if (!response?.shown || stopped || mine !== generation) return;
    if (isModal(placement) && open) return;
    const dismiss = () => {
      onScreen.delete(id);
      if (open === mounted) open = null;
      if (placement !== 'button' && !manual) {
        void api
          .request(`/forms/${encodeURIComponent(id)}/dismiss`, {
            method: 'POST',
            json: { url: location.pathname },
          })
          .catch(() => {});
      }
    };
    let mounted: Mounted | null = null;
    mounted = draw(
      response,
      placement,
      (form) => mountOverlay(layer(), form, placement, dismiss),
      dismiss,
    );
    if (!mounted) return;
    onScreen.set(id, mounted);
    if (isModal(placement)) open = mounted;
  };

  /* ------------------------------------------------------------- embeds */

  const drawEmbed = (target: HTMLElement) => {
    const id = target.getAttribute('data-helpwell-form')?.trim() ?? '';
    if (!id || embeds.get(target) === id) return;
    embeds.set(target, id);
    const root = embedRoot(target);
    if (!root) return;
    void render(id, 'inline')
      .then((response) => {
        if (stopped || embeds.get(target) !== id) return;
        if (response?.reason === 'two_step') {
          const form = normalizeForm(response.form);
          if (form) drawLaunch(root, form);
          return;
        }
        if (!response?.shown) return;
        draw(response, 'inline', () => mountInline(root, 'inline'));
      })
      .catch((error) => {
        if (!(error instanceof ApiError && error.status === 404)) warn(error);
      });
  };

  /** A two-step embed: a button that opens the form. */
  const drawLaunch = (root: ShadowRoot, form: WidgetForm) => {
    const mounted = mountInline(root, 'inline');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hwf-launch';
    button.textContent = form.placements.twoStep.label || form.style.buttonLabel;
    button.style.setProperty('--hwf-accent', form.style.accent || accent);
    button.style.setProperty('--hwf-btn-text', form.style.buttonText);
    button.addEventListener('click', () => void present(form.id, 'button', true));
    mounted.slot.appendChild(button);
  };

  const scan = () => {
    if (stopped) return;
    for (const el of document.querySelectorAll<HTMLElement>(EMBED)) drawEmbed(el);
  };

  // Two-step openers anywhere on the page, including inside shadow roots.
  const onClick = (event: MouseEvent) => {
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue;
      const id = node.getAttribute?.('data-helpwell-form-open');
      if (!id || !node.matches(OPENER)) continue;
      event.preventDefault();
      void present(id.trim(), 'button', true);
      return;
    }
  };
  document.addEventListener('click', onClick, { capture: true });

  // Embeds a single-page app adds after the first look.
  let pending: ReturnType<typeof setTimeout> | undefined;
  const observer =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          clearTimeout(pending);
          pending = setTimeout(scan, 100);
        })
      : null;
  observer?.observe(document.body, { childList: true, subtree: true });

  /* ---------------------------------------------------------- triggered */

  const load = () => {
    if (!options.config?.forms?.triggered) return;
    const mine = generation;
    const params = visitParams();
    params.set('visitor', browserId());
    void api
      .request<{ items?: { form?: unknown; placement?: string }[] }>(`/forms/display?${params}`)
      .then((result) => {
        if (stopped || mine !== generation) return;
        for (const item of result?.items ?? []) {
          const form = normalizeForm(item.form);
          const placement = item.placement as TriggeredPlacement | undefined;
          if (!form || !placement || !['popup', 'slidein', 'bar', 'welcome'].includes(placement))
            continue;
          // Filled in on this browser already: not asked again, whoever it was.
          if (read('local', `${DONE}${form.id}`)) continue;
          disarms.push(
            armTrigger(form.trigger, () => void present(form.id, placement, false), { events }),
          );
        }
      })
      .catch(() => {
        // Forms are additive; the page works without them.
      });
  };

  const clearTriggered = () => {
    generation++;
    for (const disarm of disarms.splice(0)) disarm();
    for (const mounted of onScreen.values()) mounted.close();
    onScreen.clear();
    open = null;
  };

  scan();
  load();

  return {
    scan,
    refresh() {
      if (stopped) return;
      clearTriggered();
      rememberReferral();
      scan();
      load();
    },
    show(id) {
      if (!id || stopped) return;
      void present(String(id).trim(), 'popup', true);
    },
    on(event, listener) {
      if (event === 'submit' && typeof listener === 'function') listeners.add(listener);
      return () => listeners.delete(listener);
    },
    off(_event, listener) {
      listeners.delete(listener);
    },
    event(name) {
      if (!stopped && name) events.emit(name);
    },
    homeBlock(formId, signal) {
      const holder = document.createElement('div');
      holder.className = 'section';
      // Its own shadow root, so the form's styles never mix with the panel's.
      const root = holder.attachShadow({ mode: 'open' });
      applyFormStyles(root);
      void render(formId, 'home')
        .then((response) => {
          if (signal.aborted || !response?.shown) return;
          draw(response, 'home', () => mountInline(root, 'home'));
        })
        .catch(() => {
          // Home still works without it.
        });
      return holder;
    },
    destroy() {
      stopped = true;
      clearTriggered();
      observer?.disconnect();
      clearTimeout(pending);
      document.removeEventListener('click', onClick, { capture: true });
      overlay?.host.remove();
      overlay = null;
      listeners.clear();
    },
  };
}

/* ---------------------------------------------------------------- helpers */

/** Where the page is, for the submission and for hidden fields. */
function page(): SubmitBody['page'] {
  const params = visitParams();
  const utm: Record<string, string> = {};
  for (const key of ['source', 'medium', 'campaign', 'term', 'content']) {
    const value = params.get(`utm_${key}`);
    if (value) utm[key] = value;
  }
  return {
    url: location.href.slice(0, 2000),
    path: location.pathname,
    referrer: params.get('referrer') ?? '',
    utm,
  };
}

function deviceAndLanguage(): { device?: string; lang?: string } {
  const params = visitParams();
  return { device: params.get('device') ?? undefined, lang: params.get('lang') ?? undefined };
}

/** A giveaway referral code the visit arrived with, kept for the rest of the tab's session. */
function rememberReferral(): void {
  try {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref && /^[a-z0-9]{4,20}$/.test(ref)) write('session', REF, ref);
  } catch {
    // No referral, then.
  }
}

const memory = new Map<string, string>();

function read(store: 'session' | 'local', key: string): string | null {
  try {
    return (store === 'session' ? sessionStorage : localStorage).getItem(key);
  } catch {
    return memory.get(`${store}:${key}`) ?? null;
  }
}

function write(store: 'session' | 'local', key: string, value: string): void {
  try {
    (store === 'session' ? sessionStorage : localStorage).setItem(key, value);
  } catch {
    memory.set(`${store}:${key}`, value);
  }
}
