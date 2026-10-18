/**
 * `helpwell webhooks` — the delivery log, retries and a test ping, from a
 * terminal or a cron job.
 *
 * HelpWell has no worker, so failed deliveries are retried whenever it next
 * sends a webhook. A quiet install may not send one for hours; running
 * `helpwell webhooks retry` every few minutes from cron keeps retries on
 * schedule anyway. It reads the webhook settings from the database, the same
 * ones the running app uses.
 */

import {
  type DeliveryOutcome,
  listDeliveries,
  type RetryResult,
  retryWebhooks,
  sendTestWebhook,
  type WebhookDelivery,
} from '@helpwell/core';
import { SettingsStore } from '@helpwell/core/settings';
import { loadProject, openDb } from '../project.js';
import { detail, heading, ok, say, table, warn } from '../ui.js';

interface WebhookCommandOptions {
  cwd: string;
  url?: string;
  fetch?: typeof fetch;
}

async function withDb<T>(
  options: WebhookCommandOptions,
  fn: (handle: Awaited<ReturnType<typeof openDb>>) => Promise<T>,
): Promise<T> {
  const project = loadProject(options.cwd);
  const handle = await openDb(project.paths, { url: options.url });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

/** The host only: a webhook path can carry a token. */
function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 40);
  }
}

export async function webhooksList(
  options: WebhookCommandOptions & { status?: 'pending' | 'delivered' | 'failed' | 'retrying' },
): Promise<WebhookDelivery[]> {
  return withDb(options, async (handle) => {
    const items = await listDeliveries(handle.db, { status: options.status, limit: 20 });
    heading('Recent webhook deliveries');
    if (items.length === 0) {
      detail('None yet.');
      say();
      return items;
    }
    table(
      items.map((d) => [
        `${d.event} → ${host(d.url)}`,
        `${d.status}${d.responseCode ? ` ${d.responseCode}` : ''}, ${d.attempts} attempt${d.attempts === 1 ? '' : 's'}${
          d.nextAttemptAt ? `, next try ${d.nextAttemptAt.toISOString()}` : ''
        }${d.error ? ` (${d.error.slice(0, 60)})` : ''}`,
      ]),
    );
    say();
    return items;
  });
}

export async function webhooksRetry(
  options: WebhookCommandOptions & { now?: boolean },
): Promise<RetryResult> {
  return withDb(options, async (handle) => {
    const settings = await new SettingsStore(handle.db).get();
    const result = await retryWebhooks(handle.db, settings, {
      force: options.now,
      limit: 200,
      fetch: options.fetch,
    });
    heading('Retrying webhook deliveries');
    if (result.attempted === 0 && result.gaveUp === 0) {
      ok(
        options.now
          ? 'Nothing to retry.'
          : 'Nothing is due. --now retries every failure with tries left.',
      );
    } else {
      table([
        ['Delivered', String(result.delivered)],
        ['Will try again', String(result.failed)],
        ['Given up', String(result.gaveUp)],
      ]);
    }
    say();
    return result;
  });
}

export async function webhooksTest(
  options: WebhookCommandOptions & { target?: string },
): Promise<DeliveryOutcome[]> {
  return withDb(options, async (handle) => {
    const settings = await new SettingsStore(handle.db).get();
    const results = await sendTestWebhook(handle.db, settings, {
      url: options.target,
      fetch: options.fetch,
    });
    heading('Sending a test delivery');
    if (results.length === 0) {
      warn(
        'No active webhook. Add one under "webhooks" in helpwell/helpwell.config.json, then run helpwell sync.',
      );
    } else {
      table(
        results.map((r) => [
          host(r.url),
          r.status === 'delivered'
            ? `delivered (${r.responseCode})`
            : `failed: ${r.error ?? r.responseCode}`,
        ]),
      );
    }
    say();
    return results;
  });
}
