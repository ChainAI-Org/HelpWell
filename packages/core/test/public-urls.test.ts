/**
 * Every image URL the API sends the widget is absolute, so it loads on the
 * customer's site: articles (indexed as paths on the API, or kept relative
 * to the article), answers, the Home tab's cards, changelog entries,
 * engagements, forms, and the avatar and launcher images. Links, code and
 * absolute URLs are left alone.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import {
  absoluteMarkdownMedia,
  absoluteMediaUrl,
  type PublicBase,
  publicBaseFor,
} from '../src/api/public-urls.js';
import { createHelpWellHandler, type HelpWellHandler } from '../src/api.js';
import { createMemoryContentSource } from '../src/content/source.js';
import { createChangelogEntry } from '../src/repos/changelog.js';
import { createForm } from '../src/repos/forms.js';
import { syncContent } from '../src/search/sync.js';
import { SettingsStore } from '../src/settings/store.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { client } from './helpers/http.js';

const BASE: PublicBase = { origin: 'https://app.acme.com', api: 'https://app.acme.com/api/hw' };

describe('making one URL absolute', () => {
  it('gives a root path the origin and a docs path its served URL, and leaves the rest', () => {
    expect(absoluteMediaUrl('/api/hw/media/a.png', BASE)).toBe(
      'https://app.acme.com/api/hw/media/a.png',
    );
    expect(absoluteMediaUrl('_media/3f9a.png', BASE)).toBe(
      'https://app.acme.com/api/hw/media/_media/3f9a.png',
    );
    expect(absoluteMediaUrl('_screenshots/billing.png', BASE)).toBe(
      'https://app.acme.com/api/hw/screenshots/billing.png',
    );
    expect(absoluteMediaUrl('../_screenshots/billing.png', BASE, 'billing/invoices.md')).toBe(
      'https://app.acme.com/api/hw/screenshots/billing.png',
    );
    for (const kept of [
      'https://cdn.acme.com/a.png',
      '//cdn.acme.com/a.png',
      'data:image/png;base64,AAAA',
      '#top',
      '',
      'notes.txt',
    ]) {
      expect(absoluteMediaUrl(kept, BASE)).toBe(kept);
    }
  });

  it('rewrites images and videos in Markdown, never links or code', () => {
    const markdown = [
      '![Shot](/api/hw/screenshots/a.png) and [the guide](/help/guide)',
      '![Relative](../_media/b.png)',
      '`![literal](/api/hw/media/c.png)`',
      '```',
      '![fenced](/api/hw/media/d.png)',
      '```',
      '![Demo](/api/hw/media/demo.mp4)',
      '![Remote](https://cdn.acme.com/e.png)',
    ].join('\n');
    expect(absoluteMarkdownMedia(markdown, BASE, 'billing/invoices.md')).toBe(
      [
        '![Shot](https://app.acme.com/api/hw/screenshots/a.png) and [the guide](/help/guide)',
        '![Relative](https://app.acme.com/api/hw/media/_media/b.png)',
        '`![literal](/api/hw/media/c.png)`',
        '```',
        '![fenced](/api/hw/media/d.png)',
        '```',
        '![Demo](https://app.acme.com/api/hw/media/demo.mp4)',
        '![Remote](https://cdn.acme.com/e.png)',
      ].join('\n'),
    );
    expect(absoluteMarkdownMedia('No pictures.', BASE)).toBe('No pictures.');
    expect(absoluteMarkdownMedia('![a](/x.png)', null)).toBe('![a](/x.png)');
  });

  it('takes the base from publicUrl, or from the request and the mount path', () => {
    const request = new Request('http://10.0.0.5:3000/api/hw/config');
    expect(publicBaseFor({ request, config: { db: null as never, basePath: '/api/hw' } })).toEqual({
      origin: 'http://10.0.0.5:3000',
      api: 'http://10.0.0.5:3000/api/hw',
    });
    expect(
      publicBaseFor({
        request,
        config: { db: null as never, publicUrl: 'https://app.acme.com/api/hw/' },
      }),
    ).toEqual(BASE);
    // A publicUrl that is not an http(s) URL is ignored rather than trusted.
    expect(
      publicBaseFor({ request, config: { db: null as never, publicUrl: 'javascript:alert(1)' } }),
    ).toEqual({ origin: 'http://10.0.0.5:3000', api: 'http://10.0.0.5:3000/api/helpwell' });
  });
});

describe('what the API sends the widget', () => {
  let t: TestDb;
  let handler: HelpWellHandler;
  const ORIGIN = 'https://help.acme-hosted.example';

  const PNG = new Uint8Array([137, 80, 78, 71]);
  const files = () =>
    createMemoryContentSource({
      'billing/invoices.md':
        '---\ntitle: Exporting invoices\n---\n\nOpen Billing, then Export.\n\n![The export button](../_screenshots/export.png)\n\nSee [refunds](/help/billing/refunds).\n',
      '_screenshots/export.png': PNG,
    });

  function make(options: { publicUrl?: string; reply?: string } = {}) {
    handler = createHelpWellHandler({
      db: t.db,
      model: new FakeModel(() => ({
        text:
          options.reply ??
          'Press Export. ![The export button](/api/helpwell/screenshots/export.png)',
      })),
      env: {},
      ...(options.publicUrl ? { publicUrl: options.publicUrl } : {}),
    });
    return client(handler, { base: `${ORIGIN}/api/helpwell` });
  }

  beforeEach(async () => {
    t = await freshDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it('sends an indexed article with absolute image URLs, links untouched', async () => {
    await syncContent(t.db, files());
    const browser = make();
    const { article } = (await (await browser.call('/articles/billing/invoices')).json()) as {
      article: Record<string, unknown> & { body: string };
    };
    expect(article.body).toContain(
      `![The export button](${ORIGIN}/api/helpwell/screenshots/export.png)`,
    );
    expect(article.body).toContain('[refunds](/help/billing/refunds)');
    // The file's path was only for resolving; it is not sent.
    expect(article).not.toHaveProperty('path');
  });

  it('resolves an image kept relative to its article, against publicUrl when set', async () => {
    await syncContent(t.db, files(), { media: false });
    const browser = make({ publicUrl: 'https://app.acme.com/api/hw' });
    const { article } = (await (await browser.call('/articles/billing/invoices')).json()) as {
      article: { body: string };
    };
    expect(article.body).toContain(
      '![The export button](https://app.acme.com/api/hw/screenshots/export.png)',
    );
  });

  it('makes the images in an answer absolute, in the reply and in the thread', async () => {
    const browser = make();
    const reply = (await (
      await browser.call('/chat', { body: { message: 'How do I export? ![x](/mine.png)' } })
    ).json()) as { text: string; conversationId: string };
    expect(reply.text).toBe(
      `Press Export. ![The export button](${ORIGIN}/api/helpwell/screenshots/export.png)`,
    );

    const thread = (await (
      await browser.call(`/conversations/${reply.conversationId}`)
    ).json()) as {
      messages: { role: string; body: string }[];
    };
    const byRole = Object.fromEntries(thread.messages.map((m) => [m.role, m.body]));
    expect(byRole.agent).toBe(reply.text);
    // What the visitor typed is theirs, as typed.
    expect(byRole.customer).toBe('How do I export? ![x](/mine.png)');
  });

  it('makes the avatar, the launcher, the pattern and the Home cards absolute', async () => {
    await new SettingsStore(t.db).update({
      agent: { avatarUrl: '/api/helpwell/media/_media/fern.png' },
      widget: {
        appearance: {
          launcherIconUrl: '_media/launcher.png',
          patternImageUrl: 'https://cdn.acme.com/pattern.png',
        },
        home: {
          blocks: [
            { type: 'search' },
            {
              type: 'card',
              title: 'New: PDF export',
              body: 'Try it. ![PDF](/api/helpwell/media/_media/pdf.png)',
              image: '/api/helpwell/media/_media/card.png',
              cta: { label: 'Read more', url: '/help/billing/invoices' },
            },
          ],
        },
      },
    });
    const config = (await (await make().call('/config')).json()) as {
      agent: { avatarUrl: string };
      widget: {
        appearance: { launcherIconUrl: string; patternImageUrl: string };
        home: { blocks: Record<string, unknown>[] };
      };
    };
    const api = `${ORIGIN}/api/helpwell`;
    expect(config.agent.avatarUrl).toBe(`${api}/media/_media/fern.png`);
    expect(config.widget.appearance.launcherIconUrl).toBe(`${api}/media/_media/launcher.png`);
    expect(config.widget.appearance.patternImageUrl).toBe('https://cdn.acme.com/pattern.png');
    expect(config.widget.home.blocks[1]).toMatchObject({
      image: `${api}/media/_media/card.png`,
      body: `Try it. ![PDF](${api}/media/_media/pdf.png)`,
      // A link is where the host said it goes.
      cta: { url: '/help/billing/invoices' },
    });
    expect(config.widget.home.blocks[0]).toEqual({ type: 'search' });
  });

  it('sends the Home greeting to the widget as set, and empty when it is not', async () => {
    const plain = (await (await make().call('/config')).json()) as {
      widget: { greeting: { title: string; subtitle: string } };
    };
    expect(plain.widget.greeting).toEqual({ title: '', subtitle: '' });
    await new SettingsStore(t.db).update({
      widget: { greeting: { title: 'Welcome', subtitle: 'Ask about {product}.' } },
    });
    const set = (await (await make().call('/config')).json()) as typeof plain;
    expect(set.widget.greeting).toEqual({ title: 'Welcome', subtitle: 'Ask about {product}.' });
    await new SettingsStore(t.db).update({ widget: { greeting: { title: '', subtitle: '' } } });
  });

  it('makes changelog covers and images absolute', async () => {
    const id = await createChangelogEntry(t.db, {
      title: 'PDF export',
      body: '![Export](/api/helpwell/media/_media/export.png)',
      coverUrl: '/api/helpwell/media/_media/cover.png',
      status: 'published',
    });
    const browser = make();
    const feed = (await (await browser.call('/changelog')).json()) as {
      items: { coverUrl: string }[];
    };
    expect(feed.items[0]?.coverUrl).toBe(`${ORIGIN}/api/helpwell/media/_media/cover.png`);
    const entry = (await (await browser.call(`/changelog/${id}`)).json()) as {
      body: string;
      coverUrl: string;
    };
    expect(entry.body).toBe(`![Export](${ORIGIN}/api/helpwell/media/_media/export.png)`);
    expect(entry.coverUrl).toBe(`${ORIGIN}/api/helpwell/media/_media/cover.png`);
  });

  it('makes an engagement’s pictures and videos absolute, and leaves where a click goes', async () => {
    await new SettingsStore(t.db).update({
      engage: {
        enabled: true,
        engagements: [
          {
            id: 'announce',
            kind: 'modal',
            modal: {
              slides: [
                {
                  blocks: [
                    {
                      type: 'image',
                      url: '/api/helpwell/media/_media/promo.png',
                      alt: 'The new export',
                      link: '/pricing',
                    },
                    { type: 'text', markdown: 'Now in PDF. ![PDF](_media/pdf.png)' },
                    { type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' },
                  ],
                },
              ],
            },
          },
        ],
      },
    });
    const { item } = (await (await make().call('/engage/announce')).json()) as {
      item: { modal: { slides: { blocks: Record<string, string>[] }[] } };
    };
    const [image, text, video] = item.modal.slides[0]?.blocks ?? [];
    expect(image).toMatchObject({
      url: `${ORIGIN}/api/helpwell/media/_media/promo.png`,
      link: '/pricing',
    });
    expect(text?.markdown).toBe(`Now in PDF. ![PDF](${ORIGIN}/api/helpwell/media/_media/pdf.png)`);
    expect(video?.url).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('makes a form’s picture absolute', async () => {
    await createForm(t.db, {
      id: 'news',
      name: 'Newsletter',
      enabled: true,
      definition: {
        layout: {
          image: { url: '/api/helpwell/media/_media/news.png', alt: '' },
          imagePosition: 'top',
        },
      },
    });
    const response = await make().call('/forms/news/render', {
      body: { placement: 'inline', page: { path: '/blog', url: 'https://acme.test/blog' } },
    });
    const { form } = (await response.json()) as { form: { layout: { image: { url: string } } } };
    expect(form.layout.image.url).toBe(`${ORIGIN}/api/helpwell/media/_media/news.png`);
  });
});
