/**
 * The fixture every tool test reads from: a small help centre, a few gaps and
 * a handful of conversations spread across time, so range filters and ordering
 * have something real to sort.
 */

import { recordGap } from '@helpwell/core/agent';
import type { Article } from '@helpwell/core/content';
import type { Db } from '@helpwell/core/db';
import { schema } from '@helpwell/core/db';
import { indexArticles, indexCollections } from '@helpwell/core/search';

export function article(
  partial: Pick<Article, 'slug' | 'collection' | 'title' | 'body'> & Partial<Article>,
): Article {
  return {
    description: null,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: 1,
    path: `${partial.slug}.md`,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    contentHash: `hash-${partial.slug}`,
    ...partial,
  };
}

export const ARTICLES: Article[] = [
  article({
    slug: 'billing/invoices',
    collection: 'billing',
    title: 'Exporting invoices',
    description: 'Download a PDF of any invoice.',
    body: 'Open Billing, then Invoices, and choose Export to download a PDF receipt.',
    order: 0,
  }),
  article({
    slug: 'billing/currency',
    collection: 'billing',
    title: 'Changing currency',
    body: 'Workspace owners can switch the billing currency once per year.',
    order: 1,
  }),
  article({
    slug: 'account/sso',
    collection: 'account',
    title: 'Single sign-on',
    body: 'SAML single sign-on is available on the Enterprise plan.',
    order: 2,
  }),
  article({
    slug: 'billing/refunds',
    collection: 'billing',
    title: 'Refunds',
    status: 'draft',
    body: 'Refunds are handled case by case by the billing team.',
    order: 3,
  }),
];

const days = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/**
 * Conversation ids are hand-written and ordered, because the list route sorts
 * by id and a test about ordering should not depend on how fast the clock in a
 * generated id ticks.
 */
export async function seed(db: Db): Promise<void> {
  await indexArticles(db, ARTICLES);

  // `billing` has a _meta.json and `account` does not, which is the pair worth
  // testing: one collection presents what its folder asked for, the other
  // falls back to a title made from the folder name.
  await indexCollections(db, [
    {
      id: 'billing',
      title: 'Billing and plans',
      description: 'Invoices, receipts and what a plan includes.',
      icon: 'credit-card',
      tint: 'peach',
      order: 1,
      askAgent: true,
      visibility: 'public',
      articles: [],
    },
  ]);

  await db.insert(schema.contacts).values({
    id: 'ct_0000001',
    source: 'widget',
    identified: true,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  });

  await db.insert(schema.conversations).values([
    {
      id: 'conv_0000001',
      contactId: 'ct_0000001',
      status: 'resolved',
      topic: 'billing',
      startedAt: days(45),
      lastMessageAt: days(45),
      messageCount: 2,
    },
    {
      id: 'conv_0000002',
      contactId: 'ct_0000001',
      status: 'unresolved',
      topic: 'billing',
      startedAt: days(3),
      lastMessageAt: days(3),
      messageCount: 2,
    },
    {
      id: 'conv_0000003',
      contactId: 'ct_0000001',
      status: 'resolved',
      topic: 'account',
      startedAt: days(1),
      lastMessageAt: days(1),
      messageCount: 2,
      rating: 'happy',
    },
  ]);

  await db.insert(schema.messages).values([
    {
      id: 'msg_0000001',
      conversationId: 'conv_0000001',
      role: 'customer',
      body: 'Where are my old invoices?',
      createdAt: days(45),
    },
    {
      id: 'msg_0000002',
      conversationId: 'conv_0000002',
      role: 'customer',
      body: 'Can I pay in euros?',
      createdAt: days(3),
    },
    {
      id: 'msg_0000003',
      conversationId: 'conv_0000003',
      role: 'customer',
      body: 'How do I turn on SSO?',
      createdAt: days(1),
    },
  ]);

  // Asked twice, so it should sort above the others in the gap list.
  await recordGap(db, { question: 'How do I export invoices to my accountant?' });
  await recordGap(db, { question: 'How do I export invoices to my accountant?' });
  await recordGap(db, {
    question: 'Can I change the billing currency on my workspace?',
    suggestedTitle: 'Changing your billing currency',
    suggestedCollection: 'billing',
  });
  await recordGap(db, { question: 'Where do I download the mobile application?' });
}
