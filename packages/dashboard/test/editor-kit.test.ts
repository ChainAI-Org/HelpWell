/**
 * The editor kit: the pieces every dashboard editor is drawn with.
 *
 * What matters here is what a page can rely on: controls post the names they
 * are given, values are escaped, Markdown the rich box cannot show stays
 * Markdown, media never loads from a video host, and the shell pieces carry
 * the hooks the kit's script reads.
 */

import { describe, expect, it } from 'vitest';
import { EDITOR_MARK_JS } from '../src/client/editor-kit.js';
import {
  card,
  chip,
  composer,
  composerHtml,
  describeMedia,
  editorShell,
  editorTopbar,
  field,
  isSimpleMarkdown,
  list,
  listRow,
  mediaBlock,
  panels,
  performanceCard,
  plainLength,
  previewPanel,
  segmented,
  summaryRow,
  textInput,
  tilePicker,
  toggle,
  typeTiles,
} from '../src/editor-kit/index.js';

describe('the composer', () => {
  it('knows which Markdown the rich box can show and write back', () => {
    expect(isSimpleMarkdown('### Title\n\nOne **bold** line with a [link](/x).')).toBe(true);
    expect(isSimpleMarkdown('- one\n- two\n\n1. first\n2. second')).toBe(true);
    expect(isSimpleMarkdown('Hi {{first_name}}, _welcome_.')).toBe(true);
    for (const complex of [
      '> [!NOTE]\n> A callout',
      ':::steps\n### One\n:::',
      '| a | b |\n| - | - |',
      '![Alt](/img.png)',
      '```\ncode\n```',
      '<div>html</div>',
      '- one\n  - nested',
    ]) {
      expect(isSimpleMarkdown(complex), complex).toBe(false);
    }
  });

  it('draws simple Markdown as HTML, escaped, with unsafe links left as words', () => {
    expect(
      composerHtml('## Hello\n\nA **bold** <b>tag</b> and [a link](https://example.com).'),
    ).toBe(
      '<h2>Hello</h2><p>A <strong>bold</strong> &lt;b&gt;tag&lt;/b&gt; and <a href="https://example.com">a link</a>.</p>',
    );
    expect(composerHtml('[click](javascript:alert(1))')).toBe('<p>click)</p>');
    expect(composerHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(composerHtml('Hi {{first_name}}')).toContain('data-ek-merge="first_name"');
  });

  it('counts what a reader sees, not the Markdown around it', () => {
    expect(plainLength('### Hi\n\n**Bold** [link](https://example.com/very/long)')).toBe(
      'Hi\nBold link'.length,
    );
  });

  it('keeps the Markdown in a named textarea, rich when it can be, Markdown when not', () => {
    const rich = composer({
      name: 'blocks.0.markdown',
      value: '**Hi** & bye',
      label: 'Text',
    }).value;
    expect(rich).toContain('data-mode="rich"');
    expect(rich).toContain('<textarea class="ek-composer__source" name="blocks.0.markdown"');
    expect(rich).toContain('>**Hi** &amp; bye</textarea>');
    expect(rich).toContain('<strong>Hi</strong> &amp; bye');

    const source = composer({ name: 'm', value: '> [!TIP]\n> Careful', label: 'Text' }).value;
    expect(source).toContain('data-mode="source"');
    expect(source).not.toContain('<strong');
  });

  it('shows only the tools the page gives it, and counts against a length', () => {
    const plain = composer({ name: 'm', value: 'Hello', label: 'Text' }).value;
    expect(plain).not.toContain('Write with AI');
    expect(plain).not.toContain('Personalise');
    expect(plain).toContain('>5</span>');

    const full = composer({
      name: 'm',
      value: 'Hello there',
      label: 'Text',
      max: 5,
      tools: {
        ai: { url: '/x/_write', context: 'A banner.' },
        personalise: [{ key: 'first_name', label: 'First name' }],
        media: [{ label: 'An image', name: 'op', value: 'add-block|p|image' }],
      },
    }).value;
    expect(full).toContain('data-ek-ai="/x/_write"');
    expect(full).toContain('data-ek-merge-insert="first_name"');
    expect(full).toContain('name="op" value="add-block|p|image"');
    expect(full).toContain('data-over="true"');
    expect(full).toContain('11 / 5');
  });
});

describe('controls', () => {
  it('posts the names they are given, with the chosen one checked and labels escaped', () => {
    const seg = segmented({
      name: 'look.size',
      value: 'm',
      choices: [
        { value: 's', label: 'Small' },
        { value: 'm', label: '<Medium>' },
      ],
    }).value;
    expect(seg).toContain('name="look.size" value="m" checked');
    expect(seg).not.toContain('value="s" checked');
    expect(seg).toContain('&lt;Medium&gt;');

    const tiles = tilePicker({
      name: 'layout',
      value: 'top',
      choices: [
        { value: 'top', label: 'Top', sketch: card({ icon: 'layout', tone: 'peach', title: 'x' }) },
      ],
    }).value;
    expect(tiles).toContain('name="layout" value="top" checked');
  });

  it('draws a switch that posts false when off', () => {
    const on = toggle({ name: 'live:bool', checked: true, label: 'Live' }).value;
    expect(on).toContain(
      '<input type="hidden" name="live:bool" value="false"><input type="checkbox" name="live:bool" value="true" checked',
    );
    const off = toggle({ name: 'x', checked: false, off: null }).value;
    expect(off).not.toContain('type="hidden"');
    expect(off).not.toContain(' checked');
  });

  it('marks a field with a problem, and puts the message after the box', () => {
    const html = field(
      { label: 'Link', error: 'Use an https:// address.' },
      textInput({ name: 'url', value: 'javascript:alert(1)' }),
    ).value;
    expect(html).toMatch(
      /data-invalid="true">[\s\S]*name="url" value="javascript:alert\(1\)"[\s\S]*Use an https:\/\/ address\./,
    );
  });
});

describe('media blocks', () => {
  it('never loads from a video host: a drawn thumbnail with the host on it', () => {
    const html = mediaBlock({
      kind: 'video',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Demo',
      described: true,
      urlControl: textInput({ name: 'v.url', value: '' }),
      describeControl: textInput({ name: 'v.title', value: 'Demo' }),
    }).value;
    expect(html).toContain('>YouTube</span>');
    expect(html).not.toMatch(/<(img|iframe|video)[^>]*youtube/);
    expect(html).toContain('data-on="true"');
  });

  it('shows an image it may load, and refuses one it may not', () => {
    const base = {
      kind: 'image' as const,
      described: false,
      urlControl: textInput({ name: 'i.url', value: '' }),
      describeControl: textInput({ name: 'i.alt', value: '' }),
    };
    expect(mediaBlock({ ...base, url: '/api/media/_engage/a.png' }).value).toContain(
      '<img src="/api/media/_engage/a.png"',
    );
    expect(mediaBlock({ ...base, url: 'javascript:alert(1)' }).value).not.toContain('<img');
    expect(mediaBlock({ ...base, url: '//evil.example/a.png' }).value).not.toContain('<img');
    expect(describeMedia('image', '/api/media/_engage/a.png')).toMatchObject({
      name: 'a.png',
      meta: 'PNG · uploaded',
    });
    expect(describeMedia('gif', 'https://cdn.example.com/x/loop.gif')).toMatchObject({
      badge: 'GIF',
      meta: 'GIF · cdn.example.com',
    });
  });
});

describe('the editor page pieces', () => {
  it('draws the type row with the current one marked and the others as links or inert', () => {
    const html = typeTiles({
      label: 'Type',
      current: 'modal',
      choices: [
        { value: 'modal', label: 'Modal', icon: 'popup', tone: 'peach', href: '/new?k=modal' },
        { value: 'banner', label: 'Banner', icon: 'banner', tone: 'butter', href: '/new?k=banner' },
        { value: 'tour', label: 'Tour', icon: 'route', tone: 'mint' },
      ],
    }).value;
    expect(html).toMatch(/<span class="ek-type" aria-current="true">[\s\S]*Modal/);
    expect(html).toContain('<a class="ek-type" href="/new?k=banner">');
    expect(html).toContain('aria-disabled="true"');
  });

  it('lists items as links to their panels, one of them current', () => {
    const rows = [0, 1].map((i) =>
      listRow({
        number: i + 1,
        title: `Step ${i + 1}`,
        panel: `p${i}`,
        path: `steps.${i}`,
        current: i === 1,
        trail: [chip('#nav', 'mono')],
      }),
    );
    const html = list({ label: 'Steps', rows, reorder: 'move|{from}|{to}' }).value;
    expect(html).toContain('data-ek-reorder="move|{from}|{to}"');
    expect(html).toMatch(
      /href="#p1" data-ek-select="p1" data-ek-path="steps\.1" draggable="true" aria-current="true"/,
    );
    const shown = panels([
      { id: 'p0', current: false, body: card({ icon: 'route', tone: 'mint', title: 'One' }) },
      { id: 'p1', current: true, body: card({ icon: 'route', tone: 'mint', title: 'Two' }) },
    ]).value;
    expect(shown).toContain('id="p1" data-ek-current');
    expect(shown).not.toContain('id="p0" data-ek-current');
  });

  it('opens a summary row when asked, with the hook its sentence is rewritten through', () => {
    const html = summaryRow({
      key: 'audience',
      idPrefix: 'rule-',
      group: 'rules',
      icon: 'users',
      tone: 'mint',
      title: 'Audience',
      meta: '3 match now',
      summary: 'Everyone',
      open: true,
      body: textInput({ name: 'a', value: '' }),
    }).value;
    expect(html).toContain('id="rule-audience" open');
    expect(html).toContain('data-summary="audience">Everyone<');
  });

  it('draws the top bar with the name as the page heading, escaped', () => {
    const html = editorTopbar({
      back: { href: '/engage', label: 'All engagements' },
      crumbs: [{ label: 'Engage', href: '/engage' }],
      title: '<Launch>',
      state: { label: 'Live', tone: 'good' },
      note: { text: 'All changes saved', tone: 'good', dirty: 'Unsaved changes' },
    }).value;
    expect(html).toContain('<h1 class="ek-crumb__title">&lt;Launch&gt;</h1>');
    expect(html).toContain('data-dirty-text="Unsaved changes"');
  });

  it('frames the preview, loading until the page says it is ready, and shows how it is doing', () => {
    const html = previewPanel({
      url: 'app.example.com/pricing',
      frame: { src: '/engage/_preview', title: 'Preview' },
      caption: { icon: 'scroll', text: 'At 60% scroll', summaryKey: 'moment' },
      replay: true,
      below: performanceCard({
        label: 'Performance · last 30 days',
        stats: [{ value: '3,412', label: 'Shown', percent: 100, tone: 'lavender' }],
      }),
    }).value;
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('<iframe src="/engage/_preview"');
    expect(html).toContain('data-summary="moment">At 60% scroll<');
    expect(html).toContain('data-ek-replay');
    expect(html).toContain('3,412');
    // The page is marked as having script before the editor is drawn, by a
    // served file rather than an inline script.
    const shell = editorShell({
      basePath: '/admin/helpwell',
      main: textInput({ name: 'a' }),
      side: textInput({ name: 'b' }),
      preview: textInput({ name: 'c' }),
    }).value;
    expect(shell).toMatch(
      /^<script src="\/admin\/helpwell\/_assets\/editor-mark\.[0-9a-f]{12}\.js"><\/script><div class="ek-layout">/,
    );
    expect(EDITOR_MARK_JS).toContain("classList.add('ek-js')");
  });
});
