/**
 * Where the suite's two servers listen, shared by the config, the scripts
 * that start them and the tests.
 *
 * Two origins on purpose. Ridgeline, with HelpWell mounted inside it, is on
 * `localhost`; the "other site" that embeds the widget is on `127.0.0.1`, a
 * different site as far as the browser's cookie rules are concerned. Unusual
 * ports, so a playground a developer already has open on 3000 is left alone.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PLAYGROUND_PORT = Number(process.env.E2E_PORT ?? 3917);
export const HOST_PORT = Number(process.env.E2E_HOST_PORT ?? 3918);

export const PLAYGROUND = `http://localhost:${PLAYGROUND_PORT}`;
export const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`;

export const API_PATH = '/api/helpwell';
export const DASHBOARD_PATH = '/admin/helpwell';
export const HELP_PATH = '/help';

/** Cloudflare's published test secret that always passes. */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

/**
 * The admin token the suite's playground runs with. A production build does
 * not trust the playground's demo cookie (examples/playground/lib/admin.ts),
 * so the suite signs in the way a deployed install would: with the token, in
 * the `hw_admin` cookie. A fixed test value, never a real secret.
 */
export const E2E_ADMIN_TOKEN = 'e2e-only-admin-token-0123456789abcdef0123456789abcdef';

/** The scratch copy of the playground's helpwell/ folder the server runs from. */
export const WORK_DIR = process.env.E2E_WORK_DIR ?? join(tmpdir(), 'helpwell-e2e');
