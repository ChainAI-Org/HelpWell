/**
 * The block vocabulary: callouts, steps, tabs, accordions and video, and the
 * relative paths articles in a repo write. Each block is checked for what it
 * draws on a page, what it draws in the widget, and that it lets nothing
 * through the escaping the rest of the renderer guarantees.
 */

import { describe, expect, it } from 'vitest';
import {
  markdownBlockStyles,
  renderMarkdown,
  VIDEO_EMBED_ORIGINS,
  videoEmbed,
} from '../src/index.js';

const render = (source: string) => renderMarkdown(source).html;
const panel = (source: string) => renderMarkdown(source, { surface: 'panel' }).html;

describe('relative URLs', () => {
  it('keeps the relative paths an article in a repo writes', () => {
    expect(render('![The dashboard](../_screenshots/dashboard.png)')).toBe(
      '<p><img src="../_screenshots/dashboard.png" alt="The dashboard" loading="lazy"></p>',
    );
    expect(render('![x](img.png)')).toContain('<img src="img.png"');
    expect(render('[next](?page=2)')).toContain('<a href="?page=2">');
  });

  it('still refuses every scheme but http(s) and mailto', () => {
    expect(render('[x](vbscript:msgbox(1))')).toBe('<p>x</p>');
    expect(render('![x](file:///etc/passwd)')).toBe('<p>x</p>');
    expect(render('[x](mailto:help@acme.com)')).toContain('href="mailto:help@acme.com"');
  });

  it('refuses a URL carrying a control character a browser would strip', () => {
    const sneaky = `[x](${String.fromCharCode(1)}javascript:alert(1))`;
    expect(render(sneaky)).not.toContain('href');
  });

  it('never decodes an entity into a scheme', () => {
    // Escaped once: the browser reads the href as literal text, a relative path.
    expect(render('[x](javascript&#58;alert(1))')).toContain('href="javascript&amp;#58;alert(1)"');
  });
});

describe('callouts', () => {
  it('turns a GitHub alert into a callout with a title and a body', () => {
    const out = render('> [!TIP]\n> Export **before** you close the month.');
    expect(out).toContain('<div class="hc-callout hc-callout--tip" role="note">');
    expect(out).toContain('<span>Tip</span>');
    expect(out).toContain('<p>Export <strong>before</strong> you close the month.</p>');
    expect(out).not.toContain('[!TIP]');
  });

  it('knows all five kinds, with INFO and DANGER as aliases', () => {
    const kinds: [string, string][] = [
      ['NOTE', 'note'],
      ['TIP', 'tip'],
      ['IMPORTANT', 'important'],
      ['WARNING', 'warning'],
      ['CAUTION', 'caution'],
      ['info', 'note'],
      ['Danger', 'caution'],
    ];
    for (const [marker, kind] of kinds) {
      expect(render(`> [!${marker}]\n> body`)).toContain(`hc-callout--${kind}`);
    }
  });

  it('takes text after the marker as the title', () => {
    expect(render('> [!WARNING] Deleting is permanent\n> There is no undo.')).toContain(
      '<span>Deleting is permanent</span>',
    );
  });

  it('renders lists inside, and leaves an unknown marker as a plain quote', () => {
    expect(render('> [!NOTE]\n> - one\n> - two')).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(render('> [!SHRUG]\n> hm')).toBe('<blockquote><p>[!SHRUG] hm</p></blockquote>');
  });

  it('escapes what is inside', () => {
    const out = render('> [!NOTE] <img src=x onerror=alert(1)>\n> <script>x</script>');
    expect(out).not.toMatch(/<img|<script/);
  });

  it('is a blockquote in the widget, so it takes the quote style the panel has', () => {
    expect(panel('> [!CAUTION]\n> Careful.')).toMatch(
      /^<blockquote class="hc-callout hc-callout--caution">/,
    );
  });

  it('does not anchor a heading inside a quote, since the indexer never sees one', () => {
    const { html, headings } = renderMarkdown('> [!NOTE]\n> ## Inside\n\n## Outside');
    expect(headings.map((h) => h.id)).toEqual(['outside']);
    expect(html).toContain('<h2>Inside</h2>');
  });
});

describe('steps', () => {
  const source = [
    ':::steps',
    '### Open Billing',
    'Go to **Settings**, then Billing.',
    '',
    '![Billing](/shots/billing.png)',
    '### Export',
    'Click Export.',
    ':::',
    '',
    'After.',
  ].join('\n');

  it('makes each heading a numbered step with its body', () => {
    const { html, headings } = renderMarkdown(source);
    expect(html).toContain('<ol class="hc-steps">');
    expect(html).toContain('<li class="hc-step"><h3 id="open-billing" class="hc-step__title">');
    expect(html).toContain(
      '<div class="hc-step__body"><p>Go to <strong>Settings</strong>, then Billing.</p>',
    );
    expect(html).toContain('<img src="/shots/billing.png" alt="Billing" loading="lazy">');
    expect(html).toContain('<p>After.</p>');
    expect(headings.map((h) => h.id)).toEqual(['open-billing', 'export']);
  });

  it('counts heading ids across blocks the way the indexer does', () => {
    const ids = renderMarkdown('## Export\n\n:::steps\n## Export\n:::\n\n## Export').headings.map(
      (h) => h.id,
    );
    expect(ids).toEqual(['export', 'export-1', 'export-2']);
  });

  it('draws a plain numbered list as steps when there are no headings', () => {
    expect(render(':::steps\n1. One\n2. Two\n:::')).toBe(
      '<div class="hc-steps"><ol><li>One</li><li>Two</li></ol></div>',
    );
  });

  it('ignores indentation inside the block', () => {
    expect(render(':::steps\n  ### A\n  body\n:::')).toContain(
      '<h3 id="a" class="hc-step__title">',
    );
  });
});

describe('tabs', () => {
  const source = ':::tabs\n== macOS\nPress **Cmd+K**.\n== Windows\nPress Ctrl+K.\n:::';

  it('renders radio tabs that switch without a script', () => {
    const out = render(source);
    expect(out).toMatch(
      /^<div class="hc-tabs"><div class="hc-tab"><input class="hc-tab__radio" type="radio" name="hc-tabs-[a-z0-9]+-0" id="hc-tabs-[a-z0-9]+-0-0" checked>/,
    );
    expect(out).toContain('<label class="hc-tab__label" for="');
    expect(out).toContain(
      '>macOS</label><div class="hc-tab__panel"><p>Press <strong>Cmd+K</strong>.</p></div>',
    );
    expect(out).toContain('>Windows</label>');
    expect(out.match(/ checked/g)).toHaveLength(1);
  });

  it('gives two groups on one page different names', () => {
    const out = render(`${source}\n\n${source}`);
    const names = new Set([...out.matchAll(/name="([^"]+)"/g)].map((m) => m[1]));
    expect(names.size).toBe(2);
  });

  it('renders the same document the same way every time', () => {
    expect(render(source)).toBe(render(source));
  });

  it('is a stack of disclosures in the widget, the first one open', () => {
    const out = panel(source);
    expect(out).toContain('<div class="hc-tabs hc-tabs--stacked">');
    expect(out).toContain('<details class="hc-accordion" open><summary>macOS</summary>');
    expect(out).toContain('<details class="hc-accordion"><summary>Windows</summary>');
    expect(out).not.toContain('type="radio"');
  });

  it('does not split on a tab marker inside a code fence', () => {
    const out = render(':::tabs\n== One\n```\n== not a tab\n```\n:::');
    expect(out.match(/hc-tab__label/g)).toHaveLength(1);
    expect(out).toContain('== not a tab');
  });
});

describe('accordions', () => {
  it('renders details and summary with Markdown inside', () => {
    expect(render(':::details How do refunds work?\nWithin **14** days.\n:::')).toBe(
      '<details class="hc-accordion"><summary>How do refunds work?</summary><div class="hc-accordion__body"><p>Within <strong>14</strong> days.</p></div></details>',
    );
  });

  it('accepts accordion as a name, and nests', () => {
    const out = render(':::accordion Outer\n:::details Inner\ntext\n:::\n:::\n\nafter');
    expect(out).toContain('<summary>Outer</summary>');
    expect(out).toContain('<summary>Inner</summary>');
    expect(out).toMatch(/<\/details><\/div><\/details>\n<p>after<\/p>$/);
  });

  it('keeps a closing marker inside a code fence from closing the block', () => {
    expect(render(':::details Code\n```\n:::\n```\nstill inside\n:::')).toContain(
      '<pre><code>:::</code></pre>\n<p>still inside</p></div></details>',
    );
  });

  it('runs to the end when nobody closed it', () => {
    expect(render(':::details Open\nbody')).toContain('<p>body</p></div></details>');
  });

  it('leaves an unknown container as text', () => {
    expect(render(':::warning\nx\n:::')).toBe('<p>:::warning x :::</p>');
  });

  it('escapes the summary', () => {
    expect(render(':::details <b>x</b>\ny\n:::')).toContain(
      '<summary>&lt;b&gt;x&lt;/b&gt;</summary>',
    );
  });
});

describe('video', () => {
  it('embeds YouTube from its no-cookie domain', () => {
    const out = render('![Setting up billing](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90)');
    expect(out).toContain(
      '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90" title="Setting up billing"',
    );
    expect(out).toContain('<figcaption>Setting up billing</figcaption>');
    expect(out).toContain('loading="lazy"');
  });

  it('knows the URL shapes each provider shares', () => {
    expect(videoEmbed('https://youtu.be/dQw4w9WgXcQ')?.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
    expect(videoEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.provider).toBe('youtube');
    expect(videoEmbed('https://youtu.be/dQw4w9WgXcQ?t=1m30s')?.src).toContain('?start=90');
    expect(videoEmbed('https://vimeo.com/76979871')?.src).toBe(
      'https://player.vimeo.com/video/76979871',
    );
    expect(videoEmbed('https://vimeo.com/76979871/abc123def0')?.src).toBe(
      'https://player.vimeo.com/video/76979871?h=abc123def0',
    );
    expect(
      videoEmbed('https://www.loom.com/share/0123456789abcdef0123456789abcdef?sid=x')?.src,
    ).toBe('https://www.loom.com/embed/0123456789abcdef0123456789abcdef');
    expect(videoEmbed('/api/helpwell/media/demo.mp4')).toEqual({
      provider: 'file',
      src: '/api/helpwell/media/demo.mp4',
      url: '/api/helpwell/media/demo.mp4',
    });
  });

  it('embeds Wistia from its player, by the media id alone', () => {
    const out = render('![Product tour](https://acme.wistia.com/medias/abcde12345)');
    expect(out).toContain(
      '<iframe src="https://fast.wistia.net/embed/iframe/abcde12345" title="Product tour"',
    );
    expect(videoEmbed('https://fast.wistia.net/embed/iframe/abcde12345')).toEqual({
      provider: 'wistia',
      src: 'https://fast.wistia.net/embed/iframe/abcde12345',
      url: 'https://fast.wistia.net/embed/iframe/abcde12345',
    });
    expect(videoEmbed('https://wi.st/medias/abcde12345')?.provider).toBe('wistia');
    expect(videoEmbed('https://acme.wistia.com/medias/abcde12345?x="><script>')?.src).toBe(
      'https://fast.wistia.net/embed/iframe/abcde12345',
    );
    // Not https, not Wistia's own host, or not a media id: not a player.
    expect(videoEmbed('http://acme.wistia.com/medias/abcde12345')).toBeNull();
    expect(videoEmbed('https://wistia.com.evil.example/medias/abcde12345')).toBeNull();
    expect(videoEmbed('https://acme.wistia.com/medias/short')).toBeNull();

    // In the widget's panel it is the same link card the other players get.
    const card = panel('![Product tour](https://acme.wistia.com/medias/abcde12345)');
    expect(card).toContain('href="https://fast.wistia.net/embed/iframe/abcde12345"');
    expect(card).toContain(' · Wistia');
    expect(card).not.toContain('<iframe');
  });

  it('frames nothing outside the allowlist, and rebuilds the player URL from the id', () => {
    expect(videoEmbed('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbed('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoEmbed('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(videoEmbed('javascript:alert(1)//.mp4')).toBeNull();
    expect(videoEmbed('https://www.loom.com/share/not-an-id')).toBeNull();

    const out = render('![x](https://www.youtube.com/watch?v=dQw4w9WgXcQ&list="><script>)');
    expect(out).not.toContain('<script>');
    const frames = [...out.matchAll(/<iframe src="([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(frames.length).toBeGreaterThan(0);
    for (const src of frames) {
      expect(VIDEO_EMBED_ORIGINS.some((origin) => src.startsWith(`${origin}/`))).toBe(true);
    }
  });

  it('plays a video file inline', () => {
    expect(render('![A demo](../_screenshots/demo.mp4)')).toBe(
      '<figure class="hc-video hc-video--file"><video src="../_screenshots/demo.mp4" controls preload="metadata" playsinline aria-label="A demo"></video><figcaption>A demo</figcaption></figure>',
    );
  });

  it('is a link in the middle of a sentence', () => {
    expect(render('Watch ![the intro](https://youtu.be/dQw4w9WgXcQ) first.')).toBe(
      '<p>Watch <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer">the intro</a> first.</p>',
    );
  });

  it('is a link card in the widget, never an iframe', () => {
    const out = panel('![Intro](https://vimeo.com/76979871)');
    expect(out).not.toContain('<iframe');
    expect(out).toContain(
      '<a href="https://vimeo.com/76979871" target="_blank" rel="noopener noreferrer">',
    );
    expect(out).toContain('<span>Intro</span>');
    expect(out).toContain('Vimeo');
  });

  it('keeps an ordinary image an image', () => {
    expect(render('![x](https://cdn.example/a.gif)')).toBe(
      '<p><img src="https://cdn.example/a.gif" alt="x" loading="lazy"></p>',
    );
  });
});

describe('block styles', () => {
  it('scopes every rule it writes', () => {
    const css = markdownBlockStyles('.hc-body');
    const selectors = css
      .split('}')
      .map((rule) => rule.split('{')[0]?.trim() ?? '')
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) {
      for (const part of selector.split(','))
        expect(part.trim().startsWith('.hc-body ')).toBe(true);
    }
  });
});
