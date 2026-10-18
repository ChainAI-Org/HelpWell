import { describe, expect, it } from 'vitest';
import { ARTICLE_IMAGES_JS } from '../src/client/article-images.js';

/** The two helpers from the editor's script, as the browser runs them. */
function helpers() {
  const start = ARTICLE_IMAGES_JS.indexOf('  function shotOf');
  const end = ARTICLE_IMAGES_JS.indexOf('  function upload');
  return new Function(`${ARTICLE_IMAGES_JS.slice(start, end)}; return { shotOf, titled };`)() as {
    shotOf(src: string): string | null;
    titled(markdown: string, shot: string | null): string;
  };
}

describe('An annotated copy of a screenshot', () => {
  it('is titled after the screenshot, so a retake can find it', () => {
    const { shotOf, titled } = helpers();
    expect(shotOf('/api/helpwell/screenshots/billing.png')).toBe('billing');
    expect(shotOf('https://help.acme.example/x/_screenshots/billing.png?v=2')).toBe('billing');
    expect(shotOf('/api/helpwell/media/_media/abc.png')).toBeNull();
    expect(shotOf('blob:https://x/1')).toBeNull();
    expect(titled('![billing-annotated](../_media/abc.png)', 'billing')).toBe(
      '![billing-annotated](../_media/abc.png "Annotated copy of _screenshots/billing.png")',
    );
    expect(titled('![x](../_media/abc.png)', null)).toBe('![x](../_media/abc.png)');
  });
});
