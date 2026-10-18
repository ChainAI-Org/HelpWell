/**
 * How an answer reads in the chat: rendered Markdown with no blank lines the
 * author did not write, what the visitor typed with every line break it had,
 * and code shown as the characters it is, even when it looks like a tag.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { renderRich } from '../src/media.js';
import { widgetStyles } from '../src/styles.js';
import { flush, type Mounted, mountWidget, unmount } from './helpers/mount.js';

afterEach(() => {
  unmount();
});

const ANSWER = [
  'You can export three things:',
  '',
  '- Invoices',
  '- Customers',
  '- Payments',
  '',
  'Put the snippet in the `<head>` of every page:',
  '',
  '```html',
  '<script src="https://help.acme.com/widget.js"></script>',
  '```',
].join('\n');

async function ask(question: string, answer: string): Promise<Mounted> {
  const w = await mountWidget({
    routes: {
      'POST /chat': {
        conversationId: 'cnv_1',
        messageId: 'msg_2',
        text: answer,
        citations: [],
        unresolved: false,
        degraded: false,
      },
    },
  });
  w.widget.open({ name: 'chat', conversationId: null });
  await flush();
  await w.send(question);
  return w;
}

const css = widgetStyles({
  accent: '#7A3BEB',
  font: 'Plus Jakarta Sans',
  radius: 24,
  bubbleStyle: 'rounded',
});

/** The declarations of the first rule for exactly this selector. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

describe('an answer in the chat', () => {
  it('is drawn as rendered blocks that do not keep the newlines between them', async () => {
    const w = await ask('What can I export?', ANSWER);
    const bubble = w.$('.bubble--agent');

    expect(bubble?.classList.contains('bubble--rich')).toBe(true);
    expect(bubble?.querySelectorAll('li')).toHaveLength(3);
    // The renderer puts a newline between blocks; kept, each is a blank line.
    expect(bubble?.innerHTML).toContain('</p>\n<ul>');
    expect(rule('.bubble')).toContain('white-space: pre-wrap');
    expect(rule('.bubble--rich')).toContain('white-space: normal');
    // Lists sit as close as paragraphs, not a browser default em apart.
    expect(css).toMatch(/\.bubble ul, \.bubble ol \{ margin: 0 0 8px;/);
    // A code block keeps its own line breaks inside a rich bubble.
    expect(css).toMatch(/\.bubble pre \{[^}]*white-space: pre;/);
  });

  it('keeps every line break of what the visitor typed', async () => {
    const w = await ask('First line\nsecond line\n\nafter a gap', 'Thanks.');
    const mine = w.$('.bubble--customer');

    expect(mine?.textContent).toBe('First line\nsecond line\n\nafter a gap');
    expect(mine?.classList.contains('bubble--rich')).toBe(false);
  });

  it('shows code that looks like a tag as that text', async () => {
    const w = await ask('Where does the snippet go?', ANSWER);
    const bubble = w.$('.bubble--agent');

    expect(bubble?.querySelector('p code')?.textContent).toBe('<head>');
    expect(bubble?.textContent).toContain('Put the snippet in the <head> of every page:');
    expect(bubble?.querySelector('pre code')?.textContent).toBe(
      '<script src="https://help.acme.com/widget.js"></script>',
    );
    // Text, not markup: nothing turned into an element.
    expect(bubble?.querySelector('head, script')).toBeNull();
  });
});

describe('an article in the widget', () => {
  it('shows code that looks like a tag as that text too', () => {
    const holder = document.createElement('div');
    holder.appendChild(
      renderRich('Add `<meta name="x">` inside `<head>`.\n\n- Close with `</body>`'),
    );
    const codes = [...holder.querySelectorAll('code')].map((code) => code.textContent);
    expect(codes).toEqual(['<meta name="x">', '<head>', '</body>']);
    expect(holder.querySelector('meta, head, body')).toBeNull();
  });
});
