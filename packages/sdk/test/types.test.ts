/**
 * Pins each response type in src/types.ts to its core counterpart.
 *
 * A repo returns `Date`; the wire carries an ISO string. `Jsonified` applies
 * exactly that one rule, and everything else has to be identical. So when a
 * field is added to a repo, `tsc --noEmit` fails here until types.ts catches
 * up. The `it` blocks are no-ops at runtime: the assertions are types.
 */

import type {
  DeliveryOutcome as CoreDeliveryOutcome,
  RetryResult as CoreRetryResult,
  WebhookDelivery as CoreWebhookDelivery,
} from '@helpwell/core';
import type {
  AgentReply,
  EvalRunResult as CoreEvalRunResult,
  GapDraft as CoreGapDraft,
  SpendStatus as CoreSpendStatus,
  GapListItem,
} from '@helpwell/core/agent';
import type { EvalRun as CoreEvalRun, schema } from '@helpwell/core/db';
import type {
  ActivityItem as CoreActivityItem,
  ArticleStat as CoreArticleStat,
  ChangelogDetail as CoreChangelogDetail,
  ChangelogPage as CoreChangelogPage,
  ChangelogSummary as CoreChangelogSummary,
  CollectionSummary as CoreCollectionSummary,
  ContactDetail as CoreContactDetail,
  ContactField as CoreContactField,
  ContactListItem as CoreContactListItem,
  ContactPage as CoreContactPage,
  ConversationListItem as CoreConversationListItem,
  ConversationPage as CoreConversationPage,
  ConversationThread as CoreConversationThread,
  EngagementStats as CoreEngagementStats,
  EventCount as CoreEventCount,
  EventPage as CoreEventPage,
  Headline as CoreHeadline,
  NpsSummary as CoreNpsSummary,
  ReportBundle as CoreReportBundle,
  RoadmapBoard as CoreRoadmapBoard,
  RoadmapCard as CoreRoadmapCard,
  SearchRow as CoreSearchRow,
  Segment as CoreSegment,
  SegmentSummary as CoreSegmentSummary,
  SeriesPoint as CoreSeriesPoint,
  SpendRow as CoreSpendRow,
  ThreadMessage as CoreThreadMessage,
  TopicCount as CoreTopicCount,
  TrackedEvent as CoreTrackedEvent,
} from '@helpwell/core/repos';
import type { SearchHit as CoreSearchHit } from '@helpwell/core/search';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ActivityItem,
  ArticleStat,
  BlockedAttempt,
  ChangelogDetail,
  ChangelogPage,
  ChangelogSummary,
  ChatReply,
  CollectionSummary,
  ContactDetail,
  ContactField,
  ContactListItem,
  ContactPage,
  ConversationListItem,
  ConversationPage,
  ConversationThread,
  DeliveryOutcome,
  EngagementStats,
  EvalRun,
  EvalRunResult,
  EventCount,
  EventPage,
  Gap,
  GapDraft,
  Headline,
  NpsSummary,
  ReportBundle,
  RetryResult,
  RoadmapBoard,
  RoadmapCard,
  SearchHit,
  SearchRow,
  Segment,
  SegmentSummary,
  SeriesPoint,
  SpendRow,
  SpendStatus,
  ThreadMessage,
  TopicCount,
  TrackedEvent,
  WebhookDelivery,
} from '../src/index.js';

/** What JSON.stringify does to a repo result: every Date becomes a string. */
type Jsonified<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;

describe('public response types', () => {
  it('ChatReply is the agent reply without its token usage, which stays on the server', () => {
    expectTypeOf<ChatReply>().toEqualTypeOf<
      Jsonified<Omit<AgentReply, 'usage' | 'confidence' | 'confidenceReason' | 'certainty'>>
    >();
  });

  it('SearchHit', () => {
    expectTypeOf<SearchHit>().toEqualTypeOf<Jsonified<CoreSearchHit>>();
  });

  it('CollectionSummary is the core one plus the deprecated alias', () => {
    expectTypeOf<Omit<CollectionSummary, 'collection'>>().toEqualTypeOf<
      Jsonified<CoreCollectionSummary>
    >();
  });

  it('changelog', () => {
    expectTypeOf<ChangelogSummary>().toEqualTypeOf<Jsonified<CoreChangelogSummary>>();
    expectTypeOf<ChangelogDetail>().toEqualTypeOf<Jsonified<CoreChangelogDetail>>();
    expectTypeOf<ChangelogPage>().toEqualTypeOf<Jsonified<CoreChangelogPage>>();
  });

  it('roadmap', () => {
    expectTypeOf<RoadmapCard>().toEqualTypeOf<Jsonified<CoreRoadmapCard>>();
    expectTypeOf<RoadmapBoard>().toEqualTypeOf<Jsonified<CoreRoadmapBoard>>();
  });
});

describe('admin response types', () => {
  it('conversations', () => {
    expectTypeOf<ConversationListItem>().toEqualTypeOf<Jsonified<CoreConversationListItem>>();
    expectTypeOf<ThreadMessage>().toEqualTypeOf<Jsonified<CoreThreadMessage>>();
    expectTypeOf<ConversationThread>().toEqualTypeOf<Jsonified<CoreConversationThread>>();
    expectTypeOf<ConversationPage>().toEqualTypeOf<Jsonified<CoreConversationPage>>();
  });

  it('gaps', () => {
    expectTypeOf<Gap>().toEqualTypeOf<Jsonified<GapListItem>>();
  });

  it('contacts', () => {
    expectTypeOf<ContactListItem>().toEqualTypeOf<Jsonified<CoreContactListItem>>();
    expectTypeOf<ActivityItem>().toEqualTypeOf<Jsonified<CoreActivityItem>>();
    expectTypeOf<ContactDetail>().toEqualTypeOf<Jsonified<CoreContactDetail>>();
    expectTypeOf<ContactPage>().toEqualTypeOf<Jsonified<CoreContactPage>>();
  });

  it('fields, events and segments', () => {
    expectTypeOf<ContactField>().toEqualTypeOf<Jsonified<CoreContactField>>();
    expectTypeOf<TrackedEvent>().toEqualTypeOf<Jsonified<CoreTrackedEvent>>();
    expectTypeOf<EventPage>().toEqualTypeOf<Jsonified<CoreEventPage>>();
    expectTypeOf<EventCount>().toEqualTypeOf<Jsonified<CoreEventCount>>();
    // The rule language holds no dates and is recursive, which Jsonified cannot
    // walk; it is imported from core as-is, so it is compared as-is.
    expectTypeOf<Segment['rules']>().toEqualTypeOf<CoreSegment['rules']>();
    expectTypeOf<Omit<Segment, 'rules'>>().toEqualTypeOf<Jsonified<Omit<CoreSegment, 'rules'>>>();
    expectTypeOf<Omit<SegmentSummary, 'rules'>>().toEqualTypeOf<
      Jsonified<Omit<CoreSegmentSummary, 'rules'>>
    >();
  });

  it('webhooks', () => {
    expectTypeOf<WebhookDelivery>().toEqualTypeOf<Jsonified<CoreWebhookDelivery>>();
    expectTypeOf<DeliveryOutcome>().toEqualTypeOf<Jsonified<CoreDeliveryOutcome>>();
    expectTypeOf<RetryResult>().toEqualTypeOf<Jsonified<CoreRetryResult>>();
  });

  it('reports', () => {
    expectTypeOf<Headline>().toEqualTypeOf<Jsonified<CoreHeadline>>();
    expectTypeOf<SeriesPoint>().toEqualTypeOf<Jsonified<CoreSeriesPoint>>();
    expectTypeOf<TopicCount>().toEqualTypeOf<Jsonified<CoreTopicCount>>();
    expectTypeOf<SearchRow>().toEqualTypeOf<Jsonified<CoreSearchRow>>();
    expectTypeOf<ArticleStat>().toEqualTypeOf<Jsonified<CoreArticleStat>>();
    expectTypeOf<SpendRow>().toEqualTypeOf<Jsonified<CoreSpendRow>>();
    expectTypeOf<ReportBundle>().toEqualTypeOf<Jsonified<CoreReportBundle>>();
    expectTypeOf<EngagementStats>().toEqualTypeOf<Jsonified<CoreEngagementStats>>();
    expectTypeOf<NpsSummary>().toEqualTypeOf<Jsonified<CoreNpsSummary>>();
  });

  it('spend, blocked and evals come straight off their tables', () => {
    expectTypeOf<SpendStatus>().toEqualTypeOf<Jsonified<CoreSpendStatus>>();
    expectTypeOf<BlockedAttempt>().toEqualTypeOf<
      Jsonified<typeof schema.blockedAttempts.$inferSelect>
    >();
    expectTypeOf<EvalRun>().toEqualTypeOf<Jsonified<CoreEvalRun>>();
    expectTypeOf<EvalRunResult>().toEqualTypeOf<Jsonified<CoreEvalRunResult>>();
    expectTypeOf<GapDraft>().toEqualTypeOf<Jsonified<CoreGapDraft>>();
  });
});
