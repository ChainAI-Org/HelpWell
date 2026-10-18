/**
 * The dashboard's live preview of a form: the real renderer, fed a draft.
 *
 * The form builder loads a page into an iframe with this script on it, and
 * posts the draft every time it changes:
 *
 *   frame.contentWindow.postMessage(
 *     { type: 'helpwell:forms:preview', definition, accent, placement, state },
 *     location.origin,
 *   );
 *
 * The builder shares its page script with the engage editor, so the engage
 * editor's messages are understood too (`helpwell:engage:preview`, with the
 * placement and state under `definition.preview`), and both ready messages
 * are sent. Only messages from the parent window, on the same origin, are read. The
 * draft is drawn in the placement asked for (an embed in the page, or over
 * it), whatever its trigger, with a host that sends nothing and follows no
 * link. Submitting it shows the thank-you the visitor would see, built from
 * the draft, so the whole journey can be checked without a single request.
 */

import { safeAccent } from '../sanitize.js';
import { normalizeBlocks, normalizeForm } from './normalize.js';
import { drawForm, type FormHost } from './render.js';
import { setFormsDevice } from './styles.js';
import { embedRoot, mountInline, mountOverlay, overlayLayer } from './surfaces.js';
import type { EntryState, FormPlacement, SubmitResult, WidgetForm } from './types.js';

export const FORMS_PREVIEW_MESSAGE = 'helpwell:forms:preview';
export const FORMS_READY_MESSAGE = 'helpwell:forms:ready';
/** The engage editor's protocol, which the form builder's page script speaks. */
const ENGAGE_PREVIEW_MESSAGE = 'helpwell:engage:preview';
const ENGAGE_READY_MESSAGE = 'helpwell:engage:ready';

export interface FormsPreviewOptions {
  /** The element an embed or a Home block is drawn into. */
  target(placement: FormPlacement): HTMLElement | null;
}

export interface FormsPreview {
  render(
    definition: unknown,
    options?: { accent?: string; placement?: FormPlacement; state?: 'form' | 'done' },
  ): void;
  destroy(): void;
}

type Loose = Record<string, unknown>;

export function mountFormsPreview(options: FormsPreviewOptions): FormsPreview {
  let overlay: ReturnType<typeof overlayLayer> | null = null;
  let current: { close(): void } | null = null;

  const clear = () => {
    current?.close();
    current = null;
    overlay?.root
      .querySelectorAll('.hwf-scrim, .hwf-slidein, .hwf-bar, .hwf-welcome')
      .forEach((el) => {
        el.remove();
      });
  };

  return {
    render(definition, renderOptions = {}) {
      clear();
      const form = normalizeForm(definition);
      if (!form) return;
      const accent = safeAccent(renderOptions.accent);
      const placement =
        renderOptions.placement ??
        (form.placements.display !== 'none' ? form.placements.display : 'inline');
      const host = previewHost(form, definition as Loose);
      if (placement === 'inline' || placement === 'home') {
        const target = options.target(placement);
        const root = target ? embedRoot(target) : null;
        if (!root) return;
        const mounted = mountInline(root, placement);
        const drawn = drawForm(form, host, { placement, accent });
        mounted.slot.appendChild(drawn.el);
        if (renderOptions.state === 'done') void host.submit(emptyBody()).then(drawn.showDone);
        current = mounted;
        return;
      }
      overlay ??= overlayLayer();
      const surface = placement === 'button' ? 'popup' : placement;
      const mounted = mountOverlay(overlay.root, form, surface, () => {
        current = null;
      });
      const drawn = drawForm(form, host, { placement, accent, onClose: () => mounted.dismiss() });
      mounted.slot.appendChild(drawn.el);
      if (renderOptions.state === 'done') void host.submit(emptyBody()).then(drawn.showDone);
      current = mounted;
    },
    destroy() {
      clear();
      overlay?.host.remove();
      overlay = null;
    },
  };
}

/** Listen for drafts from the builder and draw them. Returns a function that stops listening. */
export function listenForFormDrafts(preview: FormsPreview): () => void {
  // The builder's frame is narrower than a desktop page even at its Desktop
  // size, so which device to draw for is read from its width (its Mobile
  // size is a 375px phone), or taken from the message when it says.
  let said: 'phone' | 'desktop' | null = null;
  const device = () => setFormsDevice(said ?? (window.innerWidth < 440 ? 'phone' : 'desktop'));
  device();
  window.addEventListener('resize', device);
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const data = event.data as Loose | null;
    if (!data || (data.type !== FORMS_PREVIEW_MESSAGE && data.type !== ENGAGE_PREVIEW_MESSAGE))
      return;
    const definition = (
      data.definition && typeof data.definition === 'object' ? data.definition : {}
    ) as Loose;
    const asked = (
      definition.preview && typeof definition.preview === 'object' ? definition.preview : {}
    ) as Loose;
    const placement = data.placement ?? asked.placement;
    const state = data.state ?? asked.state;
    said = data.device === 'mobile' ? 'phone' : data.device === 'desktop' ? 'desktop' : null;
    device();
    preview.render(definition, {
      accent: typeof data.accent === 'string' ? data.accent : undefined,
      placement: typeof placement === 'string' ? (placement as FormPlacement) : undefined,
      state: state === 'done' ? 'done' : 'form',
    });
  };
  window.addEventListener('message', onMessage);
  if (window.parent !== window) {
    window.parent.postMessage({ type: FORMS_READY_MESSAGE }, location.origin);
    window.parent.postMessage({ type: ENGAGE_READY_MESSAGE }, location.origin);
  }
  return () => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', device);
    setFormsDevice(null);
  };
}

function emptyBody() {
  return {
    answers: {},
    honeypot: '',
    page: { url: location.href, path: '/', referrer: '', utm: {} },
  };
}

/**
 * A host that sends nothing: submitting shows the thank-you the draft
 * describes (the builder sends the whole success section, coupon code
 * included, because it is the owner looking).
 */
function previewHost(form: WidgetForm, raw: Loose): FormHost {
  const success = (raw.success && typeof raw.success === 'object' ? raw.success : {}) as Loose;
  const coupon = (
    success.coupon && typeof success.coupon === 'object' ? success.coupon : {}
  ) as Loose;
  const download = (
    success.download && typeof success.download === 'object' ? success.download : {}
  ) as Loose;
  const entry: EntryState | undefined = form.giveaway
    ? {
        entryId: 'preview',
        entryKey: 'preview',
        entries: 1,
        maxEntries: form.giveaway.maxEntries,
        referralCode: 'preview',
        referrals: 0,
        referralEntries: form.giveaway.referralEntries,
        actions: form.giveaway.actions.map((a) => ({ ...a, done: false })),
      }
    : undefined;
  const result: SubmitResult = {
    ok: true,
    submissionId: 'preview',
    status: 'accepted',
    success: {
      action: form.success.action,
      blocks: normalizeBlocks(success.blocks),
      ...(form.success.action === 'coupon'
        ? {
            coupon: {
              code: String(coupon.code || 'YOURCODE'),
              label: String(coupon.label || 'Your code'),
            },
          }
        : {}),
      ...(form.success.action === 'download'
        ? { download: { path: '#', label: String(download.label || 'Download'), expiresAt: '' } }
        : {}),
    },
    ...(entry ? { giveaway: entry } : {}),
  };
  return {
    preview: true,
    apiUrl: '',
    submit: () => Promise.resolve(result),
    claimAction: () => Promise.resolve(entry as EntryState),
    act: () => {},
    page: () => ({ url: 'https://example.com/', path: '/', referrer: '', utm: {} }),
  };
}
