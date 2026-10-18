/**
 * Demo content, so every screen in the playground has something on it.
 *
 * A real install does none of this. Articles come from the repo (that part is
 * real — `readKnowledgeBase` + `indexArticles` is exactly what `helpwell sync`
 * runs); everything else here stands in for a few weeks of actual use.
 *
 * Every write is idempotent: fixed ids plus `onConflictDoNothing`, so booting
 * twice against a persistent database changes nothing and never duplicates.
 * That matters because `next dev` can restart this module at any time.
 *
 * Those fixed ids all begin `<prefix>_0seed…`, and the leading zero is doing
 * real work. A HelpWell id starts with a base36 millisecond timestamp, which is
 * what lets the dashboard say `ORDER BY id DESC` and mean "newest first". That
 * timestamp always begins with a letter for any date this century, so starting
 * a seeded id with a digit puts all of this below anything created while the
 * playground is running — a conversation you have with the widget lands at the
 * top of the dashboard, where you would look for it.
 */

import { readKnowledgeBase } from '@helpwell/core/content';
import { type Db, schema } from '@helpwell/core/db';
import { createForm, getForm } from '@helpwell/core/repos';
import { indexArticles, indexCollections } from '@helpwell/core/search';
import { SettingsStore } from '@helpwell/core/settings';
import { ADA, DOCS_DIR } from './config';
import { API_PATH } from './paths';

const DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);
const dayString = (n: number): string => daysAgo(n).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ people */

/**
 * Ada already exists here before she ever signs in, the way a real customer
 * would: she has used the widget anonymously and been identified before.
 *
 * `externalId` must equal the `id` claim the identify token carries (ADA.id in
 * lib/config.ts), because `upsertIdentifiedContact` matches on external id
 * first — get it wrong and signing in creates a second Ada instead of
 * recognising this one.
 */
const ADA_CONTACT_ID = 'con_0seedada00000001';

interface SeedContact {
  id: string;
  externalId: string | null;
  email: string | null;
  name: string | null;
  identified: boolean;
  attributes: Record<string, unknown>;
  seenDaysAgo: number;
}

const CONTACTS: SeedContact[] = [
  {
    id: ADA_CONTACT_ID,
    externalId: ADA.id,
    email: ADA.email,
    name: ADA.name,
    identified: true,
    attributes: {
      plan: ADA.plan,
      role: ADA.role,
      workspace: ADA.workspace,
      seats: ADA.seats,
      cardFeed: ADA.cardFeed,
      accounting: ADA.accounting,
    },
    seenDaysAgo: 0,
  },
  {
    id: 'con_0seedmarco0000001',
    externalId: 'usr_marco_bellini',
    email: 'marco@fenwick.example',
    name: 'Marco Bellini',
    identified: true,
    attributes: { plan: 'Team', role: 'Finance', workspace: 'Fenwick & Co', seats: 14 },
    seenDaysAgo: 1,
  },
  {
    id: 'con_0seedpriya0000001',
    externalId: 'usr_priya_raman',
    email: 'priya@lumen.example',
    name: 'Priya Raman',
    identified: true,
    attributes: { plan: 'Business', role: 'Manager', workspace: 'Lumen Health', seats: 120 },
    seenDaysAgo: 2,
  },
  {
    id: 'con_0seedtom000000001',
    externalId: 'usr_tom_alvarez',
    email: 'tom@northwind.example',
    name: 'Tom Alvarez',
    identified: true,
    attributes: { plan: 'Business', role: 'Member', workspace: 'Northwind Labs', seats: 48 },
    seenDaysAgo: 3,
  },
  {
    id: 'con_0seedjules0000001',
    externalId: 'usr_jules_meyer',
    email: 'jules@harbourside.example',
    name: 'Jules Meyer',
    identified: true,
    attributes: { plan: 'Team', role: 'Admin', workspace: 'Harbourside', seats: 9 },
    seenDaysAgo: 4,
  },
  {
    id: 'con_0seedsofia0000001',
    externalId: 'usr_sofia_duarte',
    email: 'sofia@lumen.example',
    name: 'Sofia Duarte',
    identified: true,
    attributes: { plan: 'Business', role: 'Finance', workspace: 'Lumen Health', seats: 120 },
    seenDaysAgo: 5,
  },
  {
    id: 'con_0seednina00000001',
    externalId: 'usr_nina_kowalski',
    email: 'nina@fenwick.example',
    name: 'Nina Kowalski',
    identified: true,
    attributes: { plan: 'Team', role: 'Member', workspace: 'Fenwick & Co', seats: 14 },
    seenDaysAgo: 6,
  },
  {
    id: 'con_0seedhassan000001',
    externalId: 'usr_hassan_mir',
    email: 'hassan@harbourside.example',
    name: 'Hassan Mir',
    identified: true,
    attributes: { plan: 'Team', role: 'Manager', workspace: 'Harbourside', seats: 9 },
    seenDaysAgo: 7,
  },
  {
    id: 'con_0seedanon00000001',
    externalId: null,
    email: null,
    name: null,
    identified: false,
    attributes: {},
    seenDaysAgo: 1,
  },
  {
    id: 'con_0seedanon00000002',
    externalId: null,
    email: null,
    name: null,
    identified: false,
    attributes: {},
    seenDaysAgo: 3,
  },
  {
    id: 'con_0seedanon00000003',
    externalId: null,
    email: null,
    name: null,
    identified: false,
    attributes: {},
    seenDaysAgo: 8,
  },
  {
    id: 'con_0seedanon00000004',
    externalId: null,
    email: null,
    name: null,
    identified: false,
    attributes: {},
    seenDaysAgo: 12,
  },
];

/* ------------------------------------------------------------- engagements */

/**
 * The engage definitions live in settings, not in a table, in the shape the
 * dashboard's Engage editor writes (docs/engage.md): every message is a list
 * of blocks, and who, where and when are `targeting`, `triggers` (up to
 * five; whichever fires first wins) and `frequency`. Each one is scoped so
 * they do not stack on top of each other: the tour on the dashboard, the
 * "what's new" carousel on /pricing, the banner with its countdown everywhere
 * except /checkout, the survey on /settings for signed-in visitors only, and
 * a short greeting by name on the dashboard, once the tour has had its turn.
 *
 * The tour's targets are real selectors on the Ridgeline dashboard — see the
 * `data-tour` attributes in `app/page.tsx`.
 */
const text = (markdown: string) => ({ type: 'text', markdown });

/** The NPS question's id. The seeded answers further down are stored against it. */
const NPS_QUESTION_ID = 'recommend';

const ENGAGEMENTS = [
  {
    id: 'tour-first-expense',
    kind: 'tour',
    name: 'Your first expense',
    enabled: true,
    targeting: { audience: 'all', pages: { include: ['/'], exclude: [] } },
    triggers: [{ type: 'delay', seconds: 1 }],
    frequency: 'once',
    tour: {
      placement: 'auto',
      spotlight: true,
      showProgress: true,
      allowSkip: true,
      steps: [
        {
          target: '[data-tour="new-expense"]',
          placement: 'bottom',
          blocks: [
            text(
              '**File anything from here**\n\nOr press N. Drop a receipt in and the amount, date and merchant fill themselves.',
            ),
          ],
        },
        {
          target: '[data-tour="status"]',
          placement: 'right',
          blocks: [
            text(
              '**Status is the whole story**\n\nDraft, Pending, Approved, Exported, Reimbursed. It only ever moves forward.',
            ),
          ],
        },
        {
          target: '[data-tour="export"]',
          placement: 'left',
          blocks: [
            text(
              '**Close the month here**\n\nApproved expenses only. Nothing in Draft or Pending ever leaves Ridgeline.',
            ),
          ],
        },
      ],
    },
  },
  {
    // Three slides: a carousel with dots, Back and Next. Only the last slide
    // carries buttons, because that is where the visitor decides.
    id: 'modal-whats-new',
    kind: 'modal',
    name: "What's new in 4.12",
    enabled: true,
    targeting: { audience: 'all', pages: { include: ['/pricing'], exclude: [] } },
    // The carousel waits a moment, or comes as soon as the visitor scrolls
    // into the plans: whichever happens first.
    triggers: [
      { type: 'delay', seconds: 3 },
      { type: 'scroll', percent: 40 },
    ],
    frequency: 'once',
    priority: 10,
    modal: {
      size: 'medium',
      progress: 'dots',
      slides: [
        {
          blocks: [
            text(
              "## Tiered mileage rates\n\nSet a higher rate for the first miles of a tax year and a lower one after it. Ridgeline tracks each person's running total and switches at the threshold, so nobody has to remember.",
            ),
          ],
        },
        {
          blocks: [
            text(
              '## Receipts by email\n\nForward a receipt to **receipts@ridgeline.app** from a verified address. It is read, filed and matched to its card transaction, usually within a minute.',
            ),
          ],
        },
        {
          blocks: [
            text(
              '## Per-diem allowances on Business\n\nAllowances by destination, part-day rules and the provided-meal reduction, all under **Settings → Per diem**.',
            ),
            {
              type: 'buttons',
              buttons: [
                {
                  label: 'Read the mileage guide',
                  action: 'article',
                  value: 'expenses/mileage-and-per-diem',
                },
                { label: 'Not now', action: 'dismiss', style: 'secondary' },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    id: 'banner-period-close',
    kind: 'banner',
    name: 'Period close reminder',
    enabled: true,
    dismissible: true,
    targeting: {
      audience: 'all',
      pages: { include: ['**'], exclude: ['/checkout', '/checkout/**'] },
    },
    triggers: [{ type: 'load' }],
    frequency: { everyDays: 3 },
    banner: {
      position: 'top',
      style: 'inline',
      tone: 'accent',
      // Counts down to the close, and goes by itself when it has passed.
      countdown: { until: nextFridayEvening(), onEnd: 'hide' },
      blocks: [
        text(
          '**The period closes on Friday.** Anything still in Draft after that has to be refiled against the next one. Closing in',
        ),
        {
          type: 'buttons',
          buttons: [
            {
              label: 'What closing does',
              action: 'url',
              value: '/help/admin-and-billing/accounting-integrations',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'survey-nps',
    kind: 'survey',
    name: 'NPS',
    enabled: true,
    targeting: { audience: 'identified', pages: { include: ['/settings'], exclude: [] } },
    // Eight seconds on the page, or on the way out: whichever comes first.
    triggers: [{ type: 'delay', seconds: 8 }, { type: 'exit' }],
    frequency: 'once',
    survey: {
      placement: 'corner',
      theme: 'brand',
      questions: [
        {
          id: NPS_QUESTION_ID,
          kind: 'nps',
          prompt: 'How likely are you to recommend Ridgeline to a colleague?',
          lowLabel: 'Not likely',
          highLabel: 'Very likely',
          followUp: { enabled: true, prompt: 'What made you pick that number?', when: 'always' },
        },
      ],
      thankYou: [text('Thank you. Every answer is read by the people who build Ridgeline.')],
    },
  },
  {
    // A short greeting, written like a chat message and personalised with
    // the contact's own fields (docs/engage.md, Personalisation): "there" when
    // the first name is not known. After the tour, on the same page.
    id: 'hello-by-name',
    kind: 'modal',
    name: 'Hello by name',
    enabled: true,
    targeting: { audience: 'identified', pages: { include: ['/'], exclude: [] } },
    triggers: [
      { type: 'time_on_page', seconds: 25 },
      { type: 'inactivity', seconds: 15 },
    ],
    frequency: 'once',
    priority: 1,
    modal: {
      size: 'small',
      slides: [
        {
          blocks: [
            text(
              'Hi {{first_name|there}}, want a hand setting up approvals for {{workspace|your team}}? It takes about two minutes.',
            ),
            {
              type: 'buttons',
              buttons: [
                { label: 'Ask a question', action: 'chat', value: '' },
                { label: 'Not now', action: 'dismiss', style: 'secondary' },
              ],
            },
          ],
        },
      ],
    },
  },
];

/** Friday at six in the evening, UTC: this week's, or next week's once it has passed. */
function nextFridayEvening(now = new Date()): string {
  const at = new Date(now);
  at.setUTCHours(18, 0, 0, 0);
  at.setUTCDate(at.getUTCDate() + ((5 - at.getUTCDay() + 7) % 7));
  if (at.getTime() <= now.getTime()) at.setUTCDate(at.getUTCDate() + 7);
  return at.toISOString();
}

/* ------------------------------------------------------------------- forms */

/**
 * One form, a giveaway, so the Forms pages and the giveaway draw have
 * something to show. It sits on the widget's Home tab (the `form` block in
 * `widget.home.blocks` below) and in the /pricing page as an embed.
 *
 * It goes through `createForm`, the same call the dashboard's builder and the
 * admin API make, so it is checked and versioned exactly like a form made by
 * hand. The giveaway template supplies the fields and the share settings;
 * this only changes what makes it Ridgeline's.
 */
export const GIVEAWAY_FORM_ID = 'business-giveaway';

async function seedForms(db: Db): Promise<void> {
  if (await getForm(db, GIVEAWAY_FORM_ID)) return;
  await createForm(
    db,
    {
      id: GIVEAWAY_FORM_ID,
      name: 'Win a year of Business',
      template: 'giveaway',
      enabled: true,
      definition: {
        content: {
          blocks: [
            text(
              '## Win a year of Ridgeline Business\n\nFor your whole team, up to 50 people. Enter with your work email, then share your link for bonus entries.',
            ),
          ],
          footer: [text('No purchase necessary. [Official rules](/giveaway-rules).')],
        },
        layout: { columns: 1 },
        style: { buttonLabel: 'Enter the giveaway' },
        success: {
          action: 'message',
          blocks: [
            text(
              "## You're in\n\nShare your link: every colleague who enters through it earns you three more entries.",
            ),
          ],
        },
        giveaway: {
          prize: 'A year of Ridgeline Business for up to 50 people',
          rulesUrl: '/giveaway-rules',
          endsAt: new Date(Date.now() + 30 * DAY).toISOString(),
          eligibility: 'Open to Ridgeline workspaces, one entry per person, 18 and over.',
          maxEntries: 20,
          referralEntries: 3,
          actions: [
            {
              id: 'read-changelog',
              kind: 'visit',
              label: 'Read what shipped this month',
              url: '/help/changelog',
              entries: 1,
            },
          ],
        },
        // The demo people all have .example addresses, which have no mail
        // server, and a playground may be running without a network at all.
        // Everything else in the bot checks stays on.
        abuse: { checkMx: false },
        tags: ['giveaway', 'business-giveaway'],
      },
    },
    { note: 'Seeded by the playground' },
  );
}

/* ---------------------------------------------------------------- settings */

async function seedSettings(db: Db): Promise<boolean> {
  const store = new SettingsStore(db);

  // Only on a genuinely fresh database: re-writing this on every boot would
  // throw away anything changed in the dashboard's Settings screen.
  const existing = await db.select({ id: schema.settings.id }).from(schema.settings).limit(1);
  if (existing.length > 0) return false;

  await store.replace({
    product: {
      name: 'Ridgeline',
      appUrl: 'http://localhost:3000',
      supportEmail: 'support@ridgeline.app',
      timezone: 'Europe/London',
      locale: 'en',
    },
    helpCenter: {
      subpath: '/help',
      theme: { accent: '#1F6F5C', hero: 'glow', underCards: true },
      search: true,
      askAgent: true,
      ratings: true,
      readingTime: true,
      sitemap: true,
      llmsTxt: true,
    },
    agent: {
      name: 'Fern',
      tone: 'Warm, brief, no exclamation marks. Answer first, caveats after.',
      introduceAsAi: true,
    },
    widget: {
      position: 'bottom-right',
      appearance: { accent: '#1F6F5C', pattern: 'dots', radius: 20 },
      // The one rule this playground exists to demonstrate: /checkout is a page
      // Ridgeline does not want a support bubble on, so the widget refuses to
      // mount there. Everything else gets it.
      displayRules: {
        include: ['**'],
        exclude: ['/checkout', '/checkout/**'],
        audience: 'all',
        devices: ['desktop', 'mobile'],
      },
      preChat: { when: 'unknown_only', timing: 'before', requireEmail: false },
      // Every kind of Home block, so the tab shows all of them: the giveaway
      // form is drawn by the widget's forms code, the rest by the widget.
      home: {
        blocks: [
          { type: 'search' },
          { type: 'conversation' },
          { type: 'newConversation' },
          {
            type: 'articles',
            title: 'Popular articles',
            slugs: [
              'expenses/attach-and-match-receipts',
              'approvals/approval-policies',
              'expenses/mileage-and-per-diem',
            ],
            limit: 3,
          },
          { type: 'form', formId: GIVEAWAY_FORM_ID },
          { type: 'updates', title: "What's new", count: 3 },
          { type: 'status' },
          {
            type: 'links',
            title: 'More from Ridgeline',
            items: [
              { label: 'Help center', url: '/help', icon: 'help' },
              { label: 'Roadmap', url: '/help/roadmap', icon: 'roadmap' },
              { label: 'Plans and pricing', url: '/pricing', icon: 'external' },
            ],
          },
          {
            type: 'card',
            title: 'Close the month in a day',
            body: 'Approved expenses go straight to Xero, QuickBooks or NetSuite, receipts attached.',
            cta: {
              label: 'How the export works',
              url: '/help/admin-and-billing/accounting-integrations',
            },
          },
        ],
      },
      // Set by hand, because the playground has no status page to read. The
      // dashboard's Widget settings switch it to a status page URL.
      status: { mode: 'manual', level: 'operational', message: '' },
    },
    changelog: {
      source: 'manual',
      publicPage: true,
      widgetTab: true,
      roadmap: { enabled: true, whoCanSubmit: 'identified' },
    },
    engage: { enabled: true, engagements: ENGAGEMENTS },
    data: { retentionMonths: 12 },
  });

  return true;
}

/* --------------------------------------------------------- knowledge base */

async function seedKnowledgeBase(db: Db): Promise<number> {
  // The real sync path, unchanged: Markdown in the repo is the source of truth.
  // Relative image and video links are rewritten to where this playground's
  // API serves them, exactly as `helpwell sync` does.
  const { articles, collections } = readKnowledgeBase(DOCS_DIR, { media: { apiPath: API_PATH } });
  await indexArticles(db, articles);
  await indexCollections(db, collections);
  return articles.length;
}

/* ----------------------------------------------------------------- people */

async function seedContacts(db: Db): Promise<void> {
  await db
    .insert(schema.contacts)
    .values(
      CONTACTS.map((contact) => ({
        id: contact.id,
        externalId: contact.externalId,
        email: contact.email,
        name: contact.name,
        identified: contact.identified,
        attributes: contact.attributes,
        source: 'widget' as const,
        consent: contact.identified ? ('granted' as const) : ('unknown' as const),
        locale: 'en',
        timezone: 'Europe/London',
        firstSeenAt: daysAgo(contact.seenDaysAgo + 40),
        lastSeenAt: daysAgo(contact.seenDaysAgo),
        createdAt: daysAgo(contact.seenDaysAgo + 40),
        updatedAt: daysAgo(contact.seenDaysAgo),
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(schema.contactTags)
    .values([
      { contactId: ADA_CONTACT_ID, tag: 'design-partner' },
      { contactId: ADA_CONTACT_ID, tag: 'business-plan' },
      { contactId: 'con_0seedmarco0000001', tag: 'accounting-export' },
      { contactId: 'con_0seedpriya0000001', tag: 'enterprise-trial' },
    ])
    .onConflictDoNothing();
}

/* ---------------------------------------------------------- conversations */

interface SeedMessage {
  id: string;
  role: 'customer' | 'agent';
  body: string;
  citations?: { slug: string; title: string; collection: string }[];
  feedback?: 'helpful' | 'not_helpful';
  minutesAfter: number;
}

interface SeedConversation {
  id: string;
  contactId: string;
  status: 'resolved' | 'unresolved';
  topic: string | null;
  pageUrl: string;
  rating: 'sad' | 'indifferent' | 'happy' | 'love' | null;
  reviewed: boolean;
  daysAgo: number;
  tags: string[];
  messages: SeedMessage[];
}

const CONVERSATIONS: SeedConversation[] = [
  {
    id: 'cnv_0seed000000000001',
    contactId: 'con_0seedtom000000001',
    status: 'resolved',
    topic: 'expenses',
    pageUrl: 'http://localhost:3000/',
    rating: 'happy',
    reviewed: true,
    daysAgo: 2,
    tags: ['receipts', 'card-feed'],
    messages: [
      {
        id: 'msg_0seed000000000101',
        role: 'customer',
        body: 'A charge came in from the company card but my receipt is sitting in my email. How do I get them together?',
        minutesAfter: 0,
      },
      {
        id: 'msg_0seed000000000102',
        role: 'agent',
        body: [
          'Forward the email to **receipts@ridgeline.app** from the address you sign in with. Ridgeline reads the amount, date and merchant off it and matches it against the card transaction on its own — usually within a minute.',
          '',
          'If it lands on the wrong transaction, open the expense, use **Match to…** from the overflow menu, and pick the right one. If no transaction is coming at all (personal card, or actual cash), use **Mark as cash** instead and it becomes reimbursable.',
          '',
          'One catch: mail from an address Ridgeline does not recognise is dropped silently. If you forward from your phone rather than your work account, add that address at **Settings → Profile → Verified addresses** first.',
        ].join('\n'),
        citations: [
          {
            slug: 'expenses/attach-and-match-receipts',
            title: 'Attach and match receipts',
            collection: 'expenses',
          },
          {
            slug: 'getting-started/connect-a-card',
            title: 'Connect a company card',
            collection: 'getting-started',
          },
        ],
        feedback: 'helpful',
        minutesAfter: 1,
      },
    ],
  },
  {
    id: 'cnv_0seed000000000002',
    contactId: 'con_0seedpriya0000001',
    status: 'resolved',
    topic: 'approvals',
    pageUrl: 'http://localhost:3000/',
    rating: 'love',
    reviewed: true,
    daysAgo: 4,
    tags: ['approvals', 'policy'],
    messages: [
      {
        id: 'msg_0seed000000000201',
        role: 'customer',
        body: 'My managers are getting pinged about £3 coffees. Can I make small things approve themselves?',
        minutesAfter: 0,
      },
      {
        id: 'msg_0seed000000000202',
        role: 'agent',
        body: [
          'Yes — that is what an auto-approve policy is for. **Settings → Approvals → Policies**, add a rule:',
          '',
          '- **When**: amount under your threshold, receipt attached, category in Travel, Meals or Supplies',
          '- **Then**: auto-approve',
          '',
          'Put it above your general "require approval" rule, because the first rule that matches wins.',
          '',
          'Before you save it, hit **Dry run**. It replays the last 90 days through the rule and tells you how many expenses would have skipped a human. That number is usually the argument for raising the threshold rather than lowering it.',
        ].join('\n'),
        citations: [
          {
            slug: 'approvals/approval-policies',
            title: 'Approval policies and limits',
            collection: 'approvals',
          },
          {
            slug: 'approvals/how-approvals-work',
            title: 'How approvals work',
            collection: 'approvals',
          },
        ],
        feedback: 'helpful',
        minutesAfter: 1,
      },
      {
        id: 'msg_0seed000000000203',
        role: 'customer',
        body: 'And if I change the rule, does it affect things already waiting?',
        minutesAfter: 3,
      },
      {
        id: 'msg_0seed000000000204',
        role: 'agent',
        body: 'No. A policy change applies to expenses submitted after the change; anything already Pending keeps the approval path it started with. Same reason moving somebody to a new manager does not move their live approvals — an expense that changes approver mid-flight is an expense that gets lost.',
        citations: [
          {
            slug: 'approvals/how-approvals-work',
            title: 'How approvals work',
            collection: 'approvals',
          },
        ],
        minutesAfter: 4,
      },
    ],
  },
  {
    id: 'cnv_0seed000000000003',
    contactId: ADA_CONTACT_ID,
    status: 'resolved',
    topic: 'admin-and-billing',
    pageUrl: 'http://localhost:3000/settings',
    rating: 'happy',
    reviewed: false,
    daysAgo: 1,
    tags: ['sso'],
    messages: [
      {
        id: 'msg_0seed000000000301',
        role: 'customer',
        body: 'Our Okta test is failing with saml_audience_mismatch. What am I looking at?',
        minutesAfter: 0,
      },
      {
        id: 'msg_0seed000000000302',
        role: 'agent',
        body: [
          'That code means the Entity ID / Audience configured in Okta is not byte-for-byte the one Ridgeline expects. It should be exactly:',
          '',
          '```',
          'https://app.ridgeline.app/auth/saml/metadata',
          '```',
          '',
          'In practice it is a trailing slash nine times out of ten. Second most common is the ACS URL pasted into the Audience field.',
          '',
          'Nobody is locked out while you fix it — the connection stays off until the test passes, and **Require SSO** is a separate switch after that.',
        ].join('\n'),
        citations: [
          {
            slug: 'admin-and-billing/single-sign-on',
            title: 'Single sign-on with SAML',
            collection: 'admin-and-billing',
          },
        ],
        feedback: 'helpful',
        minutesAfter: 2,
      },
    ],
  },
  {
    id: 'cnv_0seed000000000004',
    contactId: 'con_0seedanon00000001',
    status: 'unresolved',
    topic: 'expenses',
    pageUrl: 'http://localhost:3000/help/expenses/mileage-and-per-diem',
    rating: 'indifferent',
    reviewed: false,
    daysAgo: 3,
    tags: ['per-diem'],
    messages: [
      {
        id: 'msg_0seed000000000401',
        role: 'customer',
        body: 'Can per-diem rates differ by city inside the same country? London and Hull are not the same trip.',
        minutesAfter: 0,
      },
      {
        id: 'msg_0seed000000000402',
        role: 'agent',
        body: [
          'The docs only describe per-diem allowances set by destination country, not by city within one, so I do not want to tell you it works when I cannot point at the page that says so.',
          '',
          "I've flagged this for the team — it shows up on their Gaps list with the other questions the docs do not answer yet.",
          '',
          'What the docs do cover: allowances by destination, part-day rules, and the provided-meal reduction. That is at **Settings → Per diem**.',
        ].join('\n'),
        citations: [
          {
            slug: 'expenses/mileage-and-per-diem',
            title: 'Mileage and per diem',
            collection: 'expenses',
          },
        ],
        feedback: 'not_helpful',
        minutesAfter: 1,
      },
    ],
  },
  {
    id: 'cnv_0seed000000000005',
    contactId: 'con_0seedjules0000001',
    status: 'unresolved',
    topic: null,
    pageUrl: 'http://localhost:3000/pricing',
    rating: null,
    reviewed: false,
    daysAgo: 6,
    tags: ['migration'],
    messages: [
      {
        id: 'msg_0seed000000000501',
        role: 'customer',
        body: 'We are moving off Expensify. Can we bulk-import three years of historical expenses so the history is not split across two tools?',
        minutesAfter: 0,
      },
      {
        id: 'msg_0seed000000000502',
        role: 'agent',
        body: [
          'There is nothing in the help center about importing historical expenses, so I am not going to guess at a path that might not exist.',
          '',
          'What is documented is a CSV import for **card transactions** at **Settings → Cards → Import**, which is a different thing — it brings in the card side, not filed expenses with their receipts and approvals.',
          '',
          "I've marked this unresolved so somebody on the team sees it.",
        ].join('\n'),
        citations: [
          {
            slug: 'getting-started/connect-a-card',
            title: 'Connect a company card',
            collection: 'getting-started',
          },
        ],
        minutesAfter: 2,
      },
    ],
  },
];

async function seedConversations(db: Db): Promise<void> {
  await db
    .insert(schema.conversations)
    .values(
      CONVERSATIONS.map((conversation) => {
        const startedAt = daysAgo(conversation.daysAgo);
        const last = conversation.messages[conversation.messages.length - 1];
        return {
          id: conversation.id,
          contactId: conversation.contactId,
          status: conversation.status,
          topic: conversation.topic,
          pageUrl: conversation.pageUrl,
          rating: conversation.rating,
          reviewedAt: conversation.reviewed ? startedAt : null,
          messageCount: conversation.messages.length,
          costUsd: (conversation.messages.length * 0.0012).toFixed(6),
          startedAt,
          lastMessageAt: new Date(startedAt.getTime() + (last?.minutesAfter ?? 0) * 60_000),
        };
      }),
    )
    .onConflictDoNothing();

  await db
    .insert(schema.conversationTags)
    .values(
      CONVERSATIONS.flatMap((conversation) =>
        conversation.tags.map((tag) => ({
          conversationId: conversation.id,
          tag,
          source: 'agent',
        })),
      ),
    )
    .onConflictDoNothing();

  await db
    .insert(schema.messages)
    .values(
      CONVERSATIONS.flatMap((conversation) => {
        const startedAt = daysAgo(conversation.daysAgo);
        return conversation.messages.map((message) => ({
          id: message.id,
          conversationId: conversation.id,
          role: message.role,
          body: message.body,
          citations: message.citations ?? [],
          toolCalls: [],
          feedback: message.feedback ?? null,
          model: message.role === 'agent' ? 'anthropic/claude-sonnet-4.5' : null,
          tokensIn: message.role === 'agent' ? 1840 : null,
          tokensOut: message.role === 'agent' ? 260 : null,
          costUsd: message.role === 'agent' ? '0.001200' : null,
          latencyMs: message.role === 'agent' ? 2300 : null,
          createdAt: new Date(startedAt.getTime() + message.minutesAfter * 60_000),
        }));
      }),
    )
    .onConflictDoNothing();
}

/* ------------------------------------------------------------------- gaps */

async function seedGaps(db: Db): Promise<void> {
  await db
    .insert(schema.gaps)
    .values([
      {
        id: 'gap_0seed000000000001',
        question: 'Can per-diem rates differ by city inside the same country?',
        variants: [
          'Do you support city-level per diem?',
          'London vs Hull per diem rate — can I set both?',
          'Per diem by region rather than country',
        ],
        asks: 4,
        status: 'new' as const,
        suggestedCollection: 'expenses',
        suggestedTitle: 'Per-diem rates by city',
        firstAskedAt: daysAgo(19),
        lastAskedAt: daysAgo(3),
      },
      {
        id: 'gap_0seed000000000002',
        question: 'Can we bulk-import historical expenses from another tool?',
        variants: [
          'Migrating from Expensify — can we bring history?',
          'Import three years of old expense reports',
        ],
        asks: 3,
        status: 'new' as const,
        suggestedCollection: 'getting-started',
        suggestedTitle: 'Import history from another expense tool',
        firstAskedAt: daysAgo(16),
        lastAskedAt: daysAgo(6),
      },
      {
        id: 'gap_0seed000000000003',
        question: 'Is there a public API for creating expenses from our own systems?',
        variants: ['Do you have a REST API?', 'Can I POST an expense from a script?'],
        asks: 2,
        status: 'drafted' as const,
        suggestedCollection: 'admin-and-billing',
        suggestedTitle: 'The Ridgeline API',
        firstAskedAt: daysAgo(11),
        lastAskedAt: daysAgo(5),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(schema.gapConversations)
    .values([
      {
        gapId: 'gap_0seed000000000001',
        conversationId: 'cnv_0seed000000000004',
        askedAs: 'Can per-diem rates differ by city inside the same country?',
      },
      {
        gapId: 'gap_0seed000000000002',
        conversationId: 'cnv_0seed000000000005',
        askedAs:
          'We are moving off Expensify. Can we bulk-import three years of historical expenses?',
      },
    ])
    .onConflictDoNothing();
}

/* --------------------------------------------------------------- searches */

async function seedSearches(db: Db): Promise<void> {
  const rows: {
    query: string;
    resultsCount: number;
    source: 'help_center' | 'widget';
    contactId: string | null;
    daysAgo: number;
  }[] = [
    {
      query: 'export to netsuite',
      resultsCount: 3,
      source: 'help_center',
      contactId: ADA_CONTACT_ID,
      daysAgo: 1,
    },
    {
      query: 'mileage rate',
      resultsCount: 2,
      source: 'widget',
      contactId: 'con_0seedtom000000001',
      daysAgo: 2,
    },
    {
      query: 'saml_audience_mismatch',
      resultsCount: 1,
      source: 'help_center',
      contactId: ADA_CONTACT_ID,
      daysAgo: 1,
    },
    {
      query: 'forward receipt by email',
      resultsCount: 2,
      source: 'widget',
      contactId: 'con_0seedanon00000002',
      daysAgo: 3,
    },
    {
      query: 'auto approve small expenses',
      resultsCount: 2,
      source: 'help_center',
      contactId: 'con_0seedpriya0000001',
      daysAgo: 4,
    },
    {
      query: 'cancel plan',
      resultsCount: 1,
      source: 'help_center',
      contactId: 'con_0seedjules0000001',
      daysAgo: 5,
    },
    {
      query: 'seat proration',
      resultsCount: 1,
      source: 'widget',
      contactId: 'con_0seedmarco0000001',
      daysAgo: 7,
    },
    // The interesting one: nothing matched, which is what feeds the Gaps list.
    {
      query: 'per diem by city',
      resultsCount: 0,
      source: 'help_center',
      contactId: 'con_0seedanon00000001',
      daysAgo: 3,
    },
  ];

  await db
    .insert(schema.searches)
    .values(
      rows.map((row, index) => ({
        id: `sch_0seed00000000${String(index).padStart(4, '0')}`,
        query: row.query,
        resultsCount: row.resultsCount,
        source: row.source,
        contactId: row.contactId,
        createdAt: daysAgo(row.daysAgo),
      })),
    )
    .onConflictDoNothing();
}

/* -------------------------------------------------------------- changelog */

async function seedChangelog(db: Db): Promise<void> {
  await db
    .insert(schema.changelogEntries)
    .values([
      {
        id: 'chg_0seed000000000001',
        version: '4.12',
        title: 'Tiered mileage rates',
        summary:
          'Mileage now switches to the lower statutory rate automatically once somebody crosses the threshold for the tax year.',
        body: [
          '### New',
          '',
          '- **Tiered mileage.** Set a higher rate for the first N units of a tax year and a lower one after it. Ridgeline tracks each person’s running total and switches at the threshold, so nobody has to remember.',
          '- Mileage rates now carry an **effective date**. Changing a rate no longer rewrites what was already claimed.',
          '',
          '### Fixed',
          '',
          '- Return journeys were rounding distance twice on trips over 500 units.',
        ].join('\n'),
        tags: ['New', 'Fixed'],
        status: 'published' as const,
        publishedAt: daysAgo(3),
        createdAt: daysAgo(4),
        updatedAt: daysAgo(3),
      },
      {
        id: 'chg_0seed000000000002',
        version: '4.11',
        title: 'Receipts by email, and better matching',
        summary: 'Forward a receipt to receipts@ridgeline.app and it finds its own transaction.',
        body: [
          '### New',
          '',
          '- **receipts@ridgeline.app.** Forward from any verified address and the receipt is read, filed and matched. You get a reply within a minute saying where it landed.',
          '- Verified addresses, so you can forward from your phone’s default account.',
          '',
          '### Improved',
          '',
          '- Matching now tolerates merchants that settle up to four days late, which was the single biggest source of Unmatched rows.',
          '- Unmatched suggestions are ranked rather than alphabetical.',
        ].join('\n'),
        tags: ['New', 'Improved'],
        status: 'published' as const,
        publishedAt: daysAgo(12),
        createdAt: daysAgo(13),
        updatedAt: daysAgo(12),
      },
      {
        id: 'chg_0seed000000000003',
        version: '4.10',
        title: 'Approval policies get a dry run',
        summary:
          'See exactly what a policy would have done to the last 90 days before you turn it on.',
        body: [
          '### New',
          '',
          '- **Dry run** on every approval policy. Replays your last 90 days and shows what would have been auto-approved, what would have gained an approver, and what would have been blocked.',
          '',
          '### Improved',
          '',
          '- Bulk approve now refuses flagged expenses rather than quietly including them. Flagged expenses were the ones worth opening, and bulk approve was the reason nobody did.',
        ].join('\n'),
        tags: ['New', 'Improved'],
        status: 'published' as const,
        publishedAt: daysAgo(25),
        createdAt: daysAgo(26),
        updatedAt: daysAgo(25),
      },
      {
        id: 'chg_0seed000000000004',
        version: '4.9',
        title: 'NetSuite export',
        summary: 'Expense Report records, receipts attached, on the Business plan.',
        body: [
          '### New',
          '',
          '- **NetSuite.** Approved expenses export as Expense Report records with receipts attached. Chart-of-accounts and tax-rate mapping work the same way they do for Xero and QuickBooks.',
          '',
          '### Fixed',
          '',
          '- A partially failed export no longer rolls back the lines that succeeded. Re-running only retries the failures.',
        ].join('\n'),
        tags: ['New', 'Fixed'],
        status: 'published' as const,
        publishedAt: daysAgo(41),
        createdAt: daysAgo(42),
        updatedAt: daysAgo(41),
      },
      {
        // Left as a draft on purpose: the dashboard lists it, the public
        // changelog at /help/changelog does not.
        id: 'chg_0seed000000000005',
        version: '4.13',
        title: 'Per-diem allowances by city',
        summary: 'Still being written — the most-asked question on the Gaps list.',
        body: '### New\n\n- Per-diem allowance tables can be keyed by city as well as country.\n',
        tags: ['New'],
        status: 'draft' as const,
        publishedAt: null,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
      },
    ])
    .onConflictDoNothing();

  // A couple of reads, so the widget's unread badge is not simply "everything".
  await db
    .insert(schema.changelogReads)
    .values([
      { entryId: 'chg_0seed000000000003', contactId: ADA_CONTACT_ID, readAt: daysAgo(24) },
      { entryId: 'chg_0seed000000000004', contactId: ADA_CONTACT_ID, readAt: daysAgo(40) },
    ])
    .onConflictDoNothing();
}

/* ---------------------------------------------------------------- roadmap */

interface SeedRoadmapItem {
  id: string;
  title: string;
  body: string;
  status: 'under_review' | 'planned' | 'in_progress' | 'shipped';
  votes: number;
  changelogEntryId?: string;
  daysAgo: number;
}

const ROADMAP: SeedRoadmapItem[] = [
  {
    id: 'rmp_0seed000000000001',
    title: 'Bulk import expense history from another tool',
    body: 'Bring filed expenses, receipts and approval history across from Expensify, Concur or a CSV, so a migration does not split the record in two.',
    status: 'planned',
    votes: 9,
    daysAgo: 30,
  },
  {
    id: 'rmp_0seed000000000002',
    title: 'Xero tracking categories on export',
    body: 'Map Ridgeline projects and teams onto Xero tracking categories so departmental reporting survives the export.',
    status: 'in_progress',
    votes: 7,
    daysAgo: 44,
  },
  {
    id: 'rmp_0seed000000000003',
    title: 'Per-diem rates that vary by city',
    body: 'Allowance tables keyed by city rather than country. London and Hull are not the same trip.',
    status: 'under_review',
    votes: 6,
    daysAgo: 18,
  },
  {
    id: 'rmp_0seed000000000004',
    title: 'Approve from Slack',
    body: 'Approve or reject from the notification, with the receipt in the message, so an approval does not need a browser.',
    status: 'under_review',
    votes: 5,
    daysAgo: 12,
  },
  {
    id: 'rmp_0seed000000000005',
    title: 'Virtual card numbers per subscription',
    body: 'Issue a virtual number per vendor so a cancelled subscription is actually cancelled.',
    status: 'planned',
    votes: 4,
    daysAgo: 22,
  },
  {
    id: 'rmp_0seed000000000006',
    title: 'Tiered mileage rates',
    body: 'Higher rate for the first N units of a tax year, lower after, switched automatically.',
    status: 'shipped',
    votes: 11,
    changelogEntryId: 'chg_0seed000000000001',
    daysAgo: 60,
  },
  {
    id: 'rmp_0seed000000000007',
    title: 'Forward receipts by email',
    body: 'A mailbox that reads a forwarded receipt and matches it to a card transaction.',
    status: 'shipped',
    votes: 8,
    changelogEntryId: 'chg_0seed000000000002',
    daysAgo: 75,
  },
];

async function seedRoadmap(db: Db): Promise<void> {
  await db
    .insert(schema.roadmapItems)
    .values(
      ROADMAP.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        status: item.status,
        changelogEntryId: item.changelogEntryId ?? null,
        votesCount: item.votes,
        createdBy: ADA_CONTACT_ID,
        createdAt: daysAgo(item.daysAgo),
        updatedAt: daysAgo(Math.max(0, item.daysAgo - 5)),
      })),
    )
    .onConflictDoNothing();

  // Real vote rows, not just a number on the item. `toggleVote` recomputes the
  // count from this table, so a demo visitor clicking a vote button must not
  // find the count collapsing from 9 to 1.
  await db
    .insert(schema.roadmapVotes)
    .values(
      ROADMAP.flatMap((item) =>
        CONTACTS.slice(0, item.votes).map((contact, index) => ({
          itemId: item.id,
          contactId: contact.id,
          createdAt: daysAgo(Math.max(0, item.daysAgo - index)),
        })),
      ),
    )
    .onConflictDoNothing();
}

/* --------------------------------------------------- engage and reporting */

async function seedEngagement(db: Db): Promise<void> {
  await db
    .insert(schema.engageImpressions)
    .values([
      {
        id: 'imp_0seed000000000001',
        engagementId: 'tour-first-expense',
        contactId: ADA_CONTACT_ID,
        state: 'seen' as const,
        step: 0,
        url: '/',
        createdAt: daysAgo(9),
      },
      {
        id: 'imp_0seed000000000002',
        engagementId: 'tour-first-expense',
        contactId: ADA_CONTACT_ID,
        state: 'completed' as const,
        step: 2,
        url: '/',
        createdAt: daysAgo(9),
      },
      {
        id: 'imp_0seed000000000003',
        engagementId: 'tour-first-expense',
        contactId: 'con_0seedtom000000001',
        state: 'seen' as const,
        step: 0,
        url: '/',
        createdAt: daysAgo(8),
      },
      {
        id: 'imp_0seed000000000004',
        engagementId: 'tour-first-expense',
        contactId: 'con_0seedtom000000001',
        state: 'dismissed' as const,
        step: 1,
        url: '/',
        createdAt: daysAgo(8),
      },
      {
        id: 'imp_0seed000000000005',
        engagementId: 'banner-period-close',
        contactId: 'con_0seedpriya0000001',
        state: 'seen' as const,
        url: '/',
        createdAt: daysAgo(5),
      },
      {
        id: 'imp_0seed000000000006',
        engagementId: 'banner-period-close',
        contactId: 'con_0seedpriya0000001',
        state: 'clicked' as const,
        url: '/',
        createdAt: daysAgo(5),
      },
      {
        id: 'imp_0seed000000000007',
        engagementId: 'banner-period-close',
        contactId: 'con_0seedmarco0000001',
        state: 'seen' as const,
        url: '/',
        createdAt: daysAgo(4),
      },
      {
        id: 'imp_0seed000000000008',
        engagementId: 'survey-nps',
        contactId: 'con_0seedsofia0000001',
        state: 'seen' as const,
        url: '/',
        createdAt: daysAgo(6),
      },
      {
        id: 'imp_0seed000000000009',
        engagementId: 'survey-nps',
        contactId: 'con_0seedsofia0000001',
        state: 'completed' as const,
        url: '/',
        createdAt: daysAgo(6),
      },
      {
        id: 'imp_0seed000000000010',
        engagementId: 'survey-nps',
        contactId: 'con_0seedhassan000001',
        state: 'seen' as const,
        url: '/',
        createdAt: daysAgo(7),
      },
      {
        id: 'imp_0seed000000000011',
        engagementId: 'modal-whats-new',
        contactId: 'con_0seedmarco0000001',
        state: 'seen' as const,
        step: 0,
        url: '/pricing',
        createdAt: daysAgo(2),
      },
      {
        id: 'imp_0seed000000000012',
        engagementId: 'modal-whats-new',
        contactId: 'con_0seedmarco0000001',
        state: 'clicked' as const,
        step: 2,
        url: '/pricing',
        createdAt: daysAgo(2),
      },
      {
        id: 'imp_0seed000000000013',
        engagementId: 'modal-whats-new',
        contactId: 'con_0seedanon00000002',
        state: 'seen' as const,
        step: 0,
        url: '/pricing',
        createdAt: daysAgo(3),
      },
      {
        id: 'imp_0seed000000000014',
        engagementId: 'modal-whats-new',
        contactId: 'con_0seedanon00000002',
        state: 'dismissed' as const,
        step: 1,
        url: '/pricing',
        createdAt: daysAgo(3),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(schema.surveyResponses)
    .values([
      {
        id: 'srv_0seed000000000001',
        surveyId: 'survey-nps',
        questionId: NPS_QUESTION_ID,
        kind: 'nps' as const,
        score: 9,
        comment: 'Receipt forwarding alone saved us an afternoon a month.',
        contactId: 'con_0seedsofia0000001',
        createdAt: daysAgo(6),
      },
      {
        id: 'srv_0seed000000000002',
        surveyId: 'survey-nps',
        questionId: NPS_QUESTION_ID,
        kind: 'nps' as const,
        score: 10,
        comment: 'The dry run on policies is the thing that sold it internally.',
        contactId: ADA_CONTACT_ID,
        createdAt: daysAgo(10),
      },
      {
        id: 'srv_0seed000000000003',
        surveyId: 'survey-nps',
        questionId: NPS_QUESTION_ID,
        kind: 'nps' as const,
        score: 7,
        comment: 'Good, but we need per-diem by city.',
        contactId: 'con_0seedpriya0000001',
        createdAt: daysAgo(11),
      },
      {
        id: 'srv_0seed000000000004',
        surveyId: 'survey-nps',
        questionId: NPS_QUESTION_ID,
        kind: 'nps' as const,
        score: 4,
        comment: 'Migration from our old tool was manual and painful.',
        contactId: 'con_0seedjules0000001',
        createdAt: daysAgo(13),
      },
      {
        id: 'srv_0seed000000000005',
        surveyId: 'survey-nps',
        questionId: NPS_QUESTION_ID,
        kind: 'nps' as const,
        score: 8,
        contactId: 'con_0seedmarco0000001',
        createdAt: daysAgo(15),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(schema.spendLedger)
    .values([
      {
        id: 'spn_0seed000000000001',
        day: dayString(1),
        kind: 'chat' as const,
        model: 'anthropic/claude-sonnet-4.5',
        tokensIn: 18_400,
        tokensOut: 2_600,
        costUsd: '0.074000',
      },
      {
        id: 'spn_0seed000000000002',
        day: dayString(2),
        kind: 'chat' as const,
        model: 'anthropic/claude-sonnet-4.5',
        tokensIn: 12_100,
        tokensOut: 1_900,
        costUsd: '0.051000',
      },
      {
        id: 'spn_0seed000000000003',
        day: dayString(3),
        kind: 'embedding' as const,
        model: 'openai/text-embedding-3-small',
        tokensIn: 41_000,
        tokensOut: 0,
        costUsd: '0.000820',
      },
      {
        id: 'spn_0seed000000000004',
        day: dayString(4),
        kind: 'chat' as const,
        model: 'google/gemini-2.5-flash',
        tokensIn: 9_300,
        tokensOut: 1_200,
        costUsd: '0.004100',
      },
    ])
    .onConflictDoNothing();
}

/* ------------------------------------------------------------------ entry */

export async function seed(db: Db): Promise<void> {
  const fresh = await seedSettings(db);
  const articles = await seedKnowledgeBase(db);

  await seedContacts(db);
  await seedForms(db);
  await seedChangelog(db);
  await seedConversations(db);
  await seedGaps(db);
  await seedSearches(db);
  await seedRoadmap(db);
  await seedEngagement(db);

  console.log(
    `[ridgeline] HelpWell ready — ${articles} articles indexed from helpwell/docs/` +
      `${fresh ? ', demo content seeded' : ', settings left as they were'}`,
  );
}
