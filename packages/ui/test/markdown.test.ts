import { describe, expect, it } from 'vitest';
import { decodeEntities, renderMarkdown, slugify, withoutRepeatedTitle } from '../src/index.js';

const render = (source: string) => renderMarkdown(source).html;

describe('escaping', () => {
  it('turns HTML in the source into text', () => {
    expect(render('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
    expect(render('<img src=x onerror=alert(1)>')).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('refuses a javascript: link and image, leaving the text', () => {
    expect(render('[click](javascript:alert(1))')).toBe('<p>click</p>');
    expect(render('![pic](javascript:alert(1))')).toBe('<p>pic</p>');
    expect(render('[click](JAVASCRIPT:alert(1))')).not.toContain('href');
  });
});

describe('inline passes', () => {
  it('keeps a link inside a code span literal', () => {
    expect(render('Use `[x](y)` here')).toBe('<p>Use <code>[x](y)</code> here</p>');
  });

  it('shows code that looks like a tag as its literal text, escaped', () => {
    expect(render('Put the snippet in the `<head>` of every page.')).toBe(
      '<p>Put the snippet in the <code>&lt;head&gt;</code> of every page.</p>',
    );
    expect(render('Close it with `</body>` or `<br/>`.')).toBe(
      '<p>Close it with <code>&lt;/body&gt;</code> or <code>&lt;br/&gt;</code>.</p>',
    );
    // In a list, a table and a heading too, and on the panel surface the widget uses.
    for (const source of [
      '- In `<head>`',
      '| Where |\n| --- |\n| `<head>` |',
      '## The `<head>` tag',
    ]) {
      for (const surface of ['page', 'panel'] as const) {
        expect(renderMarkdown(source, { surface }).html).toContain('<code>&lt;head&gt;</code>');
      }
    }
    expect(render('```html\n<head>\n  <script src="w.js"></script>\n</head>\n```')).toBe(
      '<pre><code class="language-html">&lt;head&gt;\n  &lt;script src=&quot;w.js&quot;&gt;&lt;/script&gt;\n&lt;/head&gt;</code></pre>',
    );
  });

  it('keeps emphasis inside a code span literal', () => {
    expect(render('Type `**a**`')).toBe('<p>Type <code>**a**</code></p>');
    expect(render('Type `_a_ and *b*`')).toBe('<p>Type <code>_a_ and *b*</code></p>');
  });

  it('does not run emphasis inside an href', () => {
    const out = render('see [x](https://a.com/**b**) and **c**');
    expect(out).toContain(
      '<a href="https://a.com/**b**" target="_blank" rel="noopener noreferrer">x</a>',
    );
    expect(out).toContain('<strong>c</strong>');
    expect(out).not.toContain('href="https://a.com/<strong>');
  });

  it('allows one level of balanced parentheses in a URL', () => {
    expect(render('[Foo](https://en.wikipedia.org/wiki/Foo_(bar))')).toContain(
      '<a href="https://en.wikipedia.org/wiki/Foo_(bar)" target="_blank" rel="noopener noreferrer">Foo</a>',
    );
    expect(render('![alt](/img/(1).png) tail')).toContain(
      '<img src="/img/(1).png" alt="alt" loading="lazy"> tail',
    );
  });

  it('renders emphasis inside a link label, and a code span inside a label', () => {
    expect(render('[**bold** link](/x)')).toBe(
      '<p><a href="/x"><strong>bold</strong> link</a></p>',
    );
    expect(render('[`code`](/x)')).toBe('<p><a href="/x"><code>code</code></a></p>');
  });

  it('treats a protocol-relative link as external', () => {
    expect(render('[x](//evil.example/)')).toBe(
      '<p><a href="//evil.example/" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
    expect(render('[x](/\\evil.example/)')).toContain('rel="noopener noreferrer"');
  });

  it('keeps a same-site link internal', () => {
    expect(render('[x](/help/a)')).toBe('<p><a href="/help/a">x</a></p>');
    expect(render('[x](#section)')).toBe('<p><a href="#section">x</a></p>');
  });

  it('renders strong and em', () => {
    expect(render('a **b** *c* _d_')).toBe('<p>a <strong>b</strong> <em>c</em> <em>d</em></p>');
  });
});

describe('headings', () => {
  it('reports plain text, not HTML, and escapes once in the body', () => {
    const { html, headings } = renderMarkdown('## Tips & tricks');
    expect(headings).toEqual([{ depth: 2, text: 'Tips & tricks', id: 'tips-tricks' }]);
    expect(html).toContain('>Tips &amp; tricks</h2>');
    expect(html).not.toContain('&amp;amp;');
  });

  it('decodes entities before slugifying, so ids match the indexer', () => {
    expect(renderMarkdown("## What's new").headings[0]?.id).toBe('what-s-new');
    expect(renderMarkdown('## Q "quoted"').headings[0]?.id).toBe('q-quoted');
    expect(renderMarkdown('## A <b> tag').headings[0]?.id).toBe('a-b-tag');
  });

  it('strips inline markup from the text and keeps it in the body', () => {
    const { html, headings } = renderMarkdown('### **Bold** `code` [link](/x) ##');
    expect(headings[0]).toEqual({ depth: 3, text: 'Bold code link', id: 'bold-code-link-x' });
    expect(html).toContain('<strong>Bold</strong> <code>code</code> <a href="/x">link</a></h3>');
  });

  it('suffixes duplicates the way the indexer does', () => {
    const ids = renderMarkdown('## Setup\n\n## Setup\n\n## Setup').headings.map((h) => h.id);
    expect(ids).toEqual(['setup', 'setup-1', 'setup-2']);
  });

  it('folds accents and gives an empty heading a stable id', () => {
    expect(renderMarkdown('## Café über').headings[0]?.id).toBe('cafe-uber');
    expect(renderMarkdown('## ***').headings[0]?.id).toBe('section');
  });

  it('puts an anchor on the heading', () => {
    expect(render('# Top')).toBe(
      '<h1 id="top"><a class="hc-anchor" href="#top" aria-label="Link to this section">#</a>Top</h1>',
    );
  });
});

describe('slugify', () => {
  it('follows the indexer: lower case, NFKD, non-alphanumerics to dashes', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  Ünïcode  ')).toBe('unicode');
    expect(slugify('What&#39;s new')).toBe('what-s-new');
    expect(slugify('Tips &amp; tricks')).toBe('tips-tricks');
    expect(slugify('')).toBe('section');
  });
});

describe('withoutRepeatedTitle', () => {
  it('drops an opening H1 that only repeats the title', () => {
    const body = '\n# Attach and match receipts\n\nForward the email.\n\n## Missing receipts\n';
    expect(withoutRepeatedTitle(body, 'Attach and match receipts')).toBe(
      'Forward the email.\n\n## Missing receipts\n',
    );
  });

  it('reads the heading as a reader would: case, emphasis, entities and closing hashes', () => {
    expect(withoutRepeatedTitle('# **Fees &amp; limits** #\nText', 'fees & limits')).toBe('Text');
    expect(withoutRepeatedTitle('# Only the title', 'Only the title')).toBe('');
  });

  it('keeps an opening heading that says something else, and every later H1', () => {
    expect(withoutRepeatedTitle('# Before you start\n\nText', 'Invite your team')).toBe(
      '# Before you start\n\nText',
    );
    expect(withoutRepeatedTitle('Intro\n\n# Invite your team\n', 'Invite your team')).toBe(
      'Intro\n\n# Invite your team\n',
    );
    expect(withoutRepeatedTitle('## Invite your team\n', 'Invite your team')).toBe(
      '## Invite your team\n',
    );
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities, ampersand last', () => {
    expect(decodeEntities('&lt;a&gt; &quot;b&quot; &#39;c&#39; &#x41; &amp;lt;')).toBe(
      '<a> "b" \'c\' A &lt;',
    );
    expect(decodeEntities('&#99999999;')).toBe('&#99999999;');
  });
});

describe('blocks', () => {
  it('renders fenced code without touching its contents', () => {
    expect(render('```js\nconst a = "<b>";\n**x**\n```')).toBe(
      '<pre><code class="language-js">const a = &quot;&lt;b&gt;&quot;;\n**x**</code></pre>',
    );
  });

  it('accepts a fence indented by up to three spaces, and keeps the body as written', () => {
    expect(render('  ```js\n  const a = 1;\n  ```\n\nafter')).toBe(
      '<pre><code class="language-js">  const a = 1;</code></pre>\n<p>after</p>',
    );
    expect(render('   ```\nx\n   ```')).toBe('<pre><code>x</code></pre>');
    // Four spaces is indented code in CommonMark, not a fence; we leave it as text.
    expect(render('    ```\nnot a fence')).not.toContain('<pre>');
  });

  it('renders a table inside a scrolling wrapper', () => {
    const out = render('| a | b |\n|---|---|\n| 1 | **2** |');
    expect(out).toContain('<div class="hc-tablewrap"><table>');
    expect(out).toContain('<th>a</th><th>b</th>');
    expect(out).toContain('<td>1</td><td><strong>2</strong></td>');
  });

  it('renders lists, quotes and rules', () => {
    expect(render('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(render('1. a\n2) b')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(render('> quoted\n> text')).toBe('<blockquote><p>quoted text</p></blockquote>');
    expect(render('---')).toBe('<hr>');
  });

  it('joins paragraph lines and separates blocks', () => {
    expect(render('one\ntwo\n\nthree')).toBe('<p>one two</p>\n<p>three</p>');
  });
});

describe('numbered steps with images between them', () => {
  const source = [
    '1. Click on your Profile',
    '',
    '![](https://example.com/a.jpg)',
    '',
    '2. Click on **Add Status**:',
    '',
    '![](https://example.com/b.jpg)',
    '',
    '3. Type in your status',
  ].join('\n');

  it('keeps one list with the images inside their steps', () => {
    const html = render(source);
    expect(html.match(/<ol/g)).toHaveLength(1);
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).toContain('<li>Click on your Profile<p><img src="https://example.com/a.jpg"');
    expect(html).toContain('<strong>Add Status</strong>:<p><img');
  });

  it('keeps the start number when a list begins part way', () => {
    expect(render('3. Three\n4. Four')).toBe('<ol start="3"><li>Three</li><li>Four</li></ol>');
    expect(render('1. One\n2. Two')).toBe('<ol><li>One</li><li>Two</li></ol>');
  });

  it('folds indented paragraphs into the step', () => {
    expect(render('1. One\n\n   More about one\n\n2. Two')).toBe(
      '<ol><li>One<p>More about one</p></li><li>Two</li></ol>',
    );
  });

  it('still ends the list at an ordinary paragraph', () => {
    expect(render('1. One\n\nAfter')).toBe('<ol><li>One</li></ol>\n<p>After</p>');
  });
});
