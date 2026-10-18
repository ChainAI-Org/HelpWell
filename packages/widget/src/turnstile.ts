/**
 * The bot check: Cloudflare Turnstile, loaded only when it is switched on.
 *
 * The script is a third-party request on somebody else's page, so it is never
 * fetched unless `/config` carried a site key, and then only when a token is
 * first needed: before the first message of a conversation, or before the
 * email card is sent on one that has not passed yet. It runs as a managed
 * challenge with `interaction-only` appearance, so most visitors never see
 * it; when Cloudflare does want a click, the challenge shows just above the
 * composer.
 *
 * A token is single-use. Each `token()` call after the first resets the
 * challenge and waits for a new one.
 */

export interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

export const TURNSTILE_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** How long a visitor has to finish an interactive challenge before we give up. */
const TOKEN_TIMEOUT_MS = 90_000;

let loading: Promise<TurnstileApi> | null = null;

/** Add Cloudflare's script to the page, once, and resolve with its API. */
export function loadTurnstile(): Promise<TurnstileApi> {
  const existing = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;

  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api) resolve(api);
      else reject(new Error('Turnstile loaded without its API.'));
    };
    script.onerror = () => reject(new Error('Turnstile could not be loaded.'));
    document.head.appendChild(script);
  }).catch((error) => {
    // A failed load (a CSP block, a network blip) is retried next time.
    loading = null;
    throw error;
  });
  return loading;
}

export interface HumanCheck {
  /** A fresh token. Rejects when the challenge fails or cannot load. */
  token(): Promise<string>;
  destroy(): void;
}

export function humanCheck(
  siteKey: string,
  container: HTMLElement,
  load: () => Promise<TurnstileApi> = loadTurnstile,
): HumanCheck {
  let api: TurnstileApi | null = null;
  let widgetId: string | undefined;
  let pending: { resolve: (token: string) => void; reject: (error: Error) => void } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  const settle = (outcome: { token: string } | { error: Error }) => {
    clearTimeout(timer);
    const waiting = pending;
    pending = null;
    container.dataset.challenge = 'idle';
    if (!waiting) return;
    if ('token' in outcome) waiting.resolve(outcome.token);
    else waiting.reject(outcome.error);
  };

  return {
    async token() {
      if (destroyed) throw new Error('The check has gone.');
      api ??= await load();
      // Only one challenge at a time; a second caller waits for its own.
      if (pending) settle({ error: new Error('Superseded by a newer check.') });

      return new Promise<string>((resolve, reject) => {
        pending = { resolve, reject };
        container.dataset.challenge = 'running';
        timer = setTimeout(
          () => settle({ error: new Error('The check timed out.') }),
          TOKEN_TIMEOUT_MS,
        );
        if (widgetId === undefined) {
          widgetId = api!.render(container, {
            sitekey: siteKey,
            appearance: 'interaction-only',
            callback: (token: string) => settle({ token }),
            'error-callback': () => settle({ error: new Error('The check failed.') }),
            'timeout-callback': () => settle({ error: new Error('The check timed out.') }),
          });
        } else {
          api!.reset(widgetId);
        }
      });
    },
    destroy() {
      destroyed = true;
      settle({ error: new Error('The check has gone.') });
      if (api && widgetId !== undefined) {
        try {
          api.remove(widgetId);
        } catch {
          // Already gone with its container.
        }
      }
    },
  };
}
