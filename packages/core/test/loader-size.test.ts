/**
 * The widget prompts tell people how big the loader is, and that number was
 * written once by hand and then drifted (it said 0.5 KB; the loader had grown
 * to about 0.7). This gzips the loader the widget actually builds, the file
 * the API serves as `loader.js`, and fails when the stated size is more than
 * 0.2 KB out, so the next change that grows the loader also fixes the claim.
 *
 * It reads the widget's build, like every test that serves the widget:
 * `pnpm --filter @helpwell/widget build` first.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { LOADER_GZIP_KB, widgetInstallPromptSpec } from '../src/install-prompts.js';
import { formatSetupPrompt } from '../src/setup-prompt.js';

const LOADER = fileURLToPath(new URL('../../widget/dist/loader.global.js', import.meta.url));

describe('the stated loader size', () => {
  it('is within 0.2 KB of the built loader, gzipped', () => {
    expect(
      existsSync(LOADER),
      `No built loader at ${LOADER}. Run \`pnpm --filter @helpwell/widget build\` first.`,
    ).toBe(true);
    const actual = gzipSync(readFileSync(LOADER)).length / 1024;
    expect(
      Math.abs(actual - LOADER_GZIP_KB),
      `The loader is ${actual.toFixed(2)} KB gzipped; LOADER_GZIP_KB in src/install-prompts.ts says ${LOADER_GZIP_KB}.`,
    ).toBeLessThanOrEqual(0.2);
  });

  it('is the number the widget prompt gives', () => {
    const text = formatSetupPrompt(widgetInstallPromptSpec('html', { apiPath: '/api/helpwell' }));
    expect(text).toContain(`The loader is about ${LOADER_GZIP_KB} KB gzipped`);
  });
});
