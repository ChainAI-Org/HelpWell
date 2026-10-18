/**
 * Proactive items: what a support extension asks the widget to show, and the
 * record HelpWell keeps of it.
 *
 * The extension here is an in-process fake, so each test controls exactly
 * what it returns. What is under test is HelpWell's half: items are checked
 * one by one and anything unsafe dropped, what was shown is recorded against
 * the visitor, events reach the extension once and only for items that
 * visitor saw, a reply starts a conversation holding the message it answers,
 * and engagement items go through the same global cap as Settings ones.
 */

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeModel } from '../src/agent/fake-model.js';
import { blocksToMarkdown, cleanProactiveItems } from '../src/api/proactive.js';
import type {
  ProactiveContext,
  ProactiveItem,
  SupportExtension,
} from '../src/api/support-extension.js';
import { createHelpWellHandler, type HelpWellHandler, signIdentity } from '../src/api.js';
import type { Db } from '../src/db/client.js';
import { rowsOf } from '../src/db/rows.js';
import { SettingsStore } from '../src/settings/store.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { type Client, client } from './helpers/http.js';

const ANSWER = 'Open Billing, then Invoices.';
const SECRET = 'proactive-test-identity-secret';

let t: TestDb;
let db: Db;
let handler: HelpWellHandler;
let visitor: Client;
let model: FakeModel;
let items: ProactiveItem[];
let asked: ProactiveContext[];
let events: [string, string, { contactId: string | null; anonymousId: string }][];
let handled: { conversationId?: string | null; proactiveId?: string | null; message: string }[];

const chatItem = (overrides: Partial<ProactiveItem> = {}): ProactiveItem =>
  ({
    kind: 'chat',
    id: 'hello_1',
    sender: { name: 'Fern', isAgent: true },
    blocks: [{ type: 'text', markdown: 'Want a hand setting up invoices?' }],
    replyable: true,
    ...overrides,
  }) as ProactiveItem;

const modalItem = (id: string): ProactiveItem => ({
  kind: 'engagement',
  id,
  definition: {
    kind: 'modal',
    trigger: { type: 'delay', seconds: 3 },
    targeting: { audience: 'identified' },
    modal: { slides: [{ blocks: [{ type: 'text', markdown: '## Invoices are here' }] }] },
  },
});

function extension(overrides: Partial<SupportExtension> = {}): SupportExtension {
  return {
    afterReply: async () => {},
    async handleMessage(input) {
      handled.push({
        conversationId: input.conversationId,
        proactiveId: input.proactiveId,
        message: input.message,
      });
      return null;
    },
    handoff: async () => {},
    thread: async () => null,
    async proactive(context) {
      asked.push(context);
      return items;
    },
    async proactiveEvent(id, event, context) {
      events.push([id, event, context]);
    },
    ...overrides,
  };
}

function setup(support: SupportExtension | false = extension()): void {
  model = new FakeModel([{ text: ANSWER }]);
  handler = createHelpWellHandler({
    db,
    secureCookies: false,
    model,
    support,
    identitySecret: SECRET,
  });
  visitor = client(handler);
}

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function list(path = '/billing', anon = 'browser_abc123') {
  const response = await visitor.call(
    `/proactive?path=${encodeURIComponent(path)}&anon=${encodeURIComponent(anon)}`,
  );
  expect(response.status).toBe(200);
  return (await body<{ items: Record<string, unknown>[] }>(response)).items;
}

beforeEach(async () => {
  t = await freshDb();
  db = t.db;
  items = [];
  asked = [];
  events = [];
  handled = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});

describe('GET /proactive', () => {
  it('is empty without an extension that provides it, and the config says so', async () => {
    setup(false);
    expect(await list()).toEqual([]);
    const config = await body<{ support?: unknown }>(await visitor.call('/config'));
    expect(config.support).toBeUndefined();

    const { proactive: _p, proactiveEvent: _e, ...plain } = extension();
    setup(plain as SupportExtension);
    expect(await list()).toEqual([]);
    const withExtension = await body<{ support: { proactive: boolean } }>(
      await visitor.call('/config'),
    );
    expect(withExtension.support.proactive).toBe(false);
  });

  it('asks the extension who and where, and says proactive is on', async () => {
    setup();
    const config = await body<{ support: { proactive: boolean } }>(await visitor.call('/config'));
    expect(config.support.proactive).toBe(true);
    await list('/billing?tab=2', 'browser_abc123');
    expect(asked).toEqual([
      {
        contactId: null,
        anonymousId: 'browser_abc123',
        path: '/billing?tab=2',
        identified: false,
        device: null,
        referrer: '',
        utm: {},
        locale: '',
      },
    ]);
  });

  it('tells the extension the device, referrer, campaign and language', async () => {
    setup();
    const response = await visitor.call(
      `/proactive?path=${encodeURIComponent('/pricing')}&anon=browser_abc123&device=mobile` +
        `&referrer=${encodeURIComponent('https://news.example/post')}` +
        '&utm_source=Newsletter&utm_medium=email&utm_campaign=launch&utm_term=x&lang=pt-BR',
    );
    expect(response.status).toBe(200);
    // The fail-open wrapper drains its retry queue after a call succeeds, in
    // the background; let that query finish before the database closes.
    await db.execute(sql`SELECT 1`);
    expect(asked[0]).toMatchObject({
      path: '/pricing',
      device: 'mobile',
      referrer: 'https://news.example/post',
      utm: { source: 'newsletter', medium: 'email', campaign: 'launch' },
      locale: 'pt-BR',
    });
  });

  it('shows what is safe, in order, and gives an anonymous visitor a contact to record it on', async () => {
    items = [
      chatItem({
        blocks: [
          { type: 'text', markdown: 'Hi **there**' },
          { type: 'image', url: 'javascript:alert(1)', alt: 'x' },
          { type: 'image', url: 'https://cdn.example/pic.png', alt: 'Pic', link: 'javascript:x' },
          {
            type: 'buttons',
            buttons: [
              { label: 'Read', action: 'url', value: 'javascript:alert(1)' },
              { label: 'Chat', action: 'chat' },
            ],
          },
          { type: 'buttons', buttons: [{ label: 'Next', action: 'next' }] },
          {
            type: 'buttons',
            buttons: [
              { label: 'One', action: 'dismiss' },
              { label: 'Two', action: 'dismiss' },
              { label: 'Three', action: 'dismiss' },
              { label: 'Four', action: 'dismiss' },
            ],
          },
          { type: 'nonsense' },
        ],
        sender: { name: 'Maya', isAgent: false, avatarUrl: 'http://insecure.example/me.png' },
      } as Partial<ProactiveItem>),
      {
        kind: 'chat',
        id: 'bad id!',
        sender: { name: 'X', isAgent: true },
        blocks: [],
        replyable: true,
      },
      {
        kind: 'chat',
        id: 'empty',
        sender: { name: 'X', isAgent: true },
        blocks: [],
        replyable: true,
      },
      {
        kind: 'chat',
        id: 'nameless',
        sender: { name: ' ', isAgent: true },
        blocks: [{ type: 'text', markdown: 'x' }],
        replyable: false,
      },
      modalItem('modal_1'),
      { kind: 'engagement', id: 'broken', definition: { kind: 'carousel' } },
      { kind: 'mystery', id: 'x' } as never,
    ];
    setup();
    const shown = await list();
    expect(shown.map((i) => i.id)).toEqual(['hello_1', 'modal_1']);

    const chat = shown[0] as {
      sender: { name: string; avatarUrl: string | null };
      blocks: { type: string; link?: string; buttons?: { label: string }[] }[];
    };
    expect(chat.sender).toEqual({ name: 'Maya', avatarUrl: null, isAgent: false });
    expect(chat.blocks.map((b) => b.type)).toEqual(['text', 'image', 'buttons']);
    expect(chat.blocks[1]?.link).toBe('');
    expect(chat.blocks[2]?.buttons?.map((b) => b.label)).toEqual(['Chat']);

    // The engagement is in the widget's shape: no targeting, a namespaced id.
    const modal = shown[1] as { engagement: Record<string, unknown> };
    expect(modal.engagement.id).toBe('proactive:modal_1');
    expect(modal.engagement.kind).toBe('modal');
    expect(modal.engagement).not.toHaveProperty('targeting');

    expect(visitor.jar.some((c) => c.startsWith('hw_visitor='))).toBe(true);
    const recorded = rowsOf<{ item_id: string; kind: string }>(
      await db.execute(
        sql`SELECT item_id, kind FROM helpwell.proactive_deliveries ORDER BY item_id`,
      ),
    );
    expect(recorded).toEqual([
      { item_id: 'hello_1', kind: 'chat' },
      { item_id: 'modal_1', kind: 'engagement' },
    ]);
  });

  it('leaves engagements out when engage is switched off', async () => {
    await new SettingsStore(db).update({ engage: { enabled: false } });
    items = [chatItem(), modalItem('modal_1')];
    setup();
    expect((await list()).map((i) => i.id)).toEqual(['hello_1']);
  });

  it('reuses one answer for a few seconds', async () => {
    items = [chatItem()];
    setup();
    await visitor.call('/visitor', { body: {} });
    await list('/a');
    await list('/a');
    await list('/b');
    expect(asked.map((c) => c.path)).toEqual(['/a', '/b']);
  });

  it('shows nothing, and no error, when the extension fails', async () => {
    setup(
      extension({
        proactive: async () => {
          throw new Error('service down');
        },
      }),
    );
    expect(await list()).toEqual([]);
    expect(visitor.jar).toEqual([]);
  });

  it('does not show a dismissed message again', async () => {
    items = [chatItem()];
    setup();
    await list('/a');
    const dismissed = await visitor.call('/proactive/hello_1/events', {
      body: { event: 'dismissed' },
    });
    expect(dismissed.status).toBe(204);
    expect(await list('/b')).toEqual([]);
  });
});

describe('POST /proactive/:id/events', () => {
  beforeEach(() => {
    items = [chatItem()];
    setup();
  });

  it('reports each event once, with who it was', async () => {
    await list();
    for (let i = 0; i < 2; i++) {
      await visitor.call('/proactive/hello_1/events', {
        body: { event: 'seen', anon: 'browser_abc123' },
      });
    }
    await visitor.call('/proactive/hello_1/events', { body: { event: 'clicked' } });
    expect(events.map(([id, event]) => [id, event])).toEqual([
      ['hello_1', 'seen'],
      ['hello_1', 'clicked'],
    ]);
    expect(events[0]?.[2]).toEqual({
      contactId: expect.stringMatching(/^con_/),
      anonymousId: 'browser_abc123',
    });
  });

  it('refuses an item this visitor was never shown, and a bad event', async () => {
    await list();
    expect(
      (await visitor.call('/proactive/other_1/events', { body: { event: 'seen' } })).status,
    ).toBe(404);
    const stranger = client(handler);
    expect(
      (await stranger.call('/proactive/hello_1/events', { body: { event: 'seen' } })).status,
    ).toBe(404);
    expect(
      (await visitor.call('/proactive/hello_1/events', { body: { event: 'liked' } })).status,
    ).toBe(400);
    expect(events).toEqual([]);
  });
});

describe('replying to a chat message', () => {
  it("starts a conversation holding the agent's message, and tells the extension", async () => {
    items = [chatItem()];
    setup();
    await list();
    const response = await visitor.call('/chat', {
      body: { message: 'Yes please', proactiveId: 'hello_1', pageUrl: '/billing' },
    });
    expect(response.status).toBe(200);
    const reply = await body<{ conversationId: string; text: string }>(response);
    expect(reply.text).toBe(ANSWER);
    expect(handled).toEqual([
      { conversationId: reply.conversationId, proactiveId: 'hello_1', message: 'Yes please' },
    ]);

    // The AI saw the offer as its own earlier turn.
    const turns = model.requests[0]?.messages.map((m) => [m.role, m.content]);
    expect(turns).toContainEqual(['assistant', 'Want a hand setting up invoices?']);

    const thread = await body<{ messages: { role: string; body: string }[] }>(
      await visitor.call(`/conversations/${reply.conversationId}`),
    );
    expect(thread.messages.map((m) => [m.role, m.body])).toEqual([
      ['agent', 'Want a hand setting up invoices?'],
      ['customer', 'Yes please'],
      ['agent', ANSWER],
    ]);

    // Replied to once; the same id again is an ordinary new conversation.
    handled = [];
    const again = await body<{ conversationId: string }>(
      await visitor.call('/chat', { body: { message: 'Hello again', proactiveId: 'hello_1' } }),
    );
    expect(again.conversationId).not.toBe(reply.conversationId);
    expect(handled[0]?.proactiveId).toBeUndefined();
    expect(await list()).toEqual([]);
  });

  it("gives the AI a teammate's message as context rather than as its own words", async () => {
    items = [
      chatItem({
        sender: { name: 'Maya', isAgent: false },
        blocks: [{ type: 'text', markdown: 'Saw you on the pricing page. Any questions?' }],
      } as Partial<ProactiveItem>),
    ];
    setup();
    await list();
    const reply = await body<{ conversationId: string }>(
      await visitor.call('/chat', {
        body: { message: 'Is there a discount?', proactiveId: 'hello_1' },
      }),
    );
    const system = String(model.requests[0]?.messages[0]?.content ?? '');
    expect(system).toContain('from Maya on the team');
    expect(system).toContain('Saw you on the pricing page.');
    const thread = await body<{ messages: { role: string }[] }>(
      await visitor.call(`/conversations/${reply.conversationId}`),
    );
    expect(thread.messages.map((m) => m.role)).toEqual(['customer', 'agent']);
  });

  it('ignores a proactive id this visitor was not shown, or one that takes no reply', async () => {
    items = [chatItem({ id: 'no_reply', replyable: false } as Partial<ProactiveItem>)];
    setup();
    await list();
    await visitor.call('/chat', { body: { message: 'Hi', proactiveId: 'no_reply' } });
    await visitor.call('/chat', { body: { message: 'Hi', proactiveId: 'never_shown' } });
    expect(handled.map((h) => h.proactiveId)).toEqual([undefined, undefined]);
    expect(handled.map((h) => h.conversationId)).toEqual([null, null]);
  });
});

describe('engagement items', () => {
  async function claim(id: string, session = 'sess_1') {
    const response = await visitor.call(`/proactive/${id}/show`, {
      body: { session, url: '/billing' },
    });
    return {
      status: response.status,
      ...(await body<{ shown: boolean; reason?: string }>(response)),
    };
  }

  it('are shown once, recorded as impressions, and reported seen', async () => {
    items = [modalItem('modal_1')];
    setup();
    await list();
    expect(await claim('modal_1')).toEqual({ status: 200, shown: true });
    expect(await claim('modal_1')).toEqual({ status: 200, shown: false, reason: 'frequency' });
    const impressions = rowsOf<{ engagement_id: string; state: string }>(
      await db.execute(sql`SELECT engagement_id, state FROM helpwell.engage_impressions`),
    );
    expect(impressions).toEqual([{ engagement_id: 'proactive:modal_1', state: 'seen' }]);
    expect(events.map(([id, event]) => [id, event])).toEqual([['modal_1', 'seen']]);
    // Shown: not offered again.
    expect(await list('/other')).toEqual([]);
  });

  it('follow the global cap, which counts every engagement', async () => {
    await new SettingsStore(db).update({ engage: { limits: { perSession: 1 } } });
    items = [modalItem('modal_1'), modalItem('modal_2')];
    setup();
    await list();
    expect((await claim('modal_1')).shown).toBe(true);
    expect(await claim('modal_2')).toEqual({ status: 200, shown: false, reason: 'limit' });
    expect((await claim('modal_2', 'sess_2')).shown).toBe(true);
  });

  it('cannot be claimed by a visitor they were not shown to', async () => {
    items = [modalItem('modal_1')];
    setup();
    await list();
    const stranger = client(handler);
    expect((await stranger.call('/proactive/modal_1/show', { body: {} })).status).toBe(404);
    expect((await visitor.call('/proactive/hello_1/show', { body: {} })).status).toBe(404);
  });
});

describe('blocks as a message', () => {
  it('keeps text and media and leaves buttons for the bubble', () => {
    const [item] = cleanProactiveItems(
      [
        chatItem({
          blocks: [
            { type: 'text', markdown: 'Hello' },
            { type: 'image', url: 'https://cdn.example/a.png', alt: 'A [chart]' },
            {
              type: 'buttons',
              buttons: [{ label: 'Go', action: 'url', value: 'https://x.example' }],
            },
            { type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Tour' },
          ],
        } as Partial<ProactiveItem>),
      ],
      { engage: true },
    );
    expect(item?.kind).toBe('chat');
    expect(blocksToMarkdown(item?.kind === 'chat' ? item.blocks : [])).toBe(
      'Hello\n\n![A chart](https://cdn.example/a.png)\n\n![Tour](https://youtu.be/dQw4w9WgXcQ)',
    );
  });
});

/* ------------------------------------------------------------ WP10a additions */

async function identify(who: Record<string, unknown> = {}) {
  const token = await signIdentity(
    { id: 'user-7', email: 'ada@example.com', name: 'Ada Lovelace', plan: 'Pro', ...who },
    SECRET,
  );
  const response = await visitor.call('/identify', { body: { token } });
  expect(response.status).toBe(200);
}

describe('chat items, displayed and timed', () => {
  it('carry how they open and when they appear', async () => {
    items = [
      chatItem({ id: 'plain' } as Partial<ProactiveItem>),
      chatItem({
        id: 'panel',
        display: 'messenger',
        trigger: { type: 'scroll', percent: 60 },
      } as Partial<ProactiveItem>),
      chatItem({
        id: 'either',
        display: 'sideways',
        triggers: [{ type: 'exit' }, { type: 'delay', seconds: 8 }, { type: 'manual' }],
      } as unknown as Partial<ProactiveItem>),
      chatItem({
        id: 'unarmable',
        triggers: [{ type: 'click' }, { type: 'teleport' }],
      } as unknown as Partial<ProactiveItem>),
    ];
    setup();
    const shown = await list();
    expect(shown.map((i) => [i.id, i.display, i.triggers])).toEqual([
      ['plain', 'bubble', [{ type: 'load' }]],
      ['panel', 'messenger', [{ type: 'scroll', percent: 60 }]],
      ['either', 'bubble', [{ type: 'exit' }, { type: 'delay', seconds: 8 }]],
    ]);
  });

  it('opens the messenger once: seen, it is not offered again', async () => {
    items = [chatItem({ id: 'panel', display: 'messenger' } as Partial<ProactiveItem>), chatItem()];
    setup();
    await list();
    await visitor.call('/proactive/panel/events', { body: { event: 'seen' } });
    await visitor.call('/proactive/hello_1/events', { body: { event: 'seen' } });
    // A bubble that was only seen is still waiting by the launcher.
    expect((await list('/next')).map((i) => i.id)).toEqual(['hello_1']);
  });

  it('keeps quick replies for messages that take a reply, and tours the install has', async () => {
    await new SettingsStore(db).update({
      engage: {
        engagements: [
          {
            id: 'setup-tour',
            kind: 'tour',
            tour: { steps: [{ blocks: [{ type: 'text', markdown: 'Hi' }] }] },
          },
        ],
      },
    });
    const buttons = {
      type: 'buttons',
      buttons: [
        { label: 'Yes please', action: 'reply' },
        { label: 'Show me', action: 'tour', value: 'setup-tour' },
        { label: 'Other tour', action: 'tour', value: 'not-a-tour' },
      ],
    };
    items = [
      chatItem({
        id: 'asks',
        blocks: [{ type: 'text', markdown: 'Need a hand?' }, buttons],
      } as Partial<ProactiveItem>),
      chatItem({
        id: 'tells',
        replyable: false,
        blocks: [{ type: 'text', markdown: 'We shipped it.' }, buttons],
      } as Partial<ProactiveItem>),
    ];
    setup();
    const shown = (await list()) as unknown as {
      id: string;
      blocks: { type: string; buttons?: { label: string; action: string }[] }[];
    }[];
    const labels = (id: string) =>
      shown
        .find((i) => i.id === id)
        ?.blocks.find((b) => b.type === 'buttons')
        ?.buttons?.map((b) => b.label);
    expect(labels('asks')).toEqual(['Yes please', 'Show me']);
    expect(labels('tells')).toEqual(['Show me']);
  });
});

describe('personalisation', () => {
  const hello = () =>
    chatItem({
      blocks: [{ type: 'text', markdown: 'Hi {{first_name|there}}, how is {{plan}} going?' }],
    } as Partial<ProactiveItem>);

  it('sends the values its items use, for an identified visitor only', async () => {
    items = [hello()];
    setup();
    const anonymous = await body<{ fields?: unknown }>(
      await visitor.call('/proactive?path=/&anon=browser_abc123'),
    );
    expect(anonymous.fields).toBeUndefined();

    visitor.reset();
    await identify();
    const known = await body<{ fields?: unknown }>(
      await visitor.call('/proactive?path=/other&anon=browser_abc123'),
    );
    // Only the fields the items ask for, never the whole contact.
    expect(known.fields).toEqual({ first_name: 'Ada', plan: 'Pro' });
  });

  it('stores the opening message with the visitor name in it', async () => {
    items = [hello()];
    setup();
    await identify();
    await list();
    const reply = await body<{ conversationId: string }>(
      await visitor.call('/chat', { body: { message: 'Great', proactiveId: 'hello_1' } }),
    );
    const thread = await body<{ messages: { role: string; body: string }[] }>(
      await visitor.call(`/conversations/${reply.conversationId}`),
    );
    expect(thread.messages[0]?.body).toBe('Hi Ada, how is Pro going?');
  });

  it('fills Settings engagements too', async () => {
    await new SettingsStore(db).update({
      engage: {
        engagements: [
          {
            id: 'welcome',
            kind: 'modal',
            modal: {
              slides: [{ blocks: [{ type: 'text', markdown: 'Welcome, {{name|friend}}' }] }],
            },
          },
        ],
      },
    });
    setup();
    await identify();
    const result = await body<{ items: unknown[]; fields?: unknown }>(
      await visitor.call('/engage?path=/'),
    );
    expect(result.items).toHaveLength(1);
    expect(result.fields).toEqual({ name: 'Ada Lovelace' });
  });
});

describe('one engage controller for both', () => {
  async function engageShow(id: string, extra: Record<string, unknown> = {}) {
    const response = await visitor.call(`/engage/${encodeURIComponent(id)}/show`, {
      body: { session: 'sess_1', url: '/', ...extra },
    });
    return {
      status: response.status,
      ...(await body<{ shown?: boolean; reason?: string }>(response)),
    };
  }

  it('claims and reports an extension engagement through the engage routes', async () => {
    items = [modalItem('modal_1')];
    setup();
    await list();
    expect(await engageShow('proactive:modal_1', { anon: 'browser_abc123' })).toEqual({
      status: 200,
      shown: true,
    });
    expect(events.map(([id, event]) => [id, event])).toEqual([['modal_1', 'seen']]);
    expect(events[0]?.[2].anonymousId).toBe('browser_abc123');

    for (let i = 0; i < 2; i++) {
      await visitor.call(`/engage/${encodeURIComponent('proactive:modal_1')}/impression`, {
        body: { state: 'dismissed', anon: 'browser_abc123' },
      });
    }
    expect(events.map(([, event]) => event)).toEqual(['seen', 'dismissed']);
    // Another visitor cannot claim it.
    const stranger = client(handler);
    const refused = await stranger.call(`/engage/${encodeURIComponent('proactive:modal_1')}/show`, {
      body: {},
    });
    expect(refused.status).toBe(404);
  });

  it('counts the extension engagements towards the cap in both directions', async () => {
    await new SettingsStore(db).update({
      engage: {
        limits: { perSession: 1 },
        engagements: [
          {
            id: 'mine',
            kind: 'modal',
            modal: { slides: [{ blocks: [{ type: 'text', markdown: 'Hi' }] }] },
          },
        ],
      },
    });
    items = [
      modalItem('theirs'),
      {
        kind: 'engagement',
        id: 'spot',
        definition: {
          kind: 'hotspot',
          hotspot: { target: '#x', blocks: [{ type: 'text', markdown: 'x' }] },
        },
      },
    ];
    setup();
    await list();
    // A hotspot does not interrupt, so it does not count.
    expect((await engageShow('proactive:spot')).shown).toBe(true);
    expect((await engageShow('proactive:theirs')).shown).toBe(true);
    // A Settings engagement now meets the cap the extension used up.
    expect(await engageShow('mine')).toEqual({ status: 200, shown: false, reason: 'limit' });
  });

  it('resumes the extension tour after a reload, until it is finished', async () => {
    items = [
      {
        kind: 'engagement',
        id: 'tour_1',
        definition: {
          kind: 'tour',
          tour: {
            steps: [
              { blocks: [{ type: 'text', markdown: 'One' }] },
              { blocks: [{ type: 'text', markdown: 'Two' }] },
            ],
          },
        },
      },
    ];
    setup();
    await list();
    const resume = async () =>
      (
        await body<{ items: { id: string }[] }>(
          await visitor.call(
            `/engage?path=/&resume=${encodeURIComponent('proactive:tour_1,proactive:nope')}`,
          ),
        )
      ).items.map((i) => i.id);

    // Not started yet: nothing to resume.
    expect(await resume()).toEqual([]);
    expect((await engageShow('proactive:tour_1')).shown).toBe(true);
    expect(await resume()).toEqual(['proactive:tour_1']);
    // A later step is not a new interruption.
    expect((await engageShow('proactive:tour_1', { step: 2 })).shown).toBe(true);

    await visitor.call(`/engage/${encodeURIComponent('proactive:tour_1')}/impression`, {
      body: { state: 'completed' },
    });
    expect(await resume()).toEqual([]);
  });
});
