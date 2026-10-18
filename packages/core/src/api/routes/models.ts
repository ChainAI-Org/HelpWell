/**
 * `GET /admin/models`: OpenRouter's live model list, for the dashboard's
 * model picker.
 *
 * Model ids go stale faster than any default HelpWell could ship, so the
 * picker lists what OpenRouter serves today rather than a list baked in at
 * release. It is read with the install's own key (the one that pays for the
 * answers), trimmed to what a person choosing needs (name, age, price and
 * context length) and sorted newest first, since the newest model is usually
 * the one somebody is looking for.
 *
 * Cached for ten minutes per handler and per kind, so opening Settings does
 * not call OpenRouter each time, and a slow or failing OpenRouter costs one
 * request, not one per page view. Without a key, or when OpenRouter cannot be
 * reached, the answer says so and the dashboard falls back to a text box.
 */

import { createHash } from 'node:crypto';
import type { RequestContext } from '../context.js';
import { envOf, requireAdmin } from '../context.js';
import { json, oneOf, type Router } from '../router.js';

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** Ten minutes: fresh enough to show a model released today, cheap enough to ignore. */
export const MODEL_LIST_TTL_MS = 10 * 60 * 1000;

const KINDS = ['chat', 'embeddings'] as const;
export type ModelListKind = (typeof KINDS)[number];

export interface ModelOption {
  id: string;
  name: string;
  /** When OpenRouter added it, ISO 8601; null when it does not say. */
  created: string | null;
  contextLength: number | null;
  /** US dollars per million tokens, or null when OpenRouter lists no price. */
  pricing: { prompt: number | null; completion: number | null };
  /** Whether it takes tool calls. The agent uses tools, so a chat model without them answers less well. */
  tools: boolean;
}

export interface ModelList {
  /** False when there is no list to show: no key, or OpenRouter did not answer. */
  available: boolean;
  /** Why not, when not. */
  reason?: 'no_key' | 'unreachable';
  kind: ModelListKind;
  models: ModelOption[];
  fetchedAt: string | null;
}

interface CacheEntry {
  at: number;
  list: ModelList;
}

export function modelRoutes(router: Router<RequestContext>): Router<RequestContext> {
  // Per handler, so two installs in one process never share an answer.
  const cache = new Map<string, CacheEntry>();

  router.get('/admin/models', async ({ query, context }) => {
    requireAdmin(context);
    const kind = oneOf(query.get('kind') ?? 'chat', KINDS, 'kind');
    const key = (
      context.config.openRouterKey ??
      envOf(context.config).OPENROUTER_API_KEY ??
      ''
    ).trim();
    if (!key) {
      return json({ available: false, reason: 'no_key', kind, models: [], fetchedAt: null });
    }

    // The key's hash, not the key, names the cache entry: a rotated key
    // starts fresh, and the key itself is never kept anywhere new.
    const slot = `${kind}:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    const now = (context.config.now?.() ?? new Date()).getTime();
    const hit = cache.get(slot);
    if (hit && now - hit.at < MODEL_LIST_TTL_MS) return json(hit.list, { headers: privateCache });

    const list = await fetchModelList(kind, key, context.config.modelsFetch ?? fetch, now);
    // A failure is cached too, for a minute, so a down OpenRouter is not
    // asked again on every keystroke in the picker.
    cache.set(slot, { at: list.available ? now : now - MODEL_LIST_TTL_MS + 60_000, list });
    return json(list, { headers: privateCache });
  });

  return router;
}

const privateCache = { 'cache-control': 'private, max-age=600' };

/** Read and trim OpenRouter's list. Never throws: a failure is `available: false`. */
export async function fetchModelList(
  kind: ModelListKind,
  key: string,
  fetcher: typeof fetch,
  now = Date.now(),
): Promise<ModelList> {
  const url =
    kind === 'embeddings'
      ? `${OPENROUTER_MODELS_URL}?output_modalities=embeddings`
      : OPENROUTER_MODELS_URL;
  const failed: ModelList = {
    available: false,
    reason: 'unreachable',
    kind,
    models: [],
    fetchedAt: null,
  };
  try {
    const response = await fetcher(url, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return failed;
    const body = (await response.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) return failed;
    const models = body.data
      // Asked for embeddings, OpenRouter answers with them; the check is for
      // a list that ignored the filter. A chat model writes text: one that
      // does not say what it writes is given the benefit of the doubt.
      .filter((raw) =>
        kind === 'embeddings'
          ? outputs(raw).includes('embeddings')
          : outputs(raw).length === 0 || outputs(raw).includes('text'),
      )
      .map((raw) => toOption(raw))
      .filter((model): model is ModelOption => model !== null)
      .sort(
        (a, b) =>
          (b.created ? Date.parse(b.created) : 0) - (a.created ? Date.parse(a.created) : 0) ||
          a.id.localeCompare(b.id),
      );
    return { available: true, kind, models, fetchedAt: new Date(now).toISOString() };
  } catch {
    return failed;
  }
}

function outputs(raw: unknown): string[] {
  const architecture = (raw as { architecture?: { output_modalities?: unknown } }).architecture;
  const list = architecture?.output_modalities;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
}

/** One model as the picker needs it, or null for an entry that is not one. */
function toOption(raw: unknown): ModelOption | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  // An id is what gets saved into settings and sent to OpenRouter, so it has
  // to look like one: `vendor/model`, with a `:variant` or `~alias` at most.
  if (!/^~?[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(id) || id.length > 200) return null;
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
  const created =
    typeof entry.created === 'number' && Number.isFinite(entry.created) && entry.created > 0
      ? new Date(entry.created * 1000).toISOString()
      : null;
  const context =
    typeof entry.context_length === 'number' && entry.context_length > 0
      ? Math.round(entry.context_length)
      : null;
  const pricing = (entry.pricing ?? {}) as Record<string, unknown>;
  const parameters = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : [];
  return {
    id,
    name: name.slice(0, 120),
    created,
    contextLength: context,
    pricing: { prompt: perMillion(pricing.prompt), completion: perMillion(pricing.completion) },
    tools: parameters.includes('tools'),
  };
}

/** OpenRouter prices are dollars per token, as strings. The picker shows per million. */
function perMillion(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 10_000) / 10_000;
}
