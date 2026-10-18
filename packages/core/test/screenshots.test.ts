import { describe, expect, it } from 'vitest';
import { annotatedCopyTitle, refusedScreenshot, screenshotsInArticle } from '../src/content.js';

describe('Retaking a screenshot', () => {
  const billing = 'https://app.acme.example/settings/billing';

  it('keeps the last picture after an error, another host or a sign-in page', () => {
    expect(refusedScreenshot(billing, billing, 200)).toBeNull();
    expect(refusedScreenshot(billing, `${billing}/`, null)).toBeNull();
    expect(refusedScreenshot(billing, `${billing}/plans`, 200)).toBeNull();
    expect(refusedScreenshot(billing, 'https://app.acme.example/settings', 200)).toBeNull();
    expect(refusedScreenshot(billing, billing, 500)).toBe(
      'The page answered 500, so the last picture was kept.',
    );
    expect(refusedScreenshot(billing, 'https://sso.acme.example/start', 200)).toBe(
      'The page sent the browser to sso.acme.example, probably to sign in. Sign in again, then retake. The last picture was kept.',
    );
    for (const path of ['/login?next=%2F', '/users/sign_in', '/sign-in', '/auth/', '/session'])
      expect(refusedScreenshot(billing, `https://app.acme.example${path}`, 200)).toMatch(
        /sign-in has probably expired/,
      );
    expect(
      refusedScreenshot(billing, 'https://app.acme.example/login', 200, 'Paste a fresh cookie'),
    ).toContain('Paste a fresh cookie, then retake.');
  });

  it('finds the screenshots an article shows and its annotated copies', () => {
    const body = [
      '![Billing](../_screenshots/billing.png)',
      `![billing-annotated](../_media/abc.png "${annotatedCopyTitle('team')}")`,
      '![Other](../_media/other.png)',
    ].join('\n\n');
    expect(screenshotsInArticle(body)).toEqual({
      shown: ['billing', 'team'],
      copies: [{ image: '../_media/abc.png', name: 'team' }],
    });
    expect(screenshotsInArticle('No pictures.')).toEqual({ shown: [], copies: [] });
  });
});
