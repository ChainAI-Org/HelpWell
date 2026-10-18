/**
 * One view of Settings for the whole install.
 *
 * The dashboard and the API each hold a settings store. A save in either
 * must be what the other reads on its very next request: an engagement
 * switched off in the dashboard that the widget keeps showing for a few
 * seconds reads as a save that did not work. Two installs in one process,
 * as a hosted service runs them, must never see each other's saves.
 */

import { createHelpWellHandler, type HelpWellHandler } from '@helpwell/core/api';
import type { Db } from '@helpwell/core/db';
import { createForm } from '@helpwell/core/repos';
import { SettingsStore } from '@helpwell/core/settings';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDashboard, type DashboardHandler } from '../src/index.js';
import { freshDb } from './helpers/db.js';

const ORIGIN = 'http://localhost';
const BASE = '/admin/helpwell';
const API = '/api/helpwell';

interface Install {
  db: Db;
  api: HelpWellHandler;
  dashboard: DashboardHandler;
}

async function install(name: string): Promise<Install> {
  const { db } = await freshDb();
  await new SettingsStore(db).update({
    product: { name },
    engage: {
      enabled: true,
      engagements: [
        { id: 'hello', kind: 'banner', banner: { blocks: [{ type: 'text', markdown: 'Hi' }] } },
      ],
    },
  });
  return {
    db,
    api: createHelpWellHandler({ db, adminToken: `token-${name}`, env: {}, support: false }),
    dashboard: createDashboard({
      db,
      basePath: BASE,
      apiPath: API,
      isAdmin: (request) => request.headers.get('x-admin') === 'yes',
    }),
  };
}

function apiGet(on: Install, path: string, admin?: string): Promise<Response> {
  return on.api(
    new Request(`${ORIGIN}${API}${path}`, {
      headers: admin ? { cookie: `hw_admin=${admin}` } : {},
    }),
  );
}

async function engagementIds(on: Install): Promise<string[]> {
  const body = (await (await apiGet(on, '/engage?path=/')).json()) as { items: { id: string }[] };
  return body.items.map((item) => item.id);
}

function dashboardPost(on: Install, path: string, fields: [string, string][]): Promise<Response> {
  return on.dashboard(
    new Request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: { 'x-admin': 'yes', origin: ORIGIN },
      body: new URLSearchParams(fields),
    }),
  );
}

let a: Install;
let b: Install;

beforeEach(async () => {
  [a, b] = await Promise.all([install('Acme'), install('Globex')]);
});

describe('one view of Settings across the dashboard and the API', () => {
  it('shows a dashboard save to the widget’s very next engagements read', async () => {
    expect(await engagementIds(a)).toEqual(['hello']);

    const saved = await dashboardPost(a, '/engage/hello', [['action', 'toggle']]);
    expect(saved.status).toBe(303);
    expect(await engagementIds(a)).toEqual([]);

    const settings = (await (await apiGet(a, '/admin/settings', 'token-Acme')).json()) as {
      engage: { engagements: { id: string; enabled: boolean }[] };
    };
    expect(settings.engage.engagements[0]?.enabled).toBe(false);
  });

  it('shows a dashboard save to the widget’s very next /config', async () => {
    const config = async () =>
      ((await (await apiGet(a, '/config')).json()) as { widget: { home: { blocks: unknown[] } } })
        .widget.home.blocks;
    expect(await config()).not.toContainEqual({ type: 'form', formId: 'news' });

    await createForm(a.db, { id: 'news', name: 'News', enabled: true, definition: {} });
    await dashboardPost(a, '/forms/news', [['action', 'add-home']]);
    expect(await config()).toContainEqual({ type: 'form', formId: 'news' });
  });

  it('shows an API save on the dashboard’s very next page', async () => {
    const title = async () => {
      const page = await a.dashboard(
        new Request(`${ORIGIN}${BASE}/gaps`, { headers: { 'x-admin': 'yes' } }),
      );
      return /<title>([^<]*)<\/title>/.exec(await page.text())?.[1] ?? '';
    };
    expect(await title()).toContain('Acme');

    // What the Settings page does as each field changes.
    const saved = await a.api(
      new Request(`${ORIGIN}${API}/admin/settings`, {
        method: 'PATCH',
        headers: { cookie: 'hw_admin=token-Acme', 'content-type': 'application/json' },
        body: JSON.stringify({ product: { name: 'Acme Labs' } }),
      }),
    );
    expect(saved.status).toBe(200);
    expect(await title()).toContain('Acme Labs');
  });

  it('never shows one install’s save to another', async () => {
    expect(await engagementIds(a)).toEqual(['hello']);
    expect(await engagementIds(b)).toEqual(['hello']);

    await dashboardPost(a, '/engage/hello', [['action', 'toggle']]);
    expect(await engagementIds(a)).toEqual([]);
    expect(await engagementIds(b)).toEqual(['hello']);
    const name = async (on: Install) =>
      ((await (await apiGet(on, '/config')).json()) as { product: { name: string } }).product.name;
    expect(await name(a)).toBe('Acme');
    expect(await name(b)).toBe('Globex');
  });
});
