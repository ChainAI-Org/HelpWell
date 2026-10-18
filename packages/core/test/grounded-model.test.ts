/**
 * `FakeModel.grounded()`: the keyless model offline mode and the playground
 * answer with.
 *
 * The first half is the script on its own, fed prompts built the way the
 * agent builds them. The second runs it through the real agent against a real
 * index, where what matters is what a real model's answer would have done:
 * a covered question resolves, cited; a missed one, or one that shares only a
 * stray word with an article, is unresolved and logged as a gap.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Agent,
  buildSystemPrompt,
  type ChatRequest,
  CONFIDENCE_THRESHOLD,
  excerpt,
  FakeModel,
  groundedReply,
  promptPassages,
} from '../src/agent.js';
import { type Article, hashContent } from '../src/content.js';
import { schema } from '../src/db.js';
import { indexArticles } from '../src/search.js';
import { defaultSettings } from '../src/settings.js';
import { freshDb, type TestDb } from './helpers/db.js';

/** A request shaped the way the agent builds one, from passages search "found". */
function requestWith(
  passages: { slug: string; title: string; snippet: string }[],
  question = 'How do I export invoices?',
): ChatRequest {
  const settings = defaultSettings();
  const system = buildSystemPrompt({
    agent: settings.agent,
    productName: 'Acme',
    passages: passages.map((p) => ({
      ...p,
      collection: p.slug.split('/')[0] ?? '',
      description: null,
      score: 1,
      matchedBy: ['text'],
    })),
  });
  return {
    model: 'test/model',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: question },
    ],
  };
}

describe('the grounded script', () => {
  it('reads the numbered passages out of the prompt the agent writes', () => {
    const passages = promptPassages(
      requestWith([
        {
          slug: 'billing/invoices',
          title: 'Exporting "all" invoices',
          snippet: 'Open <mark>Billing</mark>, then press Export.',
        },
        { slug: 'billing/refunds', title: 'Refunds', snippet: 'Refunds take five days.' },
      ]),
    );
    expect(passages).toEqual([
      {
        ref: 1,
        slug: 'billing/invoices',
        title: 'Exporting "all" invoices',
        text: 'Open Billing, then press Export.',
      },
      { ref: 2, slug: 'billing/refunds', title: 'Refunds', text: 'Refunds take five days.' },
    ]);
  });

  it('quotes the top passage, cites it and says it answered', () => {
    const turn = groundedReply(
      requestWith([
        {
          slug: 'billing/invoices',
          title: 'Exporting invoices',
          snippet: 'Open Billing, then press Export.',
        },
        { slug: 'billing/refunds', title: 'Refunds', snippet: 'Refunds take five days.' },
      ]),
    );
    expect(turn.text).toBe(
      'From "Exporting invoices" in your docs: Open Billing, then press Export.',
    );
    expect(turn.cites).toEqual([1]);
    expect(turn.certainty).toMatchObject({ level: 'answered' });
  });

  it('reads how sure to be off how much of the question search matched', () => {
    const request = requestWith([
      { slug: 'billing/invoices', title: 'Exporting invoices', snippet: 'Press Export.' },
    ]);

    expect(groundedReply(request, { match: { text: 'strict', textCoverage: 1 } })).toMatchObject({
      cites: [1],
      certainty: { level: 'answered' },
    });
    expect(groundedReply(request, { match: { text: 'loose', textCoverage: 0.67 } })).toMatchObject({
      cites: [1],
      certainty: { level: 'partial' },
    });

    const stray = groundedReply(request, { match: { text: 'loose', textCoverage: 0.34 } });
    expect(stray.cites).toBeUndefined();
    expect(stray.certainty).toMatchObject({ level: 'not_covered' });
    expect(stray.text).toContain('Nothing in the docs answers that');
    expect(stray.text).toContain('Exporting invoices');
  });

  it('says the docs do not cover it when search found nothing', () => {
    const turn = groundedReply(requestWith([]));
    expect(turn.text).toContain('Nothing in the docs matched');
    expect(turn.cites).toBeUndefined();
    expect(turn.certainty).toMatchObject({ level: 'not_covered' });
  });

  it('lets the caller word it, and keeps the citation and certainty its own', () => {
    const request = requestWith([
      { slug: 'billing/invoices', title: 'Exporting invoices', snippet: 'Press Export.' },
    ]);
    const seen: unknown[] = [];
    const turn = groundedReply(request, {
      turn: 3,
      match: { text: 'strict', textCoverage: 1 },
      wording: (finding) => {
        seen.push(finding);
        return `Here is what the help centre says: ${finding.quote}`;
      },
    });
    expect(turn.text).toBe('Here is what the help centre says: Press Export.');
    expect(turn.cites).toEqual([1]);
    expect(seen).toEqual([
      expect.objectContaining({
        level: 'answered',
        quote: 'Press Export.',
        question: 'How do I export invoices?',
        coverage: 1,
        turn: 3,
      }),
    ]);
  });

  it('keeps the quote to a sentence or two, and marks a cut-off fragment', () => {
    expect(excerpt('# Invoices\n\nOpen Billing. Press Export. Pick a format. Save it.')).toBe(
      'Open Billing. Press Export.',
    );
    expect(excerpt('then press Export and pick a format')).toBe(
      '…then press Export and pick a format…',
    );
    expect(excerpt('- Open Billing.\n- Press Export.')).toBe('Open Billing. Press Export.');
    expect(excerpt('x'.repeat(400)).length).toBeLessThanOrEqual(281);
    expect(excerpt('   ')).toBe('');
  });

  it('quotes the sentence closest to the question, without the title run into it', () => {
    const snippet =
      'Attach and match receipts Snap it in the app. Forward the email to receipts@acme.test from a verified address. It matches itself.';
    expect(
      excerpt(snippet, {
        title: 'Attach and match receipts',
        question: 'How do I forward a receipt by email?',
      }),
    ).toBe('Forward the email to receipts@acme.test from a verified address. It matches itself.');
  });

  it('quotes from the section the question is about when the passage is a whole article', () => {
    const article = [
      'A receipt can arrive three ways: dropped onto an expense, forwarded by email, or',
      'photographed in the mobile app. All three end in the same place.',
      '',
      '## Forwarding by email',
      '',
      'Send the receipt to **receipts@acme.test** from the address you sign in',
      'with. Attachments work too.',
      '',
      '## Storage',
      '',
      'Receipts are kept for seven years.',
    ].join('\n');
    expect(excerpt(article, { question: 'How do I forward a receipt by email?' })).toBe(
      'Send the receipt to **receipts@acme.test** from the address you sign in with. Attachments work too.',
    );
  });
});

/* ------------------------------------------------------------ with search */

function doc(slug: string, title: string, body: string): Article {
  return {
    slug,
    collection: slug.split('/')[0]!,
    title,
    description: null,
    body,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    path: `${slug}.md`,
    updatedAt: new Date(),
    contentHash: hashContent(title + body),
  };
}

describe('FakeModel.grounded against real search', () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await freshDb();
    await indexArticles(t.db, [
      doc(
        'billing/invoices',
        'Exporting invoices',
        'Open Billing, then Invoices, then press Export. Pick PDF or CSV and the file downloads straight away.',
      ),
      doc(
        'account/two-factor',
        'Turning on two-factor sign-in',
        'Go to Settings, then Security, and switch on Two-factor. Scan the code with an authenticator app.',
      ),
    ]);
  });

  afterEach(async () => {
    await t.close();
  });

  const agent = (model: FakeModel) =>
    new Agent({
      db: t.db,
      settings: defaultSettings(),
      model,
      models: { embeddings: null, fallback: null },
    });

  it('answers a covered question grounded, cited and resolved', async () => {
    const reply = await agent(FakeModel.grounded(t.db)).reply({
      message: 'How do I export invoices?',
    });

    expect(reply.degraded).toBe(false);
    expect(reply.unresolved).toBe(false);
    expect(reply.certainty).toBe('answered');
    expect(reply.citations.map((c) => c.slug)).toEqual(['billing/invoices']);
    expect(reply.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    expect(reply.text).toContain('press Export');
    // The marker and the certainty line are the model's, never the reader's.
    expect(reply.text).not.toContain('[1]');
    expect(reply.text).not.toContain('<certainty>');
    expect(await t.db.select().from(schema.gaps)).toHaveLength(0);
  });

  it('does not pass a stray shared word off as an answer', async () => {
    const reply = await agent(FakeModel.grounded(t.db)).reply({
      message: 'How do I export payroll to bitcoin?',
    });

    expect(reply.unresolved).toBe(true);
    expect(reply.certainty).toBe('not_covered');
    expect(reply.citations).toEqual([]);
    expect(await t.db.select().from(schema.gaps)).toHaveLength(1);
  });

  it('counts its turns across conversations, for wording that says something once', async () => {
    const model = FakeModel.grounded(t.db, {
      wording: ({ turn, quote }) => (turn === 0 ? `First, a note. ${quote}` : quote),
    });
    const first = await agent(model).reply({ message: 'How do I export invoices?' });
    const second = await agent(model).reply({ message: 'How do I turn on two-factor?' });

    expect(first.text).toContain('First, a note.');
    expect(second.text).not.toContain('First, a note.');
    expect(second.citations.map((c) => c.slug)).toEqual(['account/two-factor']);
    expect(model.requests).toHaveLength(2);
  });
});
