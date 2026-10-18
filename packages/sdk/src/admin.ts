/**
 * The `/admin` half of the API, as `client.admin.*`.
 *
 * Kept as its own class rather than prefixed methods on the client so that the
 * one rule that separates these routes from the public ones — they all need a
 * bearer token — is expressed once, in the `admin: true` every call passes,
 * instead of being a convention someone has to remember.
 *
 * The token is the `adminToken` the host app gave `createHelpWellHandler`.
 * The server accepts it as `Authorization: Bearer` whether or not the host
 * also configured `isAdmin` for its own signed-in people, so a script and a
 * dashboard session can coexist on the same install.
 */

import { type ContactsApi, contactsApi } from './audience.js';
import { type FormsApi, formsApi } from './forms.js';
import { encodeSlug, type Transport } from './http.js';
import type {
  AdminArticle,
  ArticleComparison,
  ArticleSource,
  ArticleVersion,
  ArticleVersionSummary,
  BlockedAttempt,
  ChangelogDetail,
  ChangelogInput,
  ChangelogPage,
  Condition,
  ConditionGroup,
  ContactDetail,
  ContactExport,
  ContactField,
  ContactPage,
  ConversationPage,
  ConversationThread,
  DeliveryOutcome,
  EngagementResults,
  EngagementStats,
  EngageRange,
  EngageReport,
  EvalRun,
  EvalRunResult,
  EventCount,
  EventPage,
  FieldPatch,
  Gap,
  GapDraft,
  GapStatus,
  MaintenanceResult,
  ReportBundle,
  ReportRange,
  RestoreArticleResult,
  RetryResult,
  RoadmapBoard,
  RoadmapStatus,
  RunEvalsInput,
  SaveArticleInput,
  SaveArticleResult,
  SearchHit,
  SegmentInput,
  SegmentSummary,
  Settings,
  SpendStatus,
  SurveySession,
  UploadedAsset,
  WebhookDelivery,
} from './types.js';

export interface ListConversationsOptions {
  status?: 'resolved' | 'unresolved';
  topic?: string;
  /** Free-text search across the thread. */
  q?: string;
  contactId?: string;
  cursor?: string;
  limit?: number;
}

export interface UpdateConversationInput {
  status?: 'resolved' | 'unresolved';
  topic?: string | null;
  reviewed?: boolean;
}

export type { ListContactsOptions } from './audience.js';

export interface UpdateRoadmapInput {
  status?: RoadmapStatus;
  title?: string;
  body?: string | null;
  /** Set alongside `status: 'shipped'` to link the entry that announced it. */
  changelogEntryId?: string | null;
}

/** A preset window, or an explicit one. `from` and `to` win when both are set. */
export interface ReportOptions {
  range?: ReportRange;
  from?: string;
  to?: string;
}

export class AdminApi {
  readonly #transport: Transport;
  /**
   * List contacts (`admin.contacts({ q })`), and update, track and read one
   * by HelpWell's id or your own user id (`admin.contacts.update(...)`).
   */
  readonly contacts: ContactsApi;
  /**
   * Forms and giveaways: list them (`admin.forms()`), create, save versions,
   * read analytics and submissions, draw winners (`admin.forms.draw(id)`).
   */
  readonly forms: FormsApi;

  constructor(transport: Transport) {
    this.#transport = transport;
    this.contacts = contactsApi(transport);
    this.forms = formsApi(transport);
  }

  /* ------------------------------------------------------- conversations */

  conversations(options: ListConversationsOptions = {}): Promise<ConversationPage> {
    return this.#transport.request<ConversationPage>('/admin/conversations', {
      admin: true,
      query: { ...options },
    });
  }

  conversation(id: string): Promise<ConversationThread> {
    return this.#transport.request<ConversationThread>(
      `/admin/conversations/${encodeURIComponent(id)}`,
      { admin: true },
    );
  }

  updateConversation(id: string, patch: UpdateConversationInput): Promise<ConversationThread> {
    return this.#transport.request<ConversationThread>(
      `/admin/conversations/${encodeURIComponent(id)}`,
      { method: 'PATCH', admin: true, json: patch },
    );
  }

  /** Lower-cased and trimmed server-side; adding a tag twice is a no-op. */
  addConversationTag(id: string, tag: string): Promise<void> {
    return this.#transport.request<void>(`/admin/conversations/${encodeURIComponent(id)}/tags`, {
      method: 'POST',
      admin: true,
      json: { tag },
    });
  }

  removeConversationTag(id: string, tag: string): Promise<void> {
    return this.#transport.request<void>(
      `/admin/conversations/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag)}`,
      { method: 'DELETE', admin: true },
    );
  }

  /* ---------------------------------------------------------------- gaps */

  async gaps(options: { status?: GapStatus; limit?: number } = {}): Promise<Gap[]> {
    const page = await this.#transport.request<{ items: Gap[] }>('/admin/gaps', {
      admin: true,
      query: { ...options },
    });
    return page.items;
  }

  updateGap(id: string, status: GapStatus, articleSlug?: string): Promise<void> {
    return this.#transport.request<void>(`/admin/gaps/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      admin: true,
      json: { status, articleSlug },
    });
  }

  /**
   * Draft the article a gap asks for with the writing model. Saves nothing and
   * leaves the gap's status alone. `docsDir` is the docs folder the returned
   * `path` starts with; "docs" by default.
   */
  draftGapArticle(id: string, options: { docsDir?: string } = {}): Promise<GapDraft> {
    return this.#transport.request<GapDraft>(`/admin/gaps/${encodeURIComponent(id)}/draft`, {
      method: 'POST',
      admin: true,
      json: options,
    });
  }

  /* ------------------------------------------------------------ contacts */

  contact(id: string): Promise<ContactDetail> {
    return this.#transport.request<ContactDetail>(`/admin/contacts/${encodeURIComponent(id)}`, {
      admin: true,
    });
  }

  addContactTag(id: string, tag: string): Promise<void> {
    return this.#transport.request<void>(`/admin/contacts/${encodeURIComponent(id)}/tags`, {
      method: 'POST',
      admin: true,
      json: { tag },
    });
  }

  removeContactTag(id: string, tag: string): Promise<void> {
    return this.#transport.request<void>(
      `/admin/contacts/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag)}`,
      { method: 'DELETE', admin: true },
    );
  }

  /** Irreversible: the row and everything hanging off it go (CT-09). */
  deleteContact(id: string): Promise<void> {
    return this.#transport.request<void>(`/admin/contacts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      admin: true,
    });
  }

  /** Everything HelpWell holds about one person, for a subject access request. */
  exportContact(id: string): Promise<ContactExport> {
    return this.#transport.request<ContactExport>(
      `/admin/contacts/${encodeURIComponent(id)}/export`,
      { admin: true },
    );
  }

  /* ------------------------------------------------------------ articles */

  /** Every indexed article, drafts included, in help-centre order. */
  async articles(): Promise<AdminArticle[]> {
    const page = await this.#transport.request<{ items: AdminArticle[] }>('/admin/articles', {
      admin: true,
    });
    return page.items;
  }

  /** Full-text search that, unlike the public one, can find a draft. */
  async searchArticles(query: string): Promise<SearchHit[]> {
    const page = await this.#transport.request<{ items: SearchHit[] }>('/admin/articles', {
      admin: true,
      query: { q: query },
    });
    return page.items;
  }

  /**
   * Save an article's file through the host's `writeArticle` hook, then
   * re-index it. The server answers 501 when the host passed no hook.
   */
  saveArticle(input: SaveArticleInput): Promise<SaveArticleResult> {
    return this.#transport.request<SaveArticleResult>('/admin/articles', {
      method: 'POST',
      admin: true,
      json: input,
    });
  }

  /** The file as written, front matter and relative image paths included. */
  articleSource(slug: string): Promise<ArticleSource> {
    return this.#transport.request<ArticleSource>(`/admin/articles/${encodeSlug(slug)}/source`, {
      admin: true,
    });
  }

  /** Every change the index has seen to one article, newest first. */
  async articleVersions(
    slug: string,
    options: { limit?: number } = {},
  ): Promise<ArticleVersionSummary[]> {
    const page = await this.#transport.request<{ items: ArticleVersionSummary[] }>(
      `/admin/articles/${encodeSlug(slug)}/versions`,
      { admin: true, query: { ...options } },
    );
    return page.items;
  }

  articleVersion(slug: string, id: number): Promise<ArticleVersion> {
    return this.#transport.request<ArticleVersion>(
      `/admin/articles/${encodeSlug(slug)}/versions/${encodeURIComponent(String(id))}`,
      { admin: true },
    );
  }

  /**
   * Bring an article back to what version `id` said. It is saved as the
   * newest version, through the host's hook or writable content source; the
   * history in between is kept. `changed` is false when it already said that.
   */
  restoreArticleVersion(slug: string, id: number): Promise<RestoreArticleResult> {
    return this.#transport.request<RestoreArticleResult>(
      `/admin/articles/${encodeSlug(slug)}/versions/${encodeURIComponent(String(id))}/restore`,
      { method: 'POST', admin: true },
    );
  }

  /**
   * Upload an image for an article: PNG, JPEG, GIF or WebP, up to 10 MB. It
   * is kept through the install's asset store; use `markdown` (or
   * `reference`) in the article. The server answers 501 when the install
   * cannot keep uploads.
   */
  uploadAsset(bytes: Uint8Array, options: { filename?: string } = {}): Promise<UploadedAsset> {
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
    if (options.filename) headers['x-helpwell-filename'] = encodeURIComponent(options.filename);
    return this.#transport.request<UploadedAsset>('/admin/assets', {
      method: 'POST',
      admin: true,
      bytes: { body: bytes, headers },
    });
  }

  /** What changed in version `to`: against `from`, or the version before it. */
  articleDiff(slug: string, to: number, from?: number): Promise<ArticleComparison> {
    return this.#transport.request<ArticleComparison>(`/admin/articles/${encodeSlug(slug)}/diff`, {
      admin: true,
      query: from === undefined ? { to } : { to, from },
    });
  }

  /* ------------------------------------------------------------- reports */

  reports(options: ReportOptions = {}): Promise<ReportBundle> {
    return this.#transport.request<ReportBundle>('/admin/reports', {
      admin: true,
      query: { ...options },
    });
  }

  /** The daily series as CSV text: `day,conversations,resolved,cost_usd`. */
  exportReport(options: ReportOptions = {}): Promise<string> {
    return this.#transport.request<string>('/admin/reports/export', {
      admin: true,
      query: { ...options },
      text: true,
    });
  }

  /** Impression counts per engagement, plus an NPS breakdown when a survey id is given. */
  engageReport(options: ReportOptions & { surveyId?: string } = {}): Promise<EngageReport> {
    return this.#transport.request<EngageReport>('/admin/reports/engage', {
      admin: true,
      query: { ...options },
    });
  }

  /** Impressions, clicks, dismissals, completions and conversion for every engagement. */
  async engageStats(options: { range?: EngageRange } = {}): Promise<EngagementStats[]> {
    const result = await this.#transport.request<{ items: EngagementStats[] }>(
      '/admin/engage/stats',
      { admin: true, query: { ...options } },
    );
    return result.items;
  }

  /** One engagement's counts, plus a tour's drop-off per step or a survey's results. */
  engagementResults(id: string, options: { range?: EngageRange } = {}): Promise<EngagementResults> {
    return this.#transport.request<EngagementResults>(
      `/admin/engage/${encodeURIComponent(id)}/results`,
      { admin: true, query: { ...options } },
    );
  }

  /** A survey's responses, one per session, newest first. */
  async surveyResponses(
    id: string,
    options: { range?: EngageRange; limit?: number } = {},
  ): Promise<SurveySession[]> {
    const result = await this.#transport.request<{ items: SurveySession[] }>(
      `/admin/engage/${encodeURIComponent(id)}/responses`,
      { admin: true, query: { ...options } },
    );
    return result.items;
  }

  /** The same responses as CSV text: a row per session, a column per question. */
  surveyResponsesCsv(id: string, options: { range?: EngageRange } = {}): Promise<string> {
    return this.#transport.request<string>(
      `/admin/engage/${encodeURIComponent(id)}/responses.csv`,
      { admin: true, query: { ...options }, text: true },
    );
  }

  /* ------------------------------------------------------------ settings */

  settings(): Promise<Settings> {
    return this.#transport.request<Settings>('/admin/settings', { admin: true });
  }

  /** A deep merge server-side, so a partial patch never blanks a sibling field. */
  updateSettings(patch: Record<string, unknown>): Promise<Settings> {
    return this.#transport.request<Settings>('/admin/settings', {
      method: 'PATCH',
      admin: true,
      json: patch,
    });
  }

  /* ----------------------------------------------------------- changelog */

  /** Unlike the public feed, this one includes drafts. */
  changelog(options: { limit?: number; cursor?: string } = {}): Promise<ChangelogPage> {
    return this.#transport.request<ChangelogPage>('/admin/changelog', {
      admin: true,
      query: { ...options },
    });
  }

  changelogEntry(id: string): Promise<ChangelogDetail> {
    return this.#transport.request<ChangelogDetail>(`/admin/changelog/${encodeURIComponent(id)}`, {
      admin: true,
    });
  }

  createChangelogEntry(input: ChangelogInput): Promise<{ id: string }> {
    return this.#transport.request<{ id: string }>('/admin/changelog', {
      method: 'POST',
      admin: true,
      json: input,
    });
  }

  updateChangelogEntry(id: string, patch: Partial<ChangelogInput>): Promise<ChangelogDetail> {
    return this.#transport.request<ChangelogDetail>(`/admin/changelog/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      admin: true,
      json: patch,
    });
  }

  deleteChangelogEntry(id: string): Promise<void> {
    return this.#transport.request<void>(`/admin/changelog/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      admin: true,
    });
  }

  /* ------------------------------------------------------------- roadmap */

  roadmap(): Promise<RoadmapBoard> {
    return this.#transport.request<RoadmapBoard>('/admin/roadmap', { admin: true });
  }

  updateRoadmapItem(id: string, patch: UpdateRoadmapInput): Promise<void> {
    return this.#transport.request<void>(`/admin/roadmap/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      admin: true,
      json: patch,
    });
  }

  deleteRoadmapItem(id: string): Promise<void> {
    return this.#transport.request<void>(`/admin/roadmap/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      admin: true,
    });
  }

  /* --------------------------------------------------------------- spend */

  spend(): Promise<SpendStatus> {
    return this.#transport.request<SpendStatus>('/admin/spend', { admin: true });
  }

  /** The last hundred requests the abuse guards refused, newest first. */
  async blocked(): Promise<BlockedAttempt[]> {
    const page = await this.#transport.request<{ items: BlockedAttempt[] }>('/admin/blocked', {
      admin: true,
    });
    return page.items;
  }

  /* --------------------------------------------------------------- evals */

  /** The twenty most recent runs, newest first. */
  async evals(): Promise<EvalRun[]> {
    const page = await this.#transport.request<{ items: EvalRun[] }>('/admin/evals', {
      admin: true,
    });
    return page.items;
  }

  evalRun(id: string): Promise<EvalRun> {
    return this.#transport.request<EvalRun>(`/admin/evals/${encodeURIComponent(id)}`, {
      admin: true,
    });
  }

  /**
   * Run evals on the server with its configured model, and record the run.
   * Without `cases`, the cases of the most recent run are run again. Without
   * a model key on the server, the run measures retrieval only (`mode`).
   */
  runEvals(input: RunEvalsInput = {}): Promise<EvalRunResult> {
    return this.#transport.request<EvalRunResult>('/admin/evals/run', {
      method: 'POST',
      admin: true,
      json: input,
    });
  }

  /* -------------------------------------------------------------- fields */

  /** Every contact field: HelpWell's own first, then the attributes you send, typed. */
  async fields(): Promise<ContactField[]> {
    const page = await this.#transport.request<{ items: ContactField[] }>('/admin/fields', {
      admin: true,
    });
    return page.items;
  }

  /** Relabel, hide, or retype a field. A type change locks it; a locked type is a 409. */
  updateField(key: string, patch: FieldPatch): Promise<ContactField> {
    return this.#transport.request<ContactField>(`/admin/fields/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      admin: true,
      json: patch,
    });
  }

  /* -------------------------------------------------------------- events */

  /** Tracked events across everyone, newest first; filter by contact or name. */
  events(
    options: { contactId?: string; name?: string; cursor?: string; limit?: number } = {},
  ): Promise<EventPage> {
    return this.#transport.request<EventPage>('/admin/events', {
      admin: true,
      query: { ...options },
    });
  }

  /** Each event name with how often it happened and to how many people. */
  async eventCounts(options: { contactId?: string; days?: number } = {}): Promise<EventCount[]> {
    const page = await this.#transport.request<{ items: EventCount[] }>('/admin/events/counts', {
      admin: true,
      query: { ...options },
    });
    return page.items;
  }

  /* ------------------------------------------------------------ segments */

  /** Every saved segment with its current member count. */
  async segments(): Promise<SegmentSummary[]> {
    const page = await this.#transport.request<{ items: SegmentSummary[] }>('/admin/segments', {
      admin: true,
    });
    return page.items;
  }

  segment(id: string): Promise<SegmentSummary> {
    return this.#transport.request<SegmentSummary>(`/admin/segments/${encodeURIComponent(id)}`, {
      admin: true,
    });
  }

  createSegment(input: SegmentInput): Promise<SegmentSummary> {
    return this.#transport.request<SegmentSummary>('/admin/segments', {
      method: 'POST',
      admin: true,
      json: input,
    });
  }

  updateSegment(id: string, patch: Partial<SegmentInput>): Promise<SegmentSummary> {
    return this.#transport.request<SegmentSummary>(`/admin/segments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      admin: true,
      json: patch,
    });
  }

  deleteSegment(id: string): Promise<void> {
    return this.#transport.request<void>(`/admin/segments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      admin: true,
    });
  }

  /** A page of a segment's members, in the contact list's shape. */
  segmentMembers(
    id: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<ContactPage> {
    return this.#transport.request<ContactPage>(
      `/admin/segments/${encodeURIComponent(id)}/members`,
      { admin: true, query: { ...options } },
    );
  }

  async countSegment(id: string): Promise<number> {
    const result = await this.#transport.request<{ count: number }>(
      `/admin/segments/${encodeURIComponent(id)}/count`,
      { admin: true },
    );
    return result.count;
  }

  /** How many contacts some rules would match, before saving them. */
  async previewSegment(rules: ConditionGroup | Condition): Promise<number> {
    const result = await this.#transport.request<{ count: number }>('/admin/segments/preview', {
      method: 'POST',
      admin: true,
      json: { rules },
    });
    return result.count;
  }

  /* ------------------------------------------------------------ webhooks */

  /** The delivery log, newest first. `retrying` is failures with a try left. */
  async webhookDeliveries(
    options: { status?: 'pending' | 'delivered' | 'failed' | 'retrying'; limit?: number } = {},
  ): Promise<WebhookDelivery[]> {
    const page = await this.#transport.request<{ items: WebhookDelivery[] }>(
      '/admin/webhooks/deliveries',
      { admin: true, query: { ...options } },
    );
    return page.items;
  }

  /** Retry failed deliveries that are due; `force` retries every one with tries left. */
  retryWebhooks(options: { force?: boolean; limit?: number } = {}): Promise<RetryResult> {
    return this.#transport.request<RetryResult>('/admin/webhooks/retry', {
      method: 'POST',
      admin: true,
      json: options,
    });
  }

  /** Send a `webhook.test` event to every active webhook, or the one at `url`. */
  async testWebhook(url?: string): Promise<DeliveryOutcome[]> {
    const result = await this.#transport.request<{ items: DeliveryOutcome[] }>(
      '/admin/webhooks/test',
      { method: 'POST', admin: true, json: { url } },
    );
    return result.items;
  }

  /* --------------------------------------------------------- maintenance */

  /** Retention sweep and counter housekeeping. Safe to call on a daily cron. */
  maintenance(): Promise<MaintenanceResult> {
    return this.#transport.request<MaintenanceResult>('/admin/maintenance', {
      method: 'POST',
      admin: true,
    });
  }
}
