/**
 * `helpwell capture` describes the slice of Playwright it uses as its own
 * types, so the CLI builds without Playwright installed. That slice has to
 * stay something real Playwright satisfies as it is: a parameter narrower
 * than Playwright's own (an `unknown[]` where Playwright takes a read-only
 * array of cookies) turns every host that passes its Chromium in into a cast.
 *
 * These checks are made by the compiler, so `pnpm --filter helpwell
 * typecheck` is what fails when the slice drifts; the test run itself only
 * proves the file loads. Types only: nothing here starts a browser.
 */

import type { BrowserContext, chromium, Page } from '@playwright/test';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  CaptureOptions,
  PlaywrightChromium,
  PlaywrightContext,
  PlaywrightPage,
} from '../src/commands/capture.js';

describe('the Playwright slice capture relies on', () => {
  it('is satisfied by the Chromium from @playwright/test, with no cast', () => {
    expectTypeOf<typeof chromium>().toExtend<PlaywrightChromium>();
  });

  it('is satisfied by a real context and page, cookies included', () => {
    expectTypeOf<BrowserContext>().toExtend<PlaywrightContext>();
    expectTypeOf<Page>().toExtend<PlaywrightPage>();
    expectTypeOf<BrowserContext['addCookies']>().toExtend<PlaywrightContext['addCookies']>();
  });

  it('is what capture accepts in place of loading Playwright itself', () => {
    expectTypeOf<() => Promise<typeof chromium>>().toExtend<
      NonNullable<CaptureOptions['chromium']>
    >();
  });
});
