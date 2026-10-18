/**
 * Webhooks: where HelpWell sends its events, how the last deliveries went,
 * a test delivery, retrying what failed, and the instructions for building a
 * receiver.
 *
 * Retries normally happen by themselves (the next webhook HelpWell sends picks
 * up whatever is due), so the retry button is for the moment after someone
 * fixes their endpoint and does not want to wait for the backoff.
 *
 * Where webhooks are added depends on where the install is configured. In a
 * repo they live in `helpwell.config.json`, pushed with `helpwell sync`, and a
 * webhook added here would be overwritten by the next push, so this page
 * lists them and says so. An install whose content is managed for it has no
 * config file, so here is where they are added, paused and removed. Each gets
 * a signing secret HelpWell makes, shown once when it is made, for the
 * receiver to check signatures with; the page never shows it again, and a new
 * one can be made at any time. The URL is checked by the same guard every
 * delivery goes through (https, a public address), unless the install turned
 * the guard off for local development.
 *
 * Every send, a test included, goes through the install's `webhookFetch`, or
 * the built-in guard.
 */

import { randomBytes } from 'node:crypto';
import {
  checkWebhookUrl,
  retryWebhooks,
  sendTestWebhook,
  WEBHOOK_EVENT_DESCRIPTIONS,
  WEBHOOK_EVENTS,
  type WebhookFetchConfig,
  type WebhookOptions,
  webhookGuardOff,
  webhookReceiverPromptSpec,
} from '@helpwell/core';
import { type Db, rowsOf } from '@helpwell/core/db';
import type { Settings, SettingsStore } from '@helpwell/core/settings';
import { html, join, type RawHtml, raw } from '@helpwell/ui';
import { sql } from 'drizzle-orm';
import { button, card, field, notice, pill, relativeTime, textInput } from '../components.js';
import { configOnlyCard } from '../config-only.js';
import { managedContent } from '../content-mode.js';
import { type DashboardContext, renderDashboard } from '../layout.js';
import { setupPromptPanel } from '../setup-prompt.js';

/** One attempt from `helpwell.webhook_deliveries`. */
export interface WebhookDeliveryRow {
  id: string;
  event: string;
  url: string;
  status: string;
  attempts: number;
  responseCode: number | null;
  error: string | null;
  createdAt: Date | string;
}

/** The most webhooks one install may have. Far beyond any real need. */
const MAX_WEBHOOKS = 20;

/** GET `/webhooks`. */
export async function webhooksScreen(
  db: Db,
  settings: Settings,
  context: DashboardContext,
  url: URL,
  guard: WebhookFetchConfig,
): Promise<Response> {
  return page(context, await webhooksBody(db, settings, context, guard, { flash: flash(url) }));
}

/** The events list, the test and retry buttons, and the receiver prompt. */
export function webhookTools(context: DashboardContext, settings: Settings): RawHtml {
  const active = settings.webhooks.some((hook) => hook.active && hook.url);
  return html`
<details style="margin-top:12px">
  <summary style="cursor:pointer;font-weight:600">What each event means</summary>
  <dl class="db-kv" style="margin-top:10px">${join(
    WEBHOOK_EVENTS.map(
      (event) =>
        html`<dt><code>${event}</code></dt><dd style="font-weight:500">${WEBHOOK_EVENT_DESCRIPTIONS[event]}</dd>`,
    ),
  )}</dl>
</details>
${
  active
    ? html`<div class="db-toolbar" style="margin:12px 0 0">
  <form method="post" action="${context.basePath}/webhooks">
    <input type="hidden" name="action" value="webhook-test">
    ${button('Send test delivery', { glyph: 'zap' })}
  </form>
  <form method="post" action="${context.basePath}/webhooks">
    <input type="hidden" name="action" value="webhook-retry">
    ${button('Retry failed deliveries now', { glyph: 'refresh' })}
  </form>
</div>
<p class="db-field__hint" style="margin-top:8px">A failed delivery is retried up to five times, after 1, 4, 16 and 64 minutes, whenever HelpWell next sends a webhook.${
        managedContent(context)
          ? null
          : html` <code>helpwell webhooks retry</code> on a cron does the same.`
      }</p>`
    : null
}
${setupPromptPanel(
  'webhook-receiver',
  webhookReceiverPromptSpec({
    productName: settings.product.name,
    managed: managedContent(context),
  }),
)}`;
}

interface BodyView {
  flash?: RawHtml | null;
  /** A secret just made, shown this once: which webhook, and the secret. */
  secret?: { url: string; secret: string } | null;
  errors?: Record<string, string>;
  draft?: { url: string; events: string[] };
}

async function webhooksBody(
  db: Db,
  settings: Settings,
  context: DashboardContext,
  guard: WebhookFetchConfig,
  view: BodyView = {},
): Promise<RawHtml> {
  const managed = managedContent(context);
  const deliveries = await recentDeliveries(db);
  return html`
${view.flash ?? null}
${view.secret ? secretNotice(view.secret) : null}
${card(
  'Webhooks',
  'Send HelpWell events to your own systems. Each delivery is signed, so the receiver can check it came from here.',
  hooksTable(context, settings, managed),
  html`<p class="db-field__hint" style="margin-top:12px">
    Events a webhook can subscribe to: ${join(
      WEBHOOK_EVENTS.map((event) => html`<code>${event}</code>`),
      ', ',
    )}. Leave the list empty to receive all of them.
  </p>`,
  webhookTools(context, settings),
)}
${managed ? addCard(context, settings, guard, view) : null}
${card('Recent deliveries', 'The last twenty attempts, newest first.', deliveriesTable(context, deliveries))}
${configOnlyCard('webhooks', context)}`;
}

function hooksTable(context: DashboardContext, settings: Settings, managed: boolean): RawHtml {
  if (settings.webhooks.length === 0) {
    return managed
      ? html`<p class="db-muted">None yet. Add one below.</p>`
      : html`<p class="db-muted">None configured. Add them in <code>helpwell.config.json</code>.</p>`;
  }
  const base = `${context.basePath}/webhooks`;
  const row = (hook: Settings['webhooks'][number], index: number) => {
    const identify = html`<input type="hidden" name="index" value="${String(index)}"><input type="hidden" name="url" value="${hook.url}">`;
    return html`<tr>
    <td class="db-truncate">${hostOf(hook.url)}</td>
    <td class="db-muted">${hook.events.join(', ') || 'all'}</td>
    <td>${hook.secret ? pill('good', 'Set: yes') : pill('warn', 'Set: no')}</td>
    <td>${hook.active ? pill('good', 'Active') : pill('neutral', 'Paused')}</td>
    ${
      managed
        ? html`<td class="db-right"><div class="db-rowactions">
      <form method="post" action="${base}">
        <input type="hidden" name="action" value="webhook-toggle">${identify}
        ${button(hook.active ? 'Pause' : 'Resume', {})}
      </form>
      <form method="post" action="${base}" data-confirm="Make a new signing secret for ${hostOf(hook.url)}? The receiver must be given it before it can check deliveries again.">
        <input type="hidden" name="action" value="webhook-secret">${identify}
        ${button('New secret', { glyph: 'refresh' })}
      </form>
      <form method="post" action="${base}" data-confirm="Remove the webhook to ${hostOf(hook.url)}? Nothing more is sent to it.">
        <input type="hidden" name="action" value="webhook-remove">${identify}
        ${button('Remove', { glyph: 'trash' })}
      </form>
    </div></td>`
        : null
    }
  </tr>`;
  };
  return html`<div class="db-tablewrap" style="border:0">
    <table class="db-table">
      <thead><tr><th>URL</th><th>Events</th><th>Secret</th><th>Status</th>${managed ? html`<th></th>` : null}</tr></thead>
      <tbody>${join(settings.webhooks.map(row))}</tbody>
    </table>
  </div>`;
}

function addCard(
  context: DashboardContext,
  settings: Settings,
  guard: WebhookFetchConfig,
  view: BodyView,
): RawHtml {
  if (settings.webhooks.length >= MAX_WEBHOOKS) {
    return card(
      'Add a webhook',
      null,
      html`<p class="db-muted">There are ${String(MAX_WEBHOOKS)} webhooks already, which is as many as there can be.</p>`,
    );
  }
  const chosen = new Set(view.draft?.events ?? []);
  return card(
    'Add a webhook',
    guardOn(guard)
      ? 'An https:// address on the public internet. HelpWell makes its signing secret and shows it once.'
      : 'An http:// or https:// address. HelpWell makes its signing secret and shows it once.',
    html`<form method="post" action="${context.basePath}/webhooks">
      <input type="hidden" name="action" value="webhook-add">
      ${field(
        'URL',
        textInput('url', view.draft?.url ?? '', {
          placeholder: 'https://example.com/hooks/helpwell',
        }),
        null,
        view.errors?.url,
      )}
      <fieldset class="db-field" style="border:0;padding:0;margin:0 0 12px">
        <legend class="db-field__label">Events</legend>
        <span class="db-field__hint">Tick none to receive every event.</span>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 16px;margin-top:6px">${join(
          WEBHOOK_EVENTS.map(
            (event) =>
              html`<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" name="events" value="${event}"${
                chosen.has(event) ? raw(' checked') : null
              }> <code>${event}</code></label>`,
          ),
        )}</div>
        ${view.errors?.events ? html`<span class="db-error" role="alert">${view.errors.events}</span>` : null}
      </fieldset>
      ${button('Add webhook', { glyph: 'plus', tone: 'primary' })}
    </form>`,
  );
}

function secretNotice(made: { url: string; secret: string }): RawHtml {
  return notice(
    'good',
    html`<p style="margin:0 0 8px">The signing secret for <b>${hostOf(made.url)}</b>. Copy it now and give it to the receiver as
    <code>HELPWELL_WEBHOOK_SECRET</code>: it is not shown again.</p>
    <pre class="db-code" id="db-webhook-secret" style="margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere">${made.secret}</pre>
    <button type="button" class="db-btn" data-copy="db-webhook-secret">${raw('<span>Copy the secret</span>')}</button>`,
  );
}

export function deliveriesTable(
  context: DashboardContext,
  deliveries: WebhookDeliveryRow[],
): RawHtml {
  if (deliveries.length === 0) {
    return html`<p class="db-muted">
      No deliveries yet. Add a webhook above and the next unresolved conversation, new gap,
      roadmap idea or survey answer will land here.
    </p>`;
  }
  return html`<div class="db-tablewrap" style="border:0">
    <table class="db-table">
      <thead><tr><th>Event</th><th>To</th><th>Status</th><th>Code</th><th>Error</th><th>When</th></tr></thead>
      <tbody>${join(
        deliveries.map(
          (row) => html`<tr>
          <td><code>${row.event}</code></td>
          <td class="db-muted">${hostOf(row.url)}</td>
          <td>${deliveryPill(row.status)}</td>
          <td class="db-nums">${row.responseCode === null ? '—' : String(row.responseCode)}</td>
          <td class="db-muted db-truncate" title="${row.error ?? ''}">${truncate(row.error, 80)}</td>
          <td class="db-muted">${relativeTime(row.createdAt, context)}</td>
        </tr>`,
        ),
      )}</tbody>
    </table>
  </div>`;
}

function deliveryPill(status: string): RawHtml {
  if (status === 'delivered') return pill('good', 'Delivered');
  if (status === 'failed') return pill('bad', 'Failed');
  return pill('neutral', 'Pending');
}

/** The host only: the path can carry a token, and the table is not the place for it. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return truncate(url, 40);
  }
}

function truncate(value: string | null, max: number): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** The last twenty webhook attempts, newest first. */
export async function recentDeliveries(db: Db): Promise<WebhookDeliveryRow[]> {
  const result = await db.execute(sql`
    SELECT id, event, url, status, attempts, response_code, error, created_at
    FROM helpwell.webhook_deliveries
    ORDER BY created_at DESC
    LIMIT 20
  `);
  return rowsOf<{
    id: string;
    event: string;
    url: string;
    status: string;
    attempts: number | string;
    response_code: number | string | null;
    error: string | null;
    created_at: string | Date;
  }>(result).map((row) => ({
    id: row.id,
    event: row.event,
    url: row.url,
    status: row.status,
    attempts: Number(row.attempts),
    responseCode: row.response_code === null ? null : Number(row.response_code),
    error: row.error,
    createdAt: row.created_at,
  }));
}

/* ----------------------------------------------------------------- posts */

/**
 * The test and retry buttons, from this page or from Connections, where they
 * used to be. Answers with where to go next: this page, whose Recent
 * deliveries table shows how each attempt went, with what happened.
 */
export async function webhooksPost(
  db: Db,
  settings: Settings,
  context: DashboardContext,
  action: string,
  /** How the sends go out: the install's `webhookFetch`, or the built-in guard. */
  webhooks: WebhookOptions = {},
): Promise<string> {
  const back = (message: string) =>
    `${context.basePath}/webhooks?webhooks=${encodeURIComponent(message)}`;
  if (action === 'webhook-test') {
    const results = await sendTestWebhook(db, settings, webhooks);
    if (results.length === 0) return back('Nothing sent: there is no active webhook.');
    const delivered = results.filter((r) => r.status === 'delivered').length;
    return back(
      `Test sent to ${results.length} webhook${results.length === 1 ? '' : 's'}: ${delivered} delivered, ${results.length - delivered} failed. See Recent deliveries.`,
    );
  }
  if (action === 'webhook-retry') {
    const result = await retryWebhooks(db, settings, { ...webhooks, force: true, limit: 50 });
    if (result.attempted === 0 && result.gaveUp === 0) return back('Nothing to retry.');
    return back(
      `Retried ${result.attempted}: ${result.delivered} delivered, ${result.failed} will try again, ${result.gaveUp} given up.`,
    );
  }
  return `${context.basePath}/webhooks`;
}

/**
 * POST `/webhooks`: the test and retry buttons anywhere, and for managed
 * content, adding, pausing, removing and re-keying a webhook.
 */
export async function webhooksPagePost(
  db: Db,
  store: SettingsStore,
  context: DashboardContext,
  form: FormData,
  guard: WebhookFetchConfig,
  webhooks: WebhookOptions,
): Promise<Response> {
  const value = (name: string) => {
    const entry = form.get(name);
    return typeof entry === 'string' ? entry.trim() : '';
  };
  const action = value('action');
  const settings = await store.get();
  if (action === 'webhook-test' || action === 'webhook-retry') {
    return redirect(await webhooksPost(db, settings, context, action, webhooks));
  }
  // In a repo the config file owns the list; the next push would undo an edit here.
  if (!managedContent(context)) return redirect(`${context.basePath}/webhooks`);

  const done = (what: string) => redirect(`${context.basePath}/webhooks?done=${what}`);
  const list = [...settings.webhooks];

  if (action === 'webhook-add') {
    const url = value('url');
    const events = form
      .getAll('events')
      .filter((event): event is string => typeof event === 'string')
      .filter((event) => (WEBHOOK_EVENTS as readonly string[]).includes(event));
    const errors: Record<string, string> = {};
    const problem = urlProblem(url, guard);
    if (problem) errors.url = problem;
    else if (list.some((hook) => hook.url === url)) {
      errors.url = 'There is a webhook for that address already.';
    }
    if (list.length >= MAX_WEBHOOKS) errors.url = `There can be at most ${MAX_WEBHOOKS} webhooks.`;
    if (Object.keys(errors).length > 0) {
      return page(
        context,
        await webhooksBody(db, settings, context, guard, { errors, draft: { url, events } }),
        400,
      );
    }
    const secret = newSecret();
    const saved = await store.update({
      webhooks: [...list, { url, events, secret, active: true }],
    });
    // Drawn here, not redirected: the secret is never put in a URL, and this is its one showing.
    return page(
      context,
      await webhooksBody(db, saved, context, guard, { secret: { url, secret } }),
    );
  }

  // The rest act on one webhook, named by where it is and what it points at,
  // so a list that changed in the meantime is not edited in the wrong place.
  const index = Number(value('index'));
  const hook = Number.isSafeInteger(index) ? list[index] : undefined;
  if (!hook || hook.url !== value('url')) return done('stale');

  if (action === 'webhook-toggle') {
    list[index] = { ...hook, active: !hook.active };
    await store.update({ webhooks: list });
    return done(hook.active ? 'paused' : 'resumed');
  }
  if (action === 'webhook-remove') {
    list.splice(index, 1);
    await store.update({ webhooks: list });
    return done('removed');
  }
  if (action === 'webhook-secret') {
    const secret = newSecret();
    list[index] = { ...hook, secret };
    const saved = await store.update({ webhooks: list });
    return page(
      context,
      await webhooksBody(db, saved, context, guard, { secret: { url: hook.url, secret } }),
    );
  }
  return redirect(`${context.basePath}/webhooks`);
}

/* -------------------------------------------------------------- plumbing */

/** Whether sends go through the built-in guard (or the host's own, which has its own rules). */
function guardOn(guard: WebhookFetchConfig): boolean {
  if (guard.webhookFetch === false) return false;
  if (typeof guard.webhookFetch === 'function') return true;
  return !webhookGuardOff(guard.env ?? process.env);
}

/** Why a URL cannot be a webhook, or null. */
function urlProblem(url: string, guard: WebhookFetchConfig): string | null {
  if (!url) return 'Give the address to send events to.';
  if (url.length > 2048) return 'That address is too long.';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'That is not a web address. It starts with https://.';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'A webhook address starts with https://.';
  }
  if (!guardOn(guard)) return null;
  const refused = checkWebhookUrl(parsed);
  // The guard's own words name the setting that turns it off, which is for
  // whoever runs the install, not for this form.
  return refused
    ? parsed.protocol !== 'https:'
      ? 'Webhooks are only sent over https. Use an https:// address.'
      : `${parsed.hostname} is not a public address, and webhooks are only sent to public ones.`
    : null;
}

/** A signing secret: 32 random bytes, as text a receiver can keep in an environment variable. */
function newSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

/** What the last action did, from this page's own words only: nothing typed into a URL is shown. */
function flash(url: URL): RawHtml | null {
  const done = url.searchParams.get('done');
  const said: Record<string, [tone: 'good' | 'info', text: string]> = {
    paused: ['info', 'Paused. Nothing is sent to it until it is resumed.'],
    resumed: ['good', 'Resumed. The next event is sent to it.'],
    removed: ['good', 'Removed. Nothing more is sent to it.'],
    stale: ['info', 'The list had changed, so nothing was done. Try again.'],
  };
  const known = done && Object.hasOwn(said, done) ? said[done] : undefined;
  if (known) return notice(known[0], known[1]);
  const message = url.searchParams.get('webhooks');
  // Only the messages the test and retry buttons write are shown.
  if (
    message &&
    /^(Nothing sent: there is no active webhook\.|Nothing to retry\.|Test sent to \d+ webhooks?: \d+ delivered, \d+ failed\. See Recent deliveries\.|Retried \d+: \d+ delivered, \d+ will try again, \d+ given up\.)$/.test(
      message,
    )
  ) {
    return notice('info', message);
  }
  return null;
}

function page(context: DashboardContext, body: RawHtml, status = 200): Response {
  const header = {
    title: 'Webhooks',
    subtitle: 'HelpWell’s events, sent to your own systems as they happen.',
  };
  return new Response(renderDashboard(context, 'webhooks', header, body), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}
