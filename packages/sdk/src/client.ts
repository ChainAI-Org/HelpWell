/**
 * HelpWellClient — the server-side sibling of the widget's `Api`.
 *
 * The widget talks to HelpWell from a browser, on a cookie. This talks to it
 * from a customer's own backend, a script or a cron job. Same routes, same
 * error shape, different caller — and, because there is no browser to do it,
 * the client keeps the visitor cookie itself, so one instance is one visitor
 * for as long as it lives. Call `identify` to make that visitor a known user.
 */

import { signIdentity } from '@helpwell/core';
import { AdminApi } from './admin.js';
import type { ContactsApi } from './audience.js';
import { HelpWellApiError } from './errors.js';
import { encodeSlug, Transport } from './http.js';
import type {
  ArticleDetail,
  ArticleSummary,
  ChangelogDetail,
  ChangelogPage,
  ChatReply,
  CollectionSummary,
  ConversationRating,
  EngageClaim,
  EngageVisit,
  IdentifyResult,
  ImpressionState,
  MessageFeedback,
  ProactiveEventName,
  PublicConfig,
  PublicConversationSummary,
  PublicConversationThread,
  PublicEngagement,
  PublicPresence,
  PublicProactiveItem,
  PublicStatus,
  RoadmapBoard,
  SearchHit,
  SurveyAnswer,
  VoteResult,
} from './types.js';

export interface HelpWellClientOptions {
  /** Where HelpWell is mounted, e.g. "https://app.example.com/api/helpwell". */
  baseUrl: string;
  /**
   * Sent as `Authorization: Bearer` on every `.admin` call.
   *
   * The same value goes to `createHelpWellHandler({ adminToken })` on the
   * server. It works alongside the host app's `isAdmin`: people sign in
   * through the host, machines present this token.
   */
  adminToken?: string;
  /** The shared secret behind `identify`, so `signFor` works without a second config. */
  identitySecret?: string;
  /** Abort a stalled request rather than hanging a job forever. Default 30s. */
  timeoutMs?: number;
  /** Injectable for tests and for runtimes with a wrapped fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface ChatInput {
  message: string;
  conversationId?: string | null;
  pageUrl?: string;
  email?: string;
  name?: string;
  /**
   * Your id for this one send (8 to 100 letters, digits, `_ - . :`), the
   * same when you retry it, so a support extension can tell a resent message
   * from a new one.
   */
  requestId?: string;
  /** Starting a conversation in reply to a proactive chat message: its id. */
  proactiveId?: string;
}

export class HelpWellClient {
  readonly admin: AdminApi;
  /**
   * `admin.contacts`, one step shorter, for the call a host app's server makes
   * most: `await helpwell.contacts.update('usr_8412', { attributes: { seats: 4 } })`.
   * Needs `adminToken`, like everything under `admin`.
   */
  readonly contacts: ContactsApi;

  readonly #transport: Transport;
  readonly #identitySecret: string | undefined;

  constructor(options: HelpWellClientOptions) {
    if (!options.baseUrl) {
      throw new HelpWellApiError(0, 'bad_config', 'HelpWellClient needs a baseUrl.');
    }
    this.#transport = new Transport({
      baseUrl: options.baseUrl,
      adminToken: options.adminToken,
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    });
    this.#identitySecret = options.identitySecret;
    this.admin = new AdminApi(this.#transport);
    this.contacts = this.admin.contacts;
  }

  /* ----------------------------------------------------------- identity */

  /**
   * Mint an identify token for one of your users. Convenience over the
   * re-exported `signIdentity`, for when the secret already lives in the
   * client's config and repeating it at the call site is just noise.
   */
  signFor(
    claims: Parameters<typeof signIdentity>[0],
    options: Parameters<typeof signIdentity>[2] = {},
  ): Promise<string> {
    if (!this.#identitySecret) {
      throw new HelpWellApiError(
        0,
        'bad_config',
        'signFor needs an identitySecret on the HelpWellClient.',
      );
    }
    return signIdentity(claims, this.#identitySecret, options);
  }

  /**
   * Become a known user for the rest of this client's life.
   *
   * The token is one `signFor` (or `signIdentity`) produced. The server
   * answers with the contact's cookie, the client keeps it, and every public
   * call after this — a vote, a survey answer, a tracked event — is recorded
   * against that person rather than an anonymous visitor. Use one client per
   * user when a script acts for several.
   */
  identify(token: string): Promise<IdentifyResult> {
    return this.#transport.request<IdentifyResult>('/identify', {
      method: 'POST',
      json: { token },
    });
  }

  /** Start (or confirm) an anonymous visitor, without waiting for a first call to create one. */
  visitor(): Promise<IdentifyResult> {
    return this.#transport.request<IdentifyResult>('/visitor', { method: 'POST' });
  }

  /** Drop the visitor cookie, so the next call is a new anonymous visitor. */
  forget(): void {
    this.#transport.clearCookies();
  }

  /* --------------------------------------------------------------- chat */

  chat(input: ChatInput): Promise<ChatReply> {
    return this.#transport.request<ChatReply>('/chat', { method: 'POST', json: input });
  }

  /** This visitor's own conversations, newest first. Empty before any call has set a cookie. */
  async conversations(): Promise<PublicConversationSummary[]> {
    const page = await this.#transport.request<{ items: PublicConversationSummary[] }>(
      '/conversations',
    );
    return page.items;
  }

  /** One of this visitor's threads. Another visitor's id is a 403, not a 404. */
  conversation(id: string): Promise<PublicConversationThread> {
    return this.#transport.request<PublicConversationThread>(
      `/conversations/${encodeURIComponent(id)}`,
    );
  }

  /**
   * Request a person. Intended to be used with HelpWell Cloud for live agent
   * support; without a support extension the request is refused.
   */
  handoff(id: string): Promise<{ ok: boolean }> {
    return this.#transport.request(`/conversations/${encodeURIComponent(id)}/handoff`, {
      method: 'POST',
      json: {},
    });
  }

  /**
   * Leave an email (and a name) on one of this visitor's conversations: the
   * widget's inline email card. It is saved on the contact and is not a chat
   * message. Refused for a visitor your app identified.
   */
  setContact(
    id: string,
    input: { email: string; name?: string; turnstileToken?: string },
  ): Promise<{ ok: boolean; contact: { email: string; name: string | null } }> {
    return this.#transport.request(`/conversations/${encodeURIComponent(id)}/contact`, {
      method: 'POST',
      json: input,
    });
  }

  /** Who is typing and what has been read, when a support extension provides it. */
  presence(id: string): Promise<PublicPresence> {
    return this.#transport.request<PublicPresence>(
      `/conversations/${encodeURIComponent(id)}/presence`,
    );
  }

  /** Tell the team the visitor is typing, when a support extension takes it. */
  typing(id: string, isTyping: boolean): Promise<void> {
    return this.#transport.request<void>(`/conversations/${encodeURIComponent(id)}/typing`, {
      method: 'POST',
      json: { typing: isTyping },
    });
  }

  /** The product's status, as the widget's Home tab shows it. */
  status(): Promise<PublicStatus> {
    return this.#transport.request<PublicStatus>('/status');
  }

  /** Thumbs up or down on one agent message; `null` takes the vote back. */
  feedback(messageId: string, feedback: MessageFeedback | null, comment?: string): Promise<void> {
    return this.#transport.request<void>(`/messages/${encodeURIComponent(messageId)}/feedback`, {
      method: 'POST',
      json: { feedback, comment },
    });
  }

  rateConversation(id: string, rating: ConversationRating, comment?: string): Promise<void> {
    return this.#transport.request<void>(`/conversations/${encodeURIComponent(id)}/rating`, {
      method: 'POST',
      json: { rating, comment },
    });
  }

  /* ------------------------------------------------------------- search */

  search(query: string, limit?: number): Promise<{ query: string; results: SearchHit[] }> {
    return this.#transport.request<{ query: string; results: SearchHit[] }>('/search', {
      query: { q: query, limit },
    });
  }

  /* ----------------------------------------------------------- articles */

  async articles(collection?: string): Promise<ArticleSummary[]> {
    const page = await this.#transport.request<{ items: ArticleSummary[] }>('/articles', {
      query: { collection },
    });
    return page.items;
  }

  article(slug: string): Promise<{ article: ArticleDetail; related: SearchHit[] }> {
    return this.#transport.request<{ article: ArticleDetail; related: SearchHit[] }>(
      `/articles/${encodeSlug(slug)}`,
    );
  }

  rateArticle(slug: string, value: 'up' | 'down', comment?: string): Promise<void> {
    return this.#transport.request<void>(`/articles/${encodeSlug(slug)}/rating`, {
      method: 'POST',
      json: { value, comment },
    });
  }

  async collections(): Promise<CollectionSummary[]> {
    const page = await this.#transport.request<{ items: CollectionSummary[] }>('/collections');
    return page.items;
  }

  /* ---------------------------------------------------------- changelog */

  changelog(
    options: { limit?: number; cursor?: string; tag?: string } = {},
  ): Promise<ChangelogPage> {
    return this.#transport.request<ChangelogPage>('/changelog', { query: { ...options } });
  }

  changelogEntry(id: string): Promise<ChangelogDetail> {
    return this.#transport.request<ChangelogDetail>(`/changelog/${encodeURIComponent(id)}`);
  }

  /** How many published entries this visitor has not read. Zero without a cookie. */
  async unread(): Promise<number> {
    const result = await this.#transport.request<{ count: number }>('/changelog/unread');
    return result.count;
  }

  markRead(id: string): Promise<void> {
    return this.#transport.request<void>(`/changelog/${encodeURIComponent(id)}/read`, {
      method: 'POST',
    });
  }

  /** Marks everything read and says how many entries that was. */
  async markAllRead(): Promise<number> {
    const result = await this.#transport.request<{ marked: number }>('/changelog/read-all', {
      method: 'POST',
    });
    return result.marked;
  }

  /* ------------------------------------------------------------ roadmap */

  roadmap(): Promise<RoadmapBoard> {
    return this.#transport.request<RoadmapBoard>('/roadmap');
  }

  /**
   * Toggles rather than sets: calling it twice for the same contact takes the
   * vote back off, which is what the button in the widget does.
   */
  vote(id: string): Promise<VoteResult> {
    return this.#transport.request<VoteResult>(`/roadmap/${encodeURIComponent(id)}/vote`, {
      method: 'POST',
    });
  }

  /**
   * Lands in "under review". Under the default `whoCanSubmit: 'identified'`
   * the caller must have called `identify` first, or the server answers 403.
   */
  submitIdea(title: string, body?: string): Promise<{ id: string }> {
    return this.#transport.request<{ id: string }>('/roadmap', {
      method: 'POST',
      json: { title, body },
    });
  }

  /* ------------------------------------------------------------- engage */

  /**
   * The engagements this visitor could see on a page, highest priority
   * first: targeting, schedule and frequency applied on the server. Pass what
   * is known about the visit so referrer, UTM, device and language rules can
   * be checked.
   */
  async engagements(path: string, visit: EngageVisit = {}): Promise<PublicEngagement[]> {
    const query: Record<string, string | undefined> = {
      path,
      referrer: visit.referrer,
      device: visit.device,
      lang: visit.lang,
      resume: visit.resume?.join(','),
    };
    for (const [key, value] of Object.entries(visit.utm ?? {})) query[`utm_${key}`] = value;
    const result = await this.#transport.request<{ items: PublicEngagement[] }>('/engage', {
      query,
    });
    return result.items;
  }

  /** One engagement by id, as `helpwell.engage.show(id)` asks for it. 404 when not for this visitor. */
  async engagement(id: string): Promise<PublicEngagement> {
    const result = await this.#transport.request<{ item: PublicEngagement }>(
      `/engage/${encodeURIComponent(id)}`,
    );
    return result.item;
  }

  /**
   * Ask to show an engagement now. The server applies the frequency rule and
   * the global cap and, if it may show, records it as seen. `manual` is a
   * show the page asked for by id, which those two rules do not apply to.
   */
  showEngagement(
    id: string,
    options: { session?: string; url?: string; manual?: boolean; step?: number } = {},
  ): Promise<EngageClaim> {
    return this.#transport.request<EngageClaim>(`/engage/${encodeURIComponent(id)}/show`, {
      method: 'POST',
      json: options,
    });
  }

  impression(
    id: string,
    state: ImpressionState,
    extra: { step?: number; url?: string; session?: string } = {},
  ): Promise<void> {
    return this.#transport.request<void>(`/engage/${encodeURIComponent(id)}/impression`, {
      method: 'POST',
      json: { state, ...extra },
    });
  }

  /* ---------------------------------------------------------- proactive */

  /**
   * What a support extension wants this visitor to see on `path` now: chat
   * messages and engagements. Always empty without an extension that offers
   * them. `anonymousId` is a stable id of your own for this browser or user;
   * `visit` is what the extension is told about the visit (referrer, UTM,
   * device, language), as for `engagements`. An engagement item is claimed
   * with `showEngagement('proactive:<id>')`.
   */
  async proactive(
    path: string,
    anonymousId?: string,
    visit: Omit<EngageVisit, 'resume'> = {},
  ): Promise<PublicProactiveItem[]> {
    const query: Record<string, string | undefined> = {
      path,
      anon: anonymousId,
      referrer: visit.referrer,
      device: visit.device,
      lang: visit.lang,
    };
    for (const [key, value] of Object.entries(visit.utm ?? {})) query[`utm_${key}`] = value;
    const result = await this.#transport.request<{ items: PublicProactiveItem[] }>('/proactive', {
      query,
    });
    return result.items;
  }

  /** The visitor saw, clicked or dismissed a proactive item. Each is passed on once. */
  proactiveEvent(id: string, event: ProactiveEventName, anonymousId?: string): Promise<void> {
    return this.#transport.request<void>(`/proactive/${encodeURIComponent(id)}/events`, {
      method: 'POST',
      json: { event, anon: anonymousId },
    });
  }

  surveyResponse(surveyId: string, answer: SurveyAnswer): Promise<{ id: string }> {
    return this.#transport.request<{ id: string }>(
      `/surveys/${encodeURIComponent(surveyId)}/response`,
      { method: 'POST', json: answer },
    );
  }

  /* -------------------------------------------------------------- track */

  track(name: string, props?: Record<string, unknown>, url?: string): Promise<void> {
    return this.#transport.request<void>('/track', {
      method: 'POST',
      json: { name, props, url },
    });
  }

  /* ------------------------------------------------------------- config */

  config(): Promise<PublicConfig> {
    return this.#transport.request<PublicConfig>('/config');
  }
}
