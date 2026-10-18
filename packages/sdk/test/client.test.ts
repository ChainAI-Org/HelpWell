import { beforeEach, describe, expect, it } from 'vitest';
import { HelpWellApiError, HelpWellClient } from '../src/index.js';
import type { Recorder } from './helpers/recorder.js';
import { BASE, recorder } from './helpers/recorder.js';

const SECRET = 'a-test-identity-secret-long-enough';

let http: Recorder;
let client: HelpWellClient;

beforeEach(() => {
  http = recorder();
  client = new HelpWellClient({ baseUrl: BASE, identitySecret: SECRET, fetch: http.fetch });
});

describe('construction', () => {
  it('refuses to be built without a base url', () => {
    expect(() => new HelpWellClient({ baseUrl: '' })).toThrow(HelpWellApiError);
  });

  it('tolerates a base url with a trailing slash rather than doubling it', async () => {
    const trailing = new HelpWellClient({ baseUrl: `${BASE}///`, fetch: http.fetch });
    await trailing.config();
    expect(http.only().url.pathname).toBe('/api/helpwell/config');
  });
});

describe('the cookie jar', () => {
  it('sends no cookie until the server has set one', async () => {
    await client.config();
    expect(http.only().headers.cookie).toBeUndefined();
  });

  it('sends back the visitor cookie the server set, so two votes reach the same contact', async () => {
    http.reply({ voted: true, votesCount: 1 }, 200, {
      'set-cookie': 'hw_visitor=con_abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000',
    });
    http.reply({ voted: false, votesCount: 0 });

    const first = await client.vote('rm_1');
    const second = await client.vote('rm_1');

    expect(first.voted).toBe(true);
    expect(second.voted).toBe(false);
    expect(http.calls[0]?.headers.cookie).toBeUndefined();
    expect(http.calls[1]?.headers.cookie).toBe('hw_visitor=con_abc');
  });

  it('keeps only the name and value, never the attributes', async () => {
    http.reply({}, 200, { 'set-cookie': 'hw_visitor=con_1; Path=/; Secure; HttpOnly' });
    await client.config();
    await client.config();
    expect(http.calls[1]?.headers.cookie).toBe('hw_visitor=con_1');
  });

  it('remembers every cookie on a response, not just the first', async () => {
    const headers = new Headers();
    headers.append('set-cookie', 'a=1; Path=/');
    headers.append('set-cookie', 'b=2; Path=/');
    const twoCookies: typeof globalThis.fetch = async () =>
      new Response('{}', { status: 200, headers });
    const calls: Request[] = [];
    const spy: typeof globalThis.fetch = async (input, init) => {
      calls.push(new Request(input, init));
      return twoCookies(input, init);
    };

    const c = new HelpWellClient({ baseUrl: BASE, fetch: spy });
    await c.config();
    await c.config();
    expect(calls[1]?.headers.get('cookie')).toBe('a=1; b=2');
  });

  it('replaces a cookie the server sets again rather than sending both', async () => {
    http.reply({}, 200, { 'set-cookie': 'hw_visitor=old; Path=/' });
    http.reply({}, 200, { 'set-cookie': 'hw_visitor=new; Path=/' });
    await client.config();
    await client.config();
    await client.config();
    expect(http.calls[2]?.headers.cookie).toBe('hw_visitor=new');
  });

  it('drops a cookie the server expires with Max-Age=0', async () => {
    http.reply({}, 200, { 'set-cookie': 'hw_visitor=con_1; Path=/' });
    http.reply({}, 200, { 'set-cookie': 'hw_visitor=; Path=/; Max-Age=0' });
    await client.config();
    await client.config();
    await client.config();
    expect(http.calls[2]?.headers.cookie).toBeUndefined();
  });

  it('keeps a cookie set on an error response, which is how a 403 can still hand out a visitor id', async () => {
    http.reply({ error: { code: 'forbidden', message: 'Sign in.' } }, 403, {
      'set-cookie': 'hw_visitor=con_1; Path=/',
    });
    await expect(client.submitIdea('x')).rejects.toThrow(HelpWellApiError);
    await client.config();
    expect(http.calls[1]?.headers.cookie).toBe('hw_visitor=con_1');
  });

  it('is per client, so two clients are two visitors', async () => {
    const other = new HelpWellClient({ baseUrl: BASE, fetch: http.fetch });
    http.reply({}, 200, { 'set-cookie': 'hw_visitor=mine; Path=/' });
    await client.config();
    await other.config();
    expect(http.calls[1]?.headers.cookie).toBeUndefined();
  });

  it('forgets everything on request', async () => {
    http.reply({}, 200, { 'set-cookie': 'hw_visitor=con_1; Path=/' });
    await client.config();
    client.forget();
    await client.config();
    expect(http.calls[1]?.headers.cookie).toBeUndefined();
  });
});

describe('identity', () => {
  it('posts the token to identify and keeps the cookie that comes back', async () => {
    http.reply({ contactId: 'con_1', identified: true }, 200, {
      'set-cookie': 'hw_visitor=con_1; Path=/',
    });
    const result = await client.identify('signed.jwt.here');
    const call = http.calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/identify');
    expect(call?.body).toEqual({ token: 'signed.jwt.here' });
    expect(result).toEqual({ contactId: 'con_1', identified: true });

    await client.track('seen_pricing');
    expect(http.calls[1]?.headers.cookie).toBe('hw_visitor=con_1');
  });

  it('starts an anonymous visitor with a POST and no body', async () => {
    http.reply({ contactId: 'con_2', identified: false });
    const result = await client.visitor();
    const call = http.only();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/visitor');
    expect(call.body).toBeUndefined();
    expect(result.identified).toBe(false);
  });
});

describe('chat', () => {
  it('posts the message and returns the reply the API sent', async () => {
    http.reply({
      conversationId: 'conv_1',
      messageId: 'msg_1',
      text: 'Billing, then Invoices.',
      citations: [{ slug: 'billing/invoices', title: 'Invoices', collection: 'billing' }],
      unresolved: false,
      degraded: false,
    });

    const reply = await client.chat({ message: 'How do I export invoices?', pageUrl: '/billing' });

    const call = http.only();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat');
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.body).toEqual({ message: 'How do I export invoices?', pageUrl: '/billing' });
    expect(reply.text).toBe('Billing, then Invoices.');
    expect(reply.citations[0]?.slug).toBe('billing/invoices');
  });

  it('carries no authorization header, because chat is a public route', async () => {
    await client.chat({ message: 'hello' });
    expect(http.only().headers.authorization).toBeUndefined();
  });

  it('lists this visitor’s conversations as an array', async () => {
    http.reply({ items: [{ id: 'conv_1', status: 'resolved', snippet: 'Hi' }] });
    const items = await client.conversations();
    expect(items[0]?.id).toBe('conv_1');
    expect(http.only().path).toBe('/conversations');
  });

  it('reads one of this visitor’s threads', async () => {
    http.reply({ id: 'conv_1', status: 'resolved', messages: [] });
    const thread = await client.conversation('conv_1');
    expect(thread.messages).toEqual([]);
    expect(http.only().path).toBe('/conversations/conv_1');
  });

  it('posts feedback on a message, and null to take it back', async () => {
    http.reply(null, 204);
    http.reply(null, 204);
    await client.feedback('msg_1', 'helpful', 'Spot on');
    await client.feedback('msg_1', null);
    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      path: '/messages/msg_1/feedback',
      body: { feedback: 'helpful', comment: 'Spot on' },
    });
    expect(http.calls[1]?.body).toEqual({ feedback: null });
  });

  it('rates a conversation', async () => {
    http.reply(null, 204);
    await client.rateConversation('conv_1', 'love', 'Thanks');
    expect(http.only()).toMatchObject({
      method: 'POST',
      path: '/conversations/conv_1/rating',
      body: { rating: 'love', comment: 'Thanks' },
    });
  });
});

describe('search and articles', () => {
  it('sends the query and the limit as query parameters', async () => {
    http.reply({ query: 'invoices', results: [] });
    await client.search('invoices & receipts', 3);
    const call = http.only();
    expect(call.method).toBe('GET');
    expect(call.url.pathname).toBe('/api/helpwell/search');
    expect(call.url.searchParams.get('q')).toBe('invoices & receipts');
    expect(call.url.searchParams.get('limit')).toBe('3');
  });

  it('leaves the limit off entirely when the caller did not pick one', async () => {
    http.reply({ query: 'x', results: [] });
    await client.search('x');
    expect(http.only().url.searchParams.has('limit')).toBe(false);
  });

  it('unwraps the article list so callers get an array, not an envelope', async () => {
    http.reply({ items: [{ slug: 'billing/invoices', title: 'Invoices' }] });
    const articles = await client.articles();
    expect(articles).toHaveLength(1);
    expect(articles[0]?.slug).toBe('billing/invoices');
    expect(http.only().path).toBe('/articles');
  });

  it('filters the article list by collection', async () => {
    http.reply({ items: [] });
    await client.articles('getting started');
    expect(http.only().url.searchParams.get('collection')).toBe('getting started');
  });

  it('escapes each slug segment but keeps the slashes the route matches on', async () => {
    http.reply({ article: {}, related: [] });
    await client.article('billing/a b&c');
    expect(http.only().url.pathname).toBe('/api/helpwell/articles/billing/a%20b%26c');
  });

  it('rates an article under its slug', async () => {
    http.reply(null, 204);
    await client.rateArticle('billing/invoices', 'up', 'Clear');
    expect(http.only()).toMatchObject({
      method: 'POST',
      path: '/articles/billing/invoices/rating',
      body: { value: 'up', comment: 'Clear' },
    });
  });

  it('unwraps the collection list', async () => {
    http.reply({ items: [{ id: 'billing', collection: 'billing', articles: 4 }] });
    const collections = await client.collections();
    expect(collections).toEqual([{ id: 'billing', collection: 'billing', articles: 4 }]);
    expect(http.only().path).toBe('/collections');
  });
});

describe('changelog and roadmap', () => {
  it('pages the changelog with a cursor and a tag', async () => {
    http.reply({ items: [], nextCursor: null });
    await client.changelog({ limit: 5, cursor: 'cl_9', tag: 'fixes' });
    const call = http.only();
    expect(call.url.pathname).toBe('/api/helpwell/changelog');
    expect(call.url.searchParams.get('limit')).toBe('5');
    expect(call.url.searchParams.get('cursor')).toBe('cl_9');
    expect(call.url.searchParams.get('tag')).toBe('fixes');
  });

  it('reads one changelog entry by id', async () => {
    http.reply({ id: 'cl_1', title: 'Shipped' });
    const entry = await client.changelogEntry('cl_1');
    expect(entry.title).toBe('Shipped');
    expect(http.only().path).toBe('/changelog/cl_1');
  });

  it('reads the unread count as a number, from the route that sits above /:id', async () => {
    http.reply({ count: 3 });
    await expect(client.unread()).resolves.toBe(3);
    expect(http.only().path).toBe('/changelog/unread');
  });

  it('marks one entry read', async () => {
    http.reply(null, 204);
    await client.markRead('cl_1');
    expect(http.only()).toMatchObject({ method: 'POST', path: '/changelog/cl_1/read' });
  });

  it('marks everything read and says how many that was', async () => {
    http.reply({ marked: 4 });
    await expect(client.markAllRead()).resolves.toBe(4);
    expect(http.only()).toMatchObject({ method: 'POST', path: '/changelog/read-all' });
  });

  it('reads the roadmap board', async () => {
    http.reply({ under_review: [], planned: [], in_progress: [], shipped: [] });
    const board = await client.roadmap();
    expect(board.planned).toEqual([]);
    expect(http.only().path).toBe('/roadmap');
  });

  it('votes with a POST and no body, because the route toggles', async () => {
    http.reply({ voted: true, votesCount: 4 });
    const result = await client.vote('rm_1');
    const call = http.only();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/roadmap/rm_1/vote');
    expect(call.body).toBeUndefined();
    expect(call.headers['content-type']).toBeUndefined();
    expect(result).toEqual({ voted: true, votesCount: 4 });
  });

  it('submits an idea with a title and a body', async () => {
    http.reply({ id: 'rm_2' }, 201);
    const created = await client.submitIdea('Dark mode', 'It burns at night.');
    const call = http.only();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/roadmap');
    expect(call.body).toEqual({ title: 'Dark mode', body: 'It burns at night.' });
    expect(created.id).toBe('rm_2');
  });
});

describe('engage', () => {
  it('asks for the engagements on a page and unwraps them', async () => {
    http.reply({ items: [{ id: 'welcome', kind: 'modal' }] });
    const items = await client.engagements('/billing/invoices');
    expect(items[0]?.id).toBe('welcome');
    const { url } = http.only();
    expect(url.pathname).toBe('/api/helpwell/engage');
    expect(url.searchParams.get('path')).toBe('/billing/invoices');
  });

  it('records an impression with its state and step', async () => {
    http.reply(null, 204);
    await client.impression('tour_1', 'completed', { step: 3, url: '/x' });
    expect(http.only()).toMatchObject({
      method: 'POST',
      path: '/engage/tour_1/impression',
      body: { state: 'completed', step: 3, url: '/x' },
    });
  });

  it('answers a survey', async () => {
    http.reply({ id: 'sr_1' }, 201);
    const result = await client.surveyResponse('nps_q3', { kind: 'nps', score: 9 });
    expect(result.id).toBe('sr_1');
    expect(http.only()).toMatchObject({
      method: 'POST',
      path: '/surveys/nps_q3/response',
      body: { kind: 'nps', score: 9 },
    });
  });
});

describe('track and config', () => {
  it('posts an event and resolves on the empty 204', async () => {
    http.reply(null, 204);
    await expect(
      client.track('invoice_exported', { plan: 'pro' }, '/billing'),
    ).resolves.toBeUndefined();
    expect(http.only().body).toEqual({
      name: 'invoice_exported',
      props: { plan: 'pro' },
      url: '/billing',
    });
  });

  it('reads the public config', async () => {
    http.reply({ product: { name: 'Acme', locale: 'en' }, unread: 2 });
    const config = await client.config();
    expect(config.product.name).toBe('Acme');
    expect(http.only().path).toBe('/config');
  });
});

describe('signing identify tokens', () => {
  it('mints a token from the secret the client was built with', async () => {
    const token = await client.signFor({ id: 'user_1', email: 'ada@example.com' });
    expect(token.split('.')).toHaveLength(3);
  });

  it('says which option is missing when no secret was configured', async () => {
    const bare = new HelpWellClient({ baseUrl: BASE, fetch: http.fetch });
    expect(() => bare.signFor({ id: 'user_1' })).toThrow(/identitySecret/);
  });
});

describe('a support extension', () => {
  it('sends a chat requestId and a proactiveId as given', async () => {
    http.reply({ conversationId: 'cnv_1', messageId: 'msg_1', text: 'Hi', citations: [] });
    await client.chat({ message: 'Yes please', requestId: 'req_12345678', proactiveId: 'hello_1' });
    expect(http.only().body).toEqual({
      message: 'Yes please',
      requestId: 'req_12345678',
      proactiveId: 'hello_1',
    });
  });

  it('lists proactive items for a page and reports an event on one', async () => {
    http.reply({ items: [{ kind: 'chat', id: 'hello_1' }] });
    http.reply(null, 204);
    const items = await client.proactive('/billing', 'browser_abc123');
    await client.proactiveEvent('hello_1', 'dismissed', 'browser_abc123');
    expect(items.map((item) => item.id)).toEqual(['hello_1']);
    expect(http.calls[0]?.path).toBe('/proactive?path=%2Fbilling&anon=browser_abc123');
    expect(http.calls[1]).toMatchObject({
      method: 'POST',
      path: '/proactive/hello_1/events',
      body: { event: 'dismissed', anon: 'browser_abc123' },
    });
  });

  it('tells the extension what it knows about the visit', async () => {
    http.reply({ items: [] });
    await client.proactive('/pricing', 'browser_abc123', {
      device: 'mobile',
      lang: 'en-GB',
      referrer: 'https://news.example/',
      utm: { source: 'newsletter' },
    });
    const query = new URLSearchParams(http.calls[0]?.path.split('?')[1]);
    expect(Object.fromEntries(query)).toEqual({
      path: '/pricing',
      anon: 'browser_abc123',
      referrer: 'https://news.example/',
      device: 'mobile',
      lang: 'en-GB',
      utm_source: 'newsletter',
    });
  });
});
