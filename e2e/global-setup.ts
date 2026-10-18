/**
 * The install every journey starts from: Ridgeline as seeded, with its demo
 * engagements switched off.
 *
 * The seed puts a tour on `/`, a banner on every page and a carousel on
 * `/pricing`, which is right for a person exploring the playground and wrong
 * for a test: a spotlight over the page takes the click meant for the widget.
 * The engage journeys switch engagements back on with exactly the ones they
 * test, and the fixtures put this baseline back after each of them.
 */

import { request } from '@playwright/test';
import { ADMIN_COOKIE } from './fixtures';
import { API_PATH, PLAYGROUND } from './support/ports.mjs';

export default async function globalSetup(): Promise<void> {
  const api = await request.newContext({
    baseURL: PLAYGROUND,
    extraHTTPHeaders: { cookie: `${ADMIN_COOKIE.name}=${ADMIN_COOKIE.value}` },
  });
  try {
    const response = await api.patch(`${API_PATH}/admin/settings`, {
      data: { engage: { enabled: false } },
    });
    if (!response.ok()) {
      throw new Error(
        `Could not set the baseline Settings: ${response.status()} ${await response.text()}`,
      );
    }
  } finally {
    await api.dispose();
  }
}
