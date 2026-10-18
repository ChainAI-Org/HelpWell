/**
 * A believable HelpWell installation, in memory.
 *
 * Used by the screenshot harness and handy for poking at the UI. Everything
 * here is invented for a fictional product, Ridgeline, so the screenshots show
 * a help desk with real traffic in it rather than a row of empty states.
 */

import { createDb, migrate, schema } from '@helpwell/core/db';
import { indexArticles, indexCollections } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';

const PRODUCT = 'Ridgeline';

/** One article, with the fields the indexer wants filled in. */
function article(slug, collection, title, description, body, extra = {}) {
  return {
    slug,
    collection,
    title,
    description,
    body,
    headings: [],
    status: 'published',
    appliesTo: null,
    order: 0,
    readingMinutes: Math.max(1, Math.round(body.split(/\s+/).length / 200)),
    path: `${slug}.md`,
    updatedAt: new Date('2026-08-20T10:00:00Z'),
    contentHash: `hash-${slug}`,
    ...extra,
  };
}

const ARTICLES = [
  article(
    'getting-started/submitting-an-expense',
    'getting-started',
    'Submitting an expense',
    'Snap the receipt, pick a category, send it.',
    `## The short version

Open **Expenses**, press **New expense**, and photograph the receipt. Ridgeline
reads the amount, date and merchant off it, so most of the form fills itself.

## What you need

- A receipt, as a photo or a PDF
- The category it belongs to
- A note, if the reason is not obvious from the merchant

## Once you send it

It goes to whoever approves for your team. You will see it move from
**Draft** to **Waiting** to **Approved** on the same screen. Nobody has to
chase anything; if an approver has not looked in three days, Ridgeline nudges
them.

## If the receipt will not read

Photograph it flat, in daylight, with all four corners in the frame. If it
still will not read, type the amount in by hand and attach the photo anyway —
finance needs the image either way.`,
    { order: 0 },
  ),
  article(
    'getting-started/your-first-week',
    'getting-started',
    'Your first week on Ridgeline',
    'What to set up, in the order that saves you the most time.',
    `Set these three things up on day one and everything else can wait.

1. **Connect your card.** Expenses appear on their own, already matched to a
   merchant, and you only have to attach the receipt.
2. **Pick your default category.** Most people spend in one or two places.
3. **Tell us who approves for you.** Without this, your expenses sit in a
   queue nobody owns.

Everything else — projects, per-diems, mileage — can be set up the week you
first need it.`,
    { order: 1 },
  ),
  article(
    'approvals/approving-an-expense',
    'approvals',
    'Approving an expense',
    'What approvers see, and what happens after they press the button.',
    `Approvers see one queue, oldest first, with the receipt beside the amount.

## Approving

Press **Approve**. The money is scheduled for the next payment run, and the
person who submitted it gets told.

## Sending something back

Press **Ask a question** rather than rejecting outright. It goes back as a
draft with your note attached, so the fix is one edit rather than a whole new
submission.

## Approving on behalf of someone

If you are covering for another approver, switch queues from the dropdown at
the top. Every approval is recorded under your name, not theirs.`,
  ),
  article(
    'approvals/approval-rules',
    'approvals',
    'Setting approval rules',
    'Who approves what, and when something needs two people.',
    `Rules run top to bottom, and the first one that matches wins.

A rule is three things: what it matches, who approves it, and whether one
approval is enough.

    Anything over £2,000    →   the department head, then finance
    Travel                  →   the traveller's manager
    Everything else         →   the team approver

Anything that matches no rule goes to the team approver, so nothing can fall
through.`,
  ),
  article(
    'billing/exporting-invoices',
    'billing',
    'Exporting invoices',
    'Download a PDF or CSV of any invoice, on any plan.',
    `## Where to find them

Open **Billing**, then **Invoices**. Every invoice is there from the day you
signed up.

## Exporting

Press **Export** and choose PDF or CSV. PDF is the one your accountant wants;
CSV is the one your accounting software wants.

## Exporting a whole year

Set the date range first, then export. Anything over a hundred invoices is
emailed to you as a zip instead of downloading, because the browser gives up
part way through otherwise.

## Who can do this

Anyone with the Billing role. If you cannot see the tab, ask an admin to add
it — it is not tied to your plan.`,
  ),
  article(
    'billing/changing-your-plan',
    'billing',
    'Changing your plan',
    'Upgrade takes effect now; downgrade takes effect at renewal.',
    `Open **Billing**, then **Plan**.

Upgrading takes effect immediately, and you are charged the difference for the
rest of the period.

Downgrading takes effect at your next renewal, so you keep what you have paid
for. If you are over the seat limit of the plan you are moving to, Ridgeline
tells you before you confirm rather than after.`,
    { appliesTo: 'All plans' },
  ),
  article(
    'integrations/connecting-your-bank',
    'integrations',
    'Connecting your bank',
    'Read-only, through your bank, and revocable from either end.',
    `Ridgeline connects to your bank read-only. We can see transactions; we can
never move money.

## Connecting

Open **Integrations**, choose your bank, and sign in on your bank's own page.
Ridgeline never sees your banking password.

## What this gets you

Card spend shows up as a draft expense within a few minutes, already matched to
a merchant. You attach the receipt and send it.

## Disconnecting

From **Integrations**, or from your bank. Either works, and neither deletes the
expenses already imported.`,
  ),
  article(
    'integrations/accounting-software',
    'integrations',
    'Sending expenses to your accounting software',
    'Xero, QuickBooks and a CSV that works everywhere else.',
    `Approved expenses can be pushed to your ledger automatically, once a day or
on approval.

Map your Ridgeline categories to your chart of accounts once, under
**Integrations → Accounting**. Anything unmapped is held back rather than
guessed at, and shows in a short list you can clear in a minute.`,
  ),
  article(
    'security/single-sign-on',
    'security',
    'Single sign-on',
    'SAML and OIDC, on the Business plan.',
    `Ridgeline supports SAML 2.0 and OIDC.

Set it up under **Settings → Security → Single sign-on**. You will need your
provider's metadata URL. Once it is on, you can require it, which stops anyone
signing in with a password.

Just-in-time provisioning is on by default: someone who signs in through your
provider for the first time gets an account with the default role.`,
    { appliesTo: 'Business' },
  ),
  article(
    'security/roles-and-permissions',
    'security',
    'Roles and permissions',
    'Four roles, and what each one can see.',
    `| Role      | Can do                                              |
| --------- | --------------------------------------------------- |
| Member    | Submit their own expenses                            |
| Approver  | Everything a member can, plus approve for their team |
| Finance   | See every expense, run payments, export              |
| Admin     | Everything, plus settings and billing                |

Roles are additive, and nobody can grant themselves one. Only an admin can
change a role, and every change is in the audit log.`,
  ),
];

/**
 * What each docs folder's _meta.json would have said.
 *
 * `security` is missing on purpose. It has articles and no row, which is the
 * state of every collection that never wrote a _meta.json, so the help centre
 * screenshot shows that fallback sitting next to four folders that chose their
 * own title, icon and tint.
 */
const COLLECTIONS = [
  collection(
    1,
    'getting-started',
    'Getting started',
    'Your first expense, and your first week.',
    'rocket',
    'lavender',
  ),
  collection(2, 'approvals', 'Approvals', 'Who signs off on what, and when.', 'check', 'mint'),
  collection(
    3,
    'billing',
    'Billing and plans',
    'Invoices, receipts and changing your plan.',
    'credit-card',
    'peach',
  ),
  collection(
    4,
    'integrations',
    'Integrations',
    'Bank feeds and accounting software.',
    'puzzle',
    'butter',
  ),
];

function collection(order, id, title, description, icon, tint) {
  return {
    id,
    title,
    description,
    icon,
    tint,
    order,
    askAgent: true,
    visibility: 'public',
    articles: [],
  };
}

const CHANGELOG = [
  {
    id: 'chg_2026_08',
    version: '3.2.0',
    title: 'Receipts read themselves',
    summary: 'Photograph a receipt and the amount, date and merchant fill in.',
    body: `We have replaced the old receipt scanner.

Photograph a receipt and Ridgeline now reads the amount, the date and the
merchant off it, including crumpled thermal paper, which the old one could not
manage.

If it reads something wrong, correct it — the correction sticks for that
merchant next time.`,
    tags: ['Improved'],
    status: 'published',
    publishedAt: new Date('2026-08-18T09:00:00Z'),
  },
  {
    id: 'chg_2026_07',
    version: '3.1.0',
    title: 'Approve from your phone',
    summary: 'The approval queue now works properly on a small screen.',
    body: `The approval queue was unusable on a phone. It is not any more: the
receipt and the amount sit side by side, and approving is one tap.`,
    tags: ['New'],
    status: 'published',
    publishedAt: new Date('2026-07-02T09:00:00Z'),
  },
  {
    id: 'chg_2026_06',
    version: '3.0.4',
    title: 'Exports stopped timing out',
    summary: 'A year of invoices exports in about four seconds.',
    body: `Exporting more than a few hundred invoices used to time out. Exports
now stream, so a full year comes down in about four seconds regardless of size.`,
    tags: ['Fixed'],
    status: 'published',
    publishedAt: new Date('2026-06-11T09:00:00Z'),
  },
  {
    id: 'chg_2026_05',
    version: '3.0.0',
    title: 'Approval rules',
    summary: 'Decide who approves what, instead of one queue for everything.',
    body: `Approvals used to be one queue for the whole company. Now you can
write rules: anything over a threshold goes to a department head, travel goes
to the traveller's manager, and everything else goes where it always did.`,
    tags: ['New'],
    status: 'published',
    publishedAt: new Date('2026-05-20T09:00:00Z'),
  },
];

const ROADMAP = [
  { id: 'rmp_1', title: 'Per-diem rates by country', status: 'in_progress', votesCount: 34 },
  { id: 'rmp_2', title: 'Mileage tracking from your phone', status: 'in_progress', votesCount: 28 },
  { id: 'rmp_3', title: 'Split an expense across projects', status: 'planned', votesCount: 61 },
  { id: 'rmp_4', title: 'Corporate card issuing', status: 'planned', votesCount: 47 },
  { id: 'rmp_5', title: 'Recurring expenses', status: 'under_review', votesCount: 19 },
  { id: 'rmp_6', title: 'Approve by email reply', status: 'under_review', votesCount: 12 },
  { id: 'rmp_7', title: 'Bulk receipt upload', status: 'shipped', votesCount: 55 },
  { id: 'rmp_8', title: 'Dark mode', status: 'shipped', votesCount: 88 },
];

const PEOPLE = [
  { id: 'con_ada', name: 'Ada Okafor', email: 'ada@northwind.co', plan: 'Business', seats: 40 },
  { id: 'con_bo', name: 'Bo Lindqvist', email: 'bo@northwind.co', plan: 'Business', seats: 40 },
  { id: 'con_cy', name: 'Cy Draper', email: 'cy@meridian.io', plan: 'Team', seats: 8 },
  { id: 'con_di', name: 'Dilan Raza', email: 'dilan@meridian.io', plan: 'Team', seats: 8 },
  { id: 'con_el', name: 'Elin Faber', email: 'elin@harbourside.com', plan: 'Starter', seats: 3 },
];

const CONVERSATIONS = [
  {
    id: 'cnv_1',
    contactId: 'con_ada',
    topic: 'Billing',
    status: 'resolved',
    question: 'How do I export a whole year of invoices at once?',
    answer:
      'Open **Billing → Invoices**, set the date range to the year you want, then press **Export**.\n\nAnything over a hundred invoices is sent to you as a zip rather than downloading directly, because the browser tends to give up part way through a download that large.',
    cite: ['billing/exporting-invoices'],
    feedback: 'helpful',
    minutesAgo: 24,
  },
  {
    id: 'cnv_2',
    contactId: 'con_cy',
    topic: 'Approvals',
    status: 'resolved',
    question: 'Can someone else approve while I am on holiday?',
    answer:
      'Yes. Whoever is covering switches queues from the dropdown at the top of **Approvals**.\n\nEvery approval is recorded under the name of the person who actually pressed the button, so the audit log stays honest.',
    cite: ['approvals/approving-an-expense'],
    feedback: 'helpful',
    minutesAgo: 60 * 26,
  },
  {
    id: 'cnv_3',
    contactId: 'con_el',
    topic: 'Security',
    status: 'unresolved',
    question: 'Do you support SCIM provisioning?',
    answer:
      'I could not find anything about SCIM in the Ridgeline docs, so I do not want to guess.\n\nSingle sign-on through SAML and OIDC is supported on Business, and new people are provisioned when they first sign in. Whether that covers what you need I honestly cannot say — I have passed this on.',
    cite: [],
    minutesAgo: 60 * 52,
  },
  {
    id: 'cnv_4',
    contactId: 'con_bo',
    topic: 'Getting started',
    status: 'resolved',
    question: 'My receipt photo will not scan. It is a curled-up till roll.',
    answer:
      'Thermal receipts curl, and the camera reads the shadow rather than the text.\n\nFlatten it under something, photograph it in daylight with all four corners in frame, and it usually reads. If it still will not, type the amount in and attach the photo anyway — finance needs the image either way.',
    cite: ['getting-started/submitting-an-expense'],
    feedback: 'helpful',
    minutesAgo: 60 * 98,
  },
  {
    id: 'cnv_5',
    contactId: 'con_di',
    topic: 'Integrations',
    status: 'resolved',
    question: 'Is the bank connection read-only? Our finance team asked.',
    answer:
      'It is. Ridgeline can see transactions and can never move money.\n\nYou sign in on your bank’s own page, so we never see your banking password, and you can disconnect from either end at any time.',
    cite: ['integrations/connecting-your-bank'],
    feedback: 'helpful',
    minutesAgo: 60 * 170,
  },
  {
    id: 'cnv_6',
    contactId: 'con_ada',
    topic: 'Approvals',
    status: 'resolved',
    question: 'What happens to an expense nobody approves?',
    answer:
      'Nothing gets lost. Anything that matches no approval rule goes to the team approver, and an approver who has not looked in three days gets a nudge.',
    cite: ['approvals/approval-rules'],
    minutesAgo: 60 * 290,
  },
  {
    id: 'cnv_7',
    contactId: 'con_cy',
    topic: 'Billing',
    status: 'unresolved',
    question: 'Can we pay annually in euros rather than pounds?',
    answer:
      'I do not have anything in the docs about paying in another currency, so I would rather not guess at it. I have logged the question for the team.',
    cite: [],
    minutesAgo: 60 * 460,
  },
];

const GAPS = [
  {
    id: 'gap_scim',
    question: 'Do you support SCIM provisioning?',
    variants: ['Can we use SCIM?', 'Automatic user deprovisioning?'],
    asks: 9,
    status: 'new',
    suggestedCollection: 'Security',
    suggestedTitle: 'SCIM provisioning',
  },
  {
    id: 'gap_currency',
    question: 'Can we be billed in a currency other than pounds?',
    variants: ['Pay in euros?', 'Do you invoice in USD?'],
    asks: 6,
    status: 'new',
    suggestedCollection: 'Billing',
    suggestedTitle: 'Billing currency',
  },
  {
    id: 'gap_perdiem',
    question: 'How do per-diem rates work for international travel?',
    variants: ['Per diem abroad'],
    asks: 4,
    status: 'new',
    suggestedCollection: 'Approvals',
    suggestedTitle: 'Per-diem rates',
  },
  {
    id: 'gap_api',
    question: 'Is there an API for creating expenses?',
    variants: [],
    asks: 3,
    status: 'new',
    suggestedCollection: 'Integrations',
    suggestedTitle: 'The expenses API',
  },
  {
    id: 'gap_sso_done',
    question: 'Which SSO providers do you work with?',
    variants: [],
    asks: 7,
    status: 'drafted',
    articleSlug: 'security/single-sign-on',
  },
];

const SEARCHES = [
  ['export invoices', 6],
  ['approval rules', 4],
  ['scim', 0],
  ['change plan', 5],
  ['receipt not scanning', 3],
  ['per diem', 0],
  ['sso', 4],
  ['connect bank', 5],
  ['refund', 0],
  ['mileage', 0],
];

const ENGAGEMENTS = [
  {
    id: 'welcome-tour',
    kind: 'tour',
    enabled: true,
    title: 'Welcome to Ridgeline',
    body: 'Three things worth knowing before you start.',
    paths: { include: ['/app/**'], exclude: ['/app/settings', '/checkout/**'] },
    audience: 'identified',
    frequency: 'once',
    steps: [
      { target: '#nav-expenses', title: 'Your expenses', body: 'Everything you have submitted.' },
      { target: '#new-expense', title: 'Add one', body: 'Photograph the receipt; we read it.' },
      { target: '#nav-approvals', title: 'Approvals', body: 'Anything waiting on you.' },
    ],
  },
  {
    id: 'receipt-scanner-banner',
    kind: 'banner',
    enabled: true,
    title: 'Receipts read themselves now.',
    body: 'Photograph one and the amount fills in.',
    cta: {
      label: 'See what changed',
      url: 'helpwell:article/getting-started/submitting-an-expense',
    },
    paths: { include: ['/app/expenses**'], exclude: [] },
    frequency: { everyDays: 30 },
  },
  {
    id: 'nps-q3',
    kind: 'survey',
    enabled: true,
    paths: { include: ['/app/**'], exclude: ['/checkout/**'] },
    audience: 'identified',
    frequency: { everyDays: 90 },
    delayMs: 20_000,
    survey: {
      type: 'nps',
      question: 'How likely are you to recommend Ridgeline?',
      followUp: 'What made you choose that?',
      choices: [],
    },
  },
];

const minutes = (n) => new Date(Date.now() - n * 60_000);

/** Build a seeded, in-memory HelpWell. Returns the handle so callers can close it. */
export async function seed() {
  const handle = await createDb({ url: 'pglite://memory' });
  const { db } = handle;
  await migrate(db);

  await new SettingsStore(db).update({
    product: {
      name: PRODUCT,
      appUrl: 'https://ridgeline.example.com',
      supportEmail: 'support@ridgeline.example.com',
    },
    helpCenter: { subpath: '/help', theme: { accent: '#7A3BEB' } },
    changelog: { repo: 'ridgeline/app', roadmap: { enabled: true, whoCanSubmit: 'identified' } },
    engage: { enabled: true, engagements: ENGAGEMENTS },
  });

  await indexArticles(db, ARTICLES);
  await indexCollections(db, COLLECTIONS);

  await db.insert(schema.contacts).values(
    PEOPLE.map((person, index) => ({
      id: person.id,
      externalId: `user_${index + 1}`,
      name: person.name,
      email: person.email,
      identified: true,
      attributes: { plan: person.plan, seats: person.seats },
      country: ['United Kingdom', 'Sweden', 'United States', 'United Kingdom', 'Ireland'][index],
      city: ['London', 'Malmö', 'Austin', 'Manchester', 'Cork'][index],
      firstSeenAt: new Date('2026-02-14T09:00:00Z'),
      lastSeenAt: minutes(30 + index * 90),
    })),
  );

  for (const conversation of CONVERSATIONS) {
    const at = minutes(conversation.minutesAgo);
    await db.insert(schema.conversations).values({
      id: conversation.id,
      contactId: conversation.contactId,
      status: conversation.status,
      topic: conversation.topic,
      pageUrl: '/app/expenses',
      messageCount: 2,
      costUsd: '0.0042',
      startedAt: at,
      lastMessageAt: at,
      reviewedAt: conversation.status === 'resolved' && conversation.feedback ? at : null,
    });

    await db.insert(schema.messages).values([
      {
        id: `${conversation.id}_q`,
        conversationId: conversation.id,
        role: 'customer',
        body: conversation.question,
        createdAt: at,
      },
      {
        id: `${conversation.id}_a`,
        conversationId: conversation.id,
        role: 'agent',
        body: conversation.answer,
        citations: conversation.cite.map((slug) => {
          const found = ARTICLES.find((a) => a.slug === slug);
          return { slug, title: found?.title ?? slug, collection: found?.collection ?? '' };
        }),
        model: 'anthropic/claude-sonnet-4.5',
        tokensIn: 2400,
        tokensOut: 180,
        costUsd: '0.0042',
        // A realistic spread, not a function of how old the row is.
        latencyMs: 700 + ((conversation.id.charCodeAt(4) * 37) % 900),
        feedback: conversation.feedback ?? null,
        createdAt: new Date(at.getTime() + 4000),
      },
    ]);

    if (conversation.topic) {
      await db
        .insert(schema.conversationTags)
        .values({
          conversationId: conversation.id,
          tag: conversation.topic.toLowerCase(),
          source: 'agent',
        })
        .onConflictDoNothing();
    }
  }

  await db.insert(schema.gaps).values(
    GAPS.map((gap, index) => ({
      ...gap,
      firstAskedAt: minutes(60 * 24 * (10 - index)),
      lastAskedAt: minutes(60 * (index + 2)),
    })),
  );

  await db.insert(schema.changelogEntries).values(CHANGELOG);
  await db.insert(schema.roadmapItems).values(ROADMAP);

  await db.insert(schema.searches).values(
    SEARCHES.flatMap(([query, results], index) =>
      Array.from({ length: Math.max(1, 8 - index) }, (_, n) => ({
        id: `sch_${index}_${n}`,
        query,
        resultsCount: results,
        source: n % 2 === 0 ? 'help_center' : 'widget',
        contactId: PEOPLE[n % PEOPLE.length].id,
        createdAt: minutes(n * 90 + index * 30),
      })),
    ),
  );

  await db.insert(schema.articleRatings).values([
    { id: 'rat_1', slug: 'billing/exporting-invoices', contactId: 'con_ada', value: 'up' },
    { id: 'rat_2', slug: 'approvals/approval-rules', contactId: 'con_cy', value: 'up' },
    { id: 'rat_3', slug: 'security/single-sign-on', contactId: 'con_el', value: 'down' },
  ]);

  // Enough days of spend that the reports chart has a shape.
  const spend = [];
  for (let day = 0; day < 30; day++) {
    const date = new Date(Date.now() - day * 86_400_000);
    spend.push({
      id: `spn_${day}`,
      day: date.toISOString().slice(0, 10),
      kind: 'chat',
      model: 'anthropic/claude-sonnet-4.5',
      tokensIn: 18_000 + day * 400,
      tokensOut: 1400 + day * 30,
      costUsd: (0.14 + Math.sin(day / 3) * 0.06).toFixed(6),
    });
  }
  await db.insert(schema.spendLedger).values(spend);

  await db.insert(schema.evalRuns).values({
    id: 'evl_1',
    ref: 'v3.2.0',
    score: 86,
    passed: 12,
    weak: 2,
    failed: 1,
    costUsd: '0.1840',
    medianMs: 940,
    cases: [
      {
        id: 'export',
        question: 'How do I export invoices?',
        verdict: 'pass',
        answer: 'Open Billing, then Invoices, then Export.',
        cited: 'billing/exporting-invoices',
        expected: 'billing/exporting-invoices',
        ms: 880,
      },
      {
        id: 'scim',
        question: 'Do you support SCIM?',
        verdict: 'fail',
        answer: 'Ridgeline supports SAML and OIDC on Business.',
        cited: 'security/single-sign-on',
        expected: null,
        ms: 1020,
        reason: 'Answered a question the docs do not cover instead of saying so.',
      },
      {
        id: 'roles',
        question: 'Who can see every expense?',
        verdict: 'weak',
        answer: 'Finance and admins.',
        cited: 'security/roles-and-permissions',
        expected: 'security/roles-and-permissions',
        ms: 910,
      },
    ],
    createdAt: minutes(180),
  });

  await db.insert(schema.surveyResponses).values(
    [10, 9, 9, 8, 7, 10, 6, 9, 5, 10].map((score, index) => ({
      id: `srv_${index}`,
      surveyId: 'nps-q3',
      kind: 'nps',
      score,
      comment:
        index === 0
          ? 'The receipt scanner alone saves me an hour a month.'
          : index === 6
            ? 'Approvals are still fiddly on mobile.'
            : null,
      contactId: PEOPLE[index % PEOPLE.length].id,
      createdAt: minutes(index * 200),
    })),
  );

  await db.insert(schema.engageImpressions).values(
    ['seen', 'seen', 'seen', 'clicked', 'completed', 'dismissed'].map((state, index) => ({
      id: `imp_${index}`,
      engagementId: 'welcome-tour',
      contactId: PEOPLE[index % PEOPLE.length].id,
      state,
      step: state === 'completed' ? 3 : 1,
      url: '/app/expenses',
      createdAt: minutes(index * 120),
    })),
  );

  return handle;
}

export { ARTICLES, PRODUCT };
