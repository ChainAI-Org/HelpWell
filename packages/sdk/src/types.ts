/**
 * The shapes the HelpWell API actually puts on the wire.
 *
 * These deliberately restate the core repo types instead of re-exporting them:
 * a repo returns `Date`, JSON.stringify turns that into an ISO string, and a
 * caller who trusts `Date` here would get a runtime surprise on every
 * timestamp. Where a type genuinely survives serialisation unchanged —
 * `Settings` is validated by zod and is JSON by construction, and the small
 * JSON column shapes in the schema hold no dates — it is imported from core
 * rather than copied, so the two cannot drift.
 *
 * test/types.test.ts pins each response type here to its core counterpart
 * with every `Date` turned into a string, so a field added to a repo is a
 * type error in this package rather than a silent gap.
 */

import type {
  Citation,
  EvalCaseResult,
  EvalCaseSpec,
  EvalCheck,
  Heading,
  MessageSource,
  ToolCall,
} from '@helpwell/core/db';
import type {
  Condition,
  ConditionGroup,
  EventCondition,
  FieldCondition,
} from '@helpwell/core/repos';
import type { Settings } from '@helpwell/core/settings';
import type { FormSubmitEvent } from './forms.js';

export type { Citation, EvalCaseResult, EvalCheck, Heading, MessageSource, Settings, ToolCall };

/** One eval case, in the shape `helpwell/evals.json` uses. */
export type EvalCase = EvalCaseSpec;

/* ----------------------------------------------------------------- public */

export interface IdentifyResult {
  contactId: string;
  /** False from `visitor()`, true once `identify()` has verified a token. */
  identified: boolean;
  /**
   * From `identify()`: what to greet them by, from the name or `first_name`
   * your app sent. Absent when it sent neither.
   */
  firstName?: string;
}

export interface ChatReply {
  conversationId: string;
  messageId: string;
  text: string;
  citations: Citation[];
  /** Set when the agent needs an email from an unidentified visitor. */
  askForEmail?: { reason?: string };
  /**
   * A person will reply later, so no AI answer was generated. Intended to be
   * used with HelpWell Cloud for live agent support.
   */
  pendingHuman?: boolean;
  /** True when the docs did not cover it and a gap was logged. */
  unresolved: boolean;
  /** True when the answer came from search because the model was unavailable. */
  degraded: boolean;
  /**
   * Set when the message was small talk (a greeting, a thanks, an "ok")
   * rather than a question. The widget skips these answers when it decides
   * whether the latest question was left unresolved.
   */
  smallTalk?: true;
}

export interface SearchHit {
  slug: string;
  title: string;
  collection: string;
  description: string | null;
  /** The matching passage, with `<mark>` around the terms. */
  snippet: string;
  score: number;
  matchedBy: ('text' | 'semantic')[];
  /** Cosine similarity to the query, when the semantic pass found it. */
  similarity?: number;
}

export interface ArticleSummary {
  slug: string;
  title: string;
  description: string | null;
  collection: string;
  reading_minutes: number;
  updated_at: string;
}

export interface ArticleDetail extends ArticleSummary {
  body: string;
  headings: Heading[];
  applies_to: string | null;
  /** The collection's display name, so a page needs no second request for it. */
  collection_title: string;
}

export interface CollectionSummary {
  id: string;
  title: string;
  description: string | null;
  icon: string;
  tint: string;
  articles: number;
  /**
   * The folder id again, under its older name.
   *
   * @deprecated Use `id`. Kept so a pinned older SDK keeps reading responses
   * from a newer server, and vice versa.
   */
  collection: string;
}

export type ConversationStatus = 'resolved' | 'unresolved';

/** The customer's own thread, from `GET /conversations/:id`. */
export interface PublicThreadMessage {
  id: string;
  role: 'customer' | 'agent' | 'human' | 'event';
  body: string;
  citations: Citation[];
  feedback: MessageFeedback | null;
  createdAt: string;
  authorName?: string | null;
  /** Files on the message. Only a support extension stores any. */
  attachments?: PublicAttachment[];
  /**
   * Set on an agent answer that left its question unresolved: the docs did
   * not cover it, the agent flagged it, or no model answered. The same
   * verdict `ChatReply.unresolved` gave when it was sent.
   */
  unresolved?: true;
  /** Set on an agent answer to small talk, as `ChatReply.smallTalk` was. */
  smallTalk?: true;
}

/** A file a visitor attached, as the support extension stored it. */
export interface PublicAttachment {
  id: string;
  url: string;
  name: string;
  /** Read from the file's bytes by HelpWell, not the type the browser claimed. */
  type: string;
  size: number;
}

export interface PublicConversationThread {
  id: string;
  status: ConversationStatus;
  messages: PublicThreadMessage[];
  mode?: 'ai' | 'human';
  /** The visitor's own details; the email only for an anonymous visitor who left one. */
  contact?: { email: string | null; name: string | null; identified: boolean };
  /** The newest agent message that asked for an email. */
  emailAsk?: { messageId: string; reason?: string } | null;
  /** The conversation already passed the bot check, so messages need no token. */
  botVerified?: boolean;
  /** Attachments, when a support extension takes them. */
  uploads?: { maxBytes: number; types: string[] } | null;
}

/** `GET /conversations/:id/presence`, when a support extension provides it. */
export interface PublicPresence {
  typing: { name: string } | null;
  seenUpTo?: string;
  notice?: { text: string; askEmail?: boolean };
}

/**
 * One item from `GET /proactive`: a chat message from the team or the agent,
 * or an engagement, that a support extension wants this visitor to see.
 */
export type PublicProactiveItem =
  | {
      kind: 'chat';
      id: string;
      sender: { name: string; avatarUrl: string | null; isAgent: boolean };
      /**
       * Engagement blocks: text, image, gif, video, buttons, divider. A
       * button's `reply` action sends its `value` (or label) as the visitor's
       * reply; `tour` starts one of the install's tours by id.
       */
      blocks: Record<string, unknown>[];
      /** Replying starts a conversation: pass `proactiveId` with the first message. */
      replyable: boolean;
      /** A bubble by the launcher, or the messenger opened on it. */
      display: 'bubble' | 'messenger';
      /** When it appears, in the engagement trigger format; whichever fires first. */
      triggers: Record<string, unknown>[];
    }
  | { kind: 'engagement'; id: string; engagement: PublicEngagement };

/**
 * `GET /proactive` and `GET /engage` also answer `fields`: the values of the
 * `{{field}}` placeholders their items use, for a visitor the host app
 * identified. Draw them as text, never as Markdown.
 */
export type PersonalFields = Record<string, string>;

export type ProactiveEventName = 'seen' | 'clicked' | 'dismissed';

export type StatusLevel =
  | 'operational'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'maintenance';

/** `GET /status`: the product's status, as the widget shows it (WG-11). */
export interface PublicStatus {
  /** Null when nothing is configured or the status page could not be read. */
  level: StatusLevel | null;
  message: string;
  url: string | null;
  incidents: { name: string; status: string; url: string | null }[];
  source: 'manual' | 'host' | 'statuspage' | 'instatus' | 'betterstack' | null;
  updatedAt: string | null;
}

/** One row of the widget's Messages tab, from `GET /conversations`. */
export interface PublicConversationSummary {
  id: string;
  status: ConversationStatus;
  topic: string | null;
  lastMessageAt: string;
  snippet: string;
}

export type MessageFeedback = 'helpful' | 'not_helpful';

export type ConversationRating = 'sad' | 'indifferent' | 'happy' | 'love';

export interface ChangelogSummary {
  id: string;
  version: string | null;
  title: string;
  summary: string | null;
  tags: string[];
  coverUrl: string | null;
  /** Always `published` on the public feed. */
  status: 'draft' | 'published' | 'archived';
  publishedAt: string | null;
  /** Only present when the caller has a visitor cookie. */
  read?: boolean;
}

export interface ChangelogDetail extends ChangelogSummary {
  body: string;
  sourceRef: string | null;
}

export interface ChangelogPage {
  items: ChangelogSummary[];
  nextCursor: string | null;
}

export type RoadmapStatus = 'under_review' | 'planned' | 'in_progress' | 'shipped';

export interface RoadmapCard {
  id: string;
  title: string;
  body: string | null;
  status: RoadmapStatus;
  votesCount: number;
  voted: boolean;
  changelogEntryId: string | null;
  createdAt: string;
}

export type RoadmapBoard = Record<RoadmapStatus, RoadmapCard[]>;

export interface VoteResult {
  /** Whether this contact's vote is on the item after the call. */
  voted: boolean;
  votesCount: number;
}

/** One engagement as settings hold it: a modal, banner, hotspot, tour or survey. */
export type Engagement = Settings['engage']['engagements'][number];

/**
 * One engagement as `GET /engage` serves it: the settings entry without its
 * targeting, schedule, frequency or internal name, which stay on the server.
 */
export type PublicEngagement = Engagement extends infer E
  ? E extends Engagement
    ? Omit<E, 'targeting' | 'schedule' | 'frequency' | 'name'>
    : never
  : never;

export type ImpressionState = 'seen' | 'clicked' | 'dismissed' | 'completed';

export interface SurveyAnswer {
  /**
   * The question's kind. For a survey defined in settings it is taken from
   * the question; otherwise it defaults to "nps".
   */
  kind?: 'nps' | 'csat' | 'stars' | 'single' | 'multi' | 'text';
  /** Which question this answers. Omitted: the survey's first question. */
  questionId?: string;
  /** One pass through the survey; answers sharing it are one response. */
  session?: string;
  /** 0-10 for NPS, 1-5 for CSAT and stars. */
  score?: number;
  /** Single choice. */
  choice?: string;
  /** Multiple choice. */
  choices?: string[];
  /** A written answer, or the follow-up comment after a score. */
  comment?: string;
}

/** What `POST /engage/:id/show` answers: whether the engagement may go on screen now. */
export type EngageClaim =
  | { shown: true }
  | { shown: false; reason: 'not_found' | 'unavailable' | 'frequency' | 'limit' };

/**
 * The page view `GET /engage` targets. Everything is optional; what is
 * missing never fails a rule, except a referrer or UTM rule, which needs it.
 */
export interface EngageVisit {
  referrer?: string;
  utm?: Partial<Record<'source' | 'medium' | 'campaign' | 'term' | 'content', string>>;
  device?: 'desktop' | 'mobile';
  /** A BCP 47 tag, e.g. `en-GB`. */
  lang?: string;
  /** Tours in progress to bring back whatever the page. */
  resume?: string[];
}

/**
 * `window.helpwell` in the browser, once the widget's loader is on the page.
 * The call form queues until the widget has loaded; so do the method forms.
 *
 *   declare global { interface Window { helpwell?: HelpWellBrowser } }
 */
export interface HelpWellBrowser {
  (method: 'open' | 'close' | 'toggle' | 'reset' | 'destroy'): void;
  (method: 'identify', token: string): void;
  (method: 'track', name: string, props?: Record<string, unknown>): void;
  (method: 'engage.show', id: string): void;
  (method: 'forms.show', id: string): void;
  (method: 'engage.hide'): void;
  track?: (name: string, props?: Record<string, unknown>) => void;
  engage?: { show(id: string): void; hide(): void };
  /**
   * `helpwell.forms.show(id)` opens a form as a popup; `forms.on('submit', cb)`
   * hears every submission on the page (what the visitor typed, not the verdict).
   */
  forms?: {
    show(id: string): void;
    on(event: 'submit', listener: (event: FormSubmitEvent) => void): void;
    off(event: 'submit', listener: (event: FormSubmitEvent) => void): void;
  };
}

/**
 * What `/config` serves: the subset of settings that is safe in a browser.
 * Narrower than `Settings` on purpose — webhook URLs and secrets never leave
 * the server, and the route picks the help centre fields by hand, so
 * `Pick` here mirrors that list rather than assuming the whole object ships.
 */
export interface PublicConfig {
  /** Present only with a support extension, saying which live features it provides. */
  support?: {
    human: boolean;
    uploads?: { maxBytes: number; types: string[] } | null;
    typing?: boolean;
    presence?: boolean;
    /** The extension offers messages and engagements through `GET /proactive`. */
    proactive?: boolean;
  };
  /** Present only while the Turnstile bot check is on and can run. */
  botCheck?: { provider: 'turnstile'; siteKey: string };
  /** Whether any switched-on form pops up by itself, so the widget knows to ask which. */
  forms?: { triggered: boolean };
  product: {
    name: string;
    locale: string;
    /**
     * Where people can write when the agent cannot help, shown as a mailto
     * link. Null when none is set, or when a support extension handles human
     * replies. Absent from an older server.
     */
    supportEmail?: string | null;
  };
  /** Who answers. No avatar means the HelpWell mark. */
  agent: { name: string; avatarUrl: string | null };
  widget: Settings['widget'];
  helpCenter: Pick<
    Settings['helpCenter'],
    'subpath' | 'domain' | 'theme' | 'search' | 'askAgent' | 'ratings' | 'readingTime' | 'poweredBy'
  >;
  changelog: {
    widgetTab: boolean;
    notification: Settings['changelog']['notification'];
    /** How the Updates tab and the embed group entries. */
    groupBy: Settings['changelog']['groupBy'];
    roadmapEnabled: boolean;
    whoCanSubmit: 'identified' | 'anyone';
  };
  unread: number;
}

/* ------------------------------------------------------------------ admin */

export interface ConversationListItem {
  id: string;
  status: ConversationStatus;
  topic: string | null;
  tags: string[];
  lastMessageAt: string;
  startedAt: string;
  messageCount: number;
  reviewedAt: string | null;
  rating: string | null;
  contact: { id: string | null; name: string | null; email: string | null; identified: boolean };
  /** The customer's last message, for the list row. */
  snippet: string;
}

export interface ThreadMessage {
  id: string;
  role: 'customer' | 'agent' | 'event';
  body: string;
  citations: Citation[];
  /** What the agent looked up before answering. Empty for customer turns. */
  toolCalls: ToolCall[];
  feedback: MessageFeedback | null;
  createdAt: string;
  model: string | null;
  latencyMs: number | null;
  /** 0-1 on agent messages: how sure HelpWell was of the answer. Null elsewhere. */
  confidence: number | null;
  /** The plain-language reason for `confidence`. */
  confidenceReason: string | null;
  /** What the model said about its own answer. */
  certainty: 'answered' | 'partial' | 'not_covered' | null;
  /** What this reply cost in US dollars, and its tokens. Null on customer turns. */
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** The passages the reply was shown, with similarity. */
  sources: MessageSource[];
}

export interface ConversationThread extends ConversationListItem {
  messages: ThreadMessage[];
  pageUrl: string | null;
  costUsd: number;
}

export interface ConversationPage {
  items: ConversationListItem[];
  nextCursor: string | null;
}

/**
 * `/admin/articles` without a query: every indexed article, drafts included,
 * straight from the index table. With a query it answers `SearchHit`s instead.
 */
export interface AdminArticle {
  slug: string;
  title: string;
  description: string | null;
  collection: string;
  status: 'draft' | 'published' | 'archived';
  reading_minutes: number;
  updated_at: string;
  /** Whether the semantic index has a vector for it yet. */
  embedded: boolean;
}

export type GapStatus = 'new' | 'drafted' | 'dismissed';

export interface Gap {
  id: string;
  question: string;
  variants: string[];
  asks: number;
  status: GapStatus;
  lastAskedAt: string;
  firstAskedAt: string;
  suggestedTitle: string | null;
  suggestedCollection: string | null;
}

export interface ContactListItem {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  identified: boolean;
  country: string | null;
  city: string | null;
  lastSeenAt: string;
  firstSeenAt: string;
  conversationCount: number;
  tags: string[];
  /** How the contact first reached HelpWell. Set once, never overwritten. */
  source: ContactSource;
  consent: ConsentState;
}

/** widget, identify, import, form or api. */
export type ContactSource = 'widget' | 'identify' | 'import' | 'form' | 'api';
export type ConsentState = 'unknown' | 'granted' | 'denied';

export interface ActivityItem {
  kind: 'search' | 'article_rating' | 'changelog_read' | 'survey' | 'event';
  label: string;
  detail: string | null;
  at: string;
}

export interface ContactDetail extends ContactListItem {
  externalId: string | null;
  attributes: Record<string, unknown>;
  /** Where the consent state came from (identify, api, import, form), and when. */
  consentSource: string | null;
  consentAt: string | null;
  /** Your app's own signup date, from identify `createdAt`. */
  signedUpAt: string | null;
  locale: string | null;
  timezone: string | null;
  conversations: {
    id: string;
    topic: string | null;
    status: string;
    lastMessageAt: string;
    messageCount: number;
    snippet: string;
  }[];
  activity: ActivityItem[];
  /** Every event name this contact has, with counts. */
  eventCounts: EventCount[];
}

/**
 * `admin.contacts.update()`: attributes merge (a key set to `null` is
 * removed, absent keys are kept); tags are added and removed; consent is
 * recorded with "api" as its source.
 */
export interface ContactUpdate {
  attributes?: Record<string, unknown>;
  /** A list adds these tags; `{ add, remove }` does both. */
  tags?: string[] | { add?: string[]; remove?: string[] };
  consent?: ConsentState;
  /**
   * Create a contact for a user id HelpWell has not seen. Defaults to true;
   * `false` answers 404 instead.
   */
  upsert?: boolean;
}

/* ------------------------------------------------------ fields and events */

export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'url' | 'money';
export type FieldSource = 'app' | 'helpwell' | 'import' | 'form' | 'api';

/** One typed contact field: a built-in one, or an attribute key someone sent. */
export interface ContactField {
  key: string;
  label: string;
  type: FieldType;
  source: FieldSource;
  /** A person chose the type (or HelpWell owns the field); inference never changes it. */
  locked: boolean;
  hidden: boolean;
  builtin: boolean;
  sample: unknown;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface FieldPatch {
  label?: string;
  /** Only while unlocked; setting it locks the field. */
  type?: FieldType;
  hidden?: boolean;
  /** `false` unlocks an attribute so its type can change again. */
  locked?: boolean;
}

export interface TrackedEvent {
  id: string;
  contactId: string | null;
  name: string;
  props: Record<string, unknown>;
  url: string | null;
  createdAt: string;
}

export interface EventPage {
  items: TrackedEvent[];
  nextCursor: string | null;
}

export interface EventCount {
  name: string;
  count: number;
  /** How many different contacts did it. */
  contacts: number;
  lastAt: string;
}

/* --------------------------------------------------------------- segments */

/**
 * The condition language segments are written in. See the README's
 * "Segments" section, or `@helpwell/core/repos`'s conditions module.
 */
export type { Condition, ConditionGroup, EventCondition, FieldCondition };

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  rules: ConditionGroup;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentSummary extends Segment {
  /** How many contacts match right now. */
  count: number;
}

export interface SegmentInput {
  name: string;
  description?: string | null;
  rules: ConditionGroup | Condition;
}

/* --------------------------------------------------------------- webhooks */

export interface WebhookDelivery {
  id: string;
  event: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  responseCode: number | null;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
  lastAttemptAt: string | null;
  /** When it will be retried; null once delivered or given up on. */
  nextAttemptAt: string | null;
}

export interface DeliveryOutcome {
  id: string;
  url: string;
  event: string;
  status: 'delivered' | 'failed';
  responseCode: number | null;
  error: string | null;
  attempts: number;
  nextAttemptAt: string | null;
}

export interface RetryResult {
  attempted: number;
  delivered: number;
  failed: number;
  gaveUp: number;
  deliveries: DeliveryOutcome[];
}

export interface ContactPage {
  items: ContactListItem[];
  nextCursor: string | null;
}

/** A subject access request: everything held about one person. */
/**
 * Everything HelpWell holds about one person: one key per table, as raw rows
 * with the database's own column names, uncapped. This is the data-portability
 * export, so the shape follows the storage rather than any screen.
 */
export interface ContactExport {
  /**
   * What the less obvious fields mean, keyed `<table>.<column>`: for example
   * that `formSubmissions.ip_address_hash` is a keyed one-way hash of an IP
   * address, which cannot be reversed without the install's own secret.
   */
  notes: Record<string, string>;
  contact: {
    id: string;
    externalId: string | null;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    attributes: Record<string, unknown>;
    identified: boolean;
    source: ContactSource;
    consent: ConsentState;
    consentSource: string | null;
    consentAt: string | null;
    signedUpAt: string | null;
    locale: string | null;
    timezone: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    tags: { tag: string; created_at: string }[];
  };
  conversations: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  searches: Record<string, unknown>[];
  articleRatings: Record<string, unknown>[];
  changelogReads: Record<string, unknown>[];
  surveyResponses: Record<string, unknown>[];
  events: Record<string, unknown>[];
  roadmapIdeas: Record<string, unknown>[];
  roadmapVotes: Record<string, unknown>[];
  engageImpressions: Record<string, unknown>[];
  /**
   * Form submissions on the contact or typed with their address, each with
   * `ip_address_hash` (see `notes`).
   */
  formSubmissions: Record<string, unknown>[];
  /** Giveaway entries, one per giveaway, with `won` while they are a selected winner. */
  giveawayEntries: Record<string, unknown>[];
}

export interface Headline {
  conversations: number;
  resolved: number;
  /** resolved / conversations, or null when there were none. */
  resolutionRate: number | null;
  unresolved: number;
  medianLatencyMs: number | null;
  costUsd: number;
  helpfulVotes: number;
  unhelpfulVotes: number;
  articleViewsFromAgent: number;
}

export interface SeriesPoint {
  day: string;
  conversations: number;
  resolved: number;
  costUsd: number;
}

export interface TopicCount {
  topic: string;
  count: number;
  resolvedRate: number | null;
}

/** What people typed into search, and whether it found nothing. */
export interface SearchRow {
  query: string;
  count: number;
  zeroResults: boolean;
}

/** Which articles the agent leans on, and whether those answers landed. */
export interface ArticleStat {
  slug: string;
  title: string;
  collection: string;
  citations: number;
  helpful: number;
  unhelpful: number;
}

export interface SpendRow {
  day: string;
  kind: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface ReportBundle {
  range: { from: string; to: string };
  headline: Headline;
  series: SeriesPoint[];
  topics: TopicCount[];
  searches: SearchRow[];
  articles: ArticleStat[];
  spend: SpendRow[];
}

/** The preset windows `/admin/reports` understands. */
export type ReportRange = '7d' | '30d' | '90d' | 'today' | 'all';

export interface EngagementStats {
  engagementId: string;
  /** Times it went on screen. A tour counts once, however many steps were seen. */
  seen: number;
  clicked: number;
  dismissed: number;
  completed: number;
  /** completed / seen, or null when nothing has been seen yet. */
  completionRate: number | null;
  /** Distinct people it was shown to. */
  people: number;
  /** Clicks for a modal, banner or hotspot; completions for a tour or survey. */
  conversions: number;
  /** conversions / seen, or null when nothing has been seen yet. */
  conversionRate: number | null;
}

export interface TourStepStat {
  step: number;
  people: number;
  /** Share of the people who saw step 1. */
  reached: number | null;
  /** Share lost since the step before. */
  dropOff: number | null;
}

export interface NpsBreakdown {
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  score: number | null;
}

export interface QuestionResult {
  questionId: string;
  kind: 'nps' | 'csat' | 'stars' | 'single' | 'multi' | 'text';
  prompt: string;
  answers: number;
  distribution: { value: number; count: number }[];
  average: number | null;
  nps: NpsBreakdown | null;
  choices: { choice: string; count: number }[];
  comments: { text: string; score: number | null; at: string }[];
}

export interface SurveyResults {
  sessions: number;
  questions: QuestionResult[];
}

/** `GET /admin/engage/:id/results`. */
export interface EngagementResults {
  stats: EngagementStats;
  funnel: TourStepStat[] | null;
  survey: SurveyResults | null;
}

export interface SurveySession {
  sessionId: string;
  contactId: string | null;
  email: string | null;
  name: string | null;
  at: string;
  answers: Record<
    string,
    {
      score: number | null;
      choice: string | null;
      choices: string[] | null;
      comment: string | null;
    }
  >;
}

export interface NpsSummary {
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** Standard NPS: %promoters - %detractors, rounded, or null with no data. */
  score: number | null;
  comments: { score: number | null; comment: string; at: string }[];
}

/** The windows the engage stats routes take. */
export type EngageRange = '7d' | '30d' | '90d' | 'all';

export interface EngageReport {
  engagements: EngagementStats[];
  /** Only when a `surveyId` was asked for. */
  nps: NpsSummary | null;
}

export interface SpendStatus {
  allowed: boolean;
  spentTodayUsd: number;
  capUsd: number;
  warning: boolean;
  percentUsed: number;
}

export interface BlockedAttempt {
  id: string;
  reason: string;
  /** The IP is hashed before it is stored; the raw address is never kept. */
  ipHash: string | null;
  detail: string | null;
  createdAt: string;
}

export interface EvalRun {
  id: string;
  ref: string | null;
  score: number;
  passed: number;
  weak: number;
  failed: number;
  /** A numeric column, so the driver hands it over as a string. */
  costUsd: string;
  medianMs: number | null;
  cases: EvalCaseResult[];
  /**
   * `retrieval` when no model was configured, so only search was measured; the
   * two scores are not comparable. Null for runs recorded before it was kept.
   */
  mode: 'full' | 'retrieval' | null;
  /** The chat model that answered; null for a retrieval-only run. */
  model: string | null;
  /** Every case the run was given, as written, including any it could not judge. */
  suite: EvalCase[];
  createdAt: string;
}

/** @deprecated The list and detail routes return the same row; use `EvalRun`. */
export type EvalRunSummary = EvalRun;

/** What `POST /admin/evals/run` takes. Every field is optional. */
export interface RunEvalsInput {
  /** The cases to run. Left out, the cases of the most recent run are run again. */
  cases?: EvalCase[];
  /** A label stored with the run, e.g. the commit SHA. */
  ref?: string;
  /** Judge and score, but record nothing. */
  dryRun?: boolean;
  /** 0-100; `belowThreshold` in the result says whether the score fell short. */
  threshold?: number;
}

/** What `POST /admin/evals/run` returns: the run, as it was recorded. */
export interface EvalRunResult {
  /** The recorded row's id, or null on a dry run. */
  id: string | null;
  ref: string | null;
  mode: 'full' | 'retrieval';
  model: string | null;
  score: number;
  passed: number;
  weak: number;
  failed: number;
  costUsd: number;
  medianMs: number | null;
  cases: EvalCaseResult[];
  /** Cases a retrieval-only run could not judge, because every rule they have needs a model. */
  skipped: { id: string; question: string }[];
  threshold: number | null;
  belowThreshold: boolean;
  createdAt: string;
}

/**
 * What `POST /admin/gaps/:id/draft` returns: an article drafted by the writing
 * model for a gap. Nothing was saved; facts nobody has written down yet are
 * `[TODO: ...]` in the body.
 */
export interface GapDraft {
  gapId: string;
  question: string;
  title: string;
  description: string;
  /** Markdown, no H1. */
  body: string;
  /** The folder it belongs in, e.g. "billing". */
  collection: string;
  /** True when that folder does not exist yet. */
  newCollection: boolean;
  slug: string;
  /** Where the file would go, from the repo root. */
  path: string;
  /** The whole file: frontmatter with `status: draft`, then the body. */
  markdown: string;
  model: string;
  usage: { tokensIn: number; tokensOut: number; costUsd: number };
}

export interface ChangelogInput {
  version?: string | null;
  title: string;
  summary?: string | null;
  body?: string;
  tags?: string[];
  coverUrl?: string | null;
  sourceRef?: string | null;
  status?: 'draft' | 'published' | 'archived';
  /** ISO timestamp. Only read when `status` is "published". */
  publishedAt?: string | null;
}

export interface MaintenanceResult {
  conversationsPruned: number;
  countersPruned: number;
}

/* ------------------------------------------------- article history (0006) */

/** Who made a change to an article, as its history shows it. */
export type ArticleVersionOrigin = 'sync' | 'dashboard' | 'api';

/** `GET /admin/articles/:slug/versions`, newest first. */
export interface ArticleVersionSummary {
  id: number;
  slug: string;
  /** Relative to the docs folder, e.g. `billing/invoices.md`. */
  path: string | null;
  title: string;
  status: string;
  origin: ArticleVersionOrigin;
  createdAt: string;
  /** The version this one brought back, when a restore saved it (0014). */
  restoredFrom?: number | null;
}

export interface ArticleVersion extends ArticleVersionSummary {
  description: string | null;
  /** The body as written, without front matter. */
  body: string;
  /** The whole file as written, when the indexer had it. */
  source: string | null;
  contentHash: string;
}

export interface ArticleDiffLine {
  op: 'same' | 'add' | 'remove';
  text: string;
  /** For an edited line, the words that changed within it. */
  parts?: { op: 'same' | 'add' | 'remove'; text: string }[];
}

/** `GET /admin/articles/:slug/diff?to=&from=`. */
export interface ArticleComparison {
  /** Null when `to` is the first version. */
  from: ArticleVersionSummary | null;
  to: ArticleVersionSummary;
  lines: ArticleDiffLine[];
  added: number;
  removed: number;
}

/** `GET /admin/articles/:slug/source`: the file as written, for an editor. */
export interface ArticleSource {
  slug: string;
  collection: string;
  path: string;
  /** False when `path` is a guess, for an article indexed before paths were kept. */
  pathKnown: boolean;
  markdown: string;
}

export interface SaveArticleInput {
  /** Relative to the docs folder: `<collection>/<file>.md`. */
  path: string;
  /** The whole file, front matter included. */
  markdown: string;
  /** A new article: refuse rather than overwrite one already at that path or slug. */
  create?: boolean;
  /** The article being edited, when it is an edit. */
  slug?: string;
}

/** `POST /admin/articles`, through the host's `writeArticle` hook. */
export interface SaveArticleResult {
  slug: string;
  path: string;
  title: string;
  /** False when the file was saved exactly as it already was. */
  changed: boolean;
  versionId: number | null;
  /**
   * Whether semantic search has the article as saved. False means text search
   * only, until a sync with a model key embeds it.
   */
  embedded: boolean;
}

/**
 * `POST /admin/articles/:slug/versions/:id/restore`: the old version saved
 * again as the newest one. History is never rewritten; `changed` is false
 * when the article already said exactly that.
 */
export interface RestoreArticleResult extends SaveArticleResult {
  /** The version that was brought back. */
  restoredFrom: number;
}

/** `POST /admin/assets`: an image uploaded for an article. */
export interface UploadedAsset {
  /** Among the knowledge base's files, relative to the docs root: `_media/3f9a….png`. */
  path: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  size: number;
  /** The asset store's own URL for it, or null when it is kept at `path`. */
  url: string | null;
  /** What an article's Markdown uses: `url`, or `../_media/…` relative to the article. */
  reference: string;
  /** `![name](reference)`, ready to paste. */
  markdown: string;
  /** Where a browser can load it right now, for a preview. */
  src: string;
}
