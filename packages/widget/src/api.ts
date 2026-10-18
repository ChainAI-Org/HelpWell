/**
 * Typed client for the HelpWell HTTP API.
 *
 * Every call goes through one place so credentials, error shape and the
 * offline case are handled once rather than at twenty call sites.
 */

export interface Citation {
  slug: string;
  title: string;
  collection: string;
}

export interface ChatReply {
  pendingHuman?: boolean;
  conversationId: string;
  messageId: string;
  text: string;
  citations: Citation[];
  askForEmail?: { reason?: string };
  unresolved: boolean;
  degraded: boolean;
  /** The visitor's message was small talk, not a question. */
  smallTalk?: boolean;
}

export interface ThreadMessage {
  id: string;
  role: 'customer' | 'agent' | 'human' | 'event';
  authorName?: string | null;
  body: string;
  citations: Citation[];
  feedback: 'helpful' | 'not_helpful' | null;
  createdAt: string;
  /** Files on the message. Only a support extension ever stores any. */
  attachments?: Attachment[];
  /**
   * On an agent answer that left its question open (the docs did not cover
   * it, the agent flagged it, or no model answered), as the server judged it.
   * It is what puts the support email under an answer.
   */
  unresolved?: boolean;
  /** On an agent answer to small talk, which the support email ignores. */
  smallTalk?: boolean;
}

/** A file a visitor attached, as a support extension stored it. */
export interface Attachment {
  id: string;
  url: string;
  name: string;
  type: string;
  size: number;
}

export interface UploadPolicy {
  maxBytes: number;
  /** Media types; `image/*` style wildcards allowed. */
  types: string[];
}

/** `GET /conversations/:id`. The fields after `messages` are absent from an older server. */
export interface ConversationThread {
  id: string;
  status: string;
  mode?: 'ai' | 'human';
  messages: ThreadMessage[];
  contact?: { email: string | null; name: string | null; identified: boolean };
  /** The newest agent message that asked for an email. */
  emailAsk?: { messageId: string; reason?: string } | null;
  botVerified?: boolean;
  uploads?: UploadPolicy | null;
}

/** What a support extension says about a human conversation right now. */
export interface Presence {
  typing: { name: string } | null;
  seenUpTo?: string;
  notice?: { text: string; askEmail?: boolean };
}

export type StatusLevel =
  | 'operational'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'maintenance';

export interface WidgetStatus {
  level: StatusLevel | null;
  message: string;
  url: string | null;
  incidents: { name: string; status: string; url: string | null }[];
  source: string | null;
  updatedAt: string | null;
}

/** One block on the Home tab (`widget.home.blocks`). */
export type HomeBlock =
  | { type: 'search' }
  | { type: 'conversation' }
  | { type: 'newConversation' }
  | { type: 'articles'; title?: string; collection?: string; slugs?: string[]; limit?: number }
  | { type: 'updates'; title?: string; count?: number }
  | { type: 'status' }
  | { type: 'links'; title?: string; items?: { label: string; url: string; icon?: string }[] }
  | {
      type: 'card';
      title?: string;
      body?: string;
      image?: string;
      cta?: { label?: string; url?: string };
    }
  | { type: 'form'; formId?: string }
  // A block a newer server knows and this widget does not: skipped.
  | { type: string; [key: string]: unknown };

export interface ConversationSummary {
  id: string;
  status: string;
  topic: string | null;
  lastMessageAt: string;
  snippet: string;
}

export interface SearchHit {
  slug: string;
  title: string;
  collection: string;
  description: string | null;
  snippet: string;
  score: number;
}

export interface ArticleSummary {
  slug: string;
  title: string;
  description: string | null;
  collection: string;
  reading_minutes: number;
}

export interface ArticleDetail extends ArticleSummary {
  /** The collection's name. Absent from an older server, hence optional. */
  collection_title?: string;
  body: string;
  headings: { depth: number; text: string; id: string }[];
  applies_to: string | null;
  updated_at: string;
}

export interface ChangelogSummary {
  id: string;
  version: string | null;
  title: string;
  summary: string | null;
  tags: string[];
  coverUrl: string | null;
  publishedAt: string | null;
  read?: boolean;
}

export interface ChangelogDetail extends ChangelogSummary {
  body: string;
}

export interface RoadmapCard {
  id: string;
  title: string;
  body: string | null;
  status: 'under_review' | 'planned' | 'in_progress' | 'shipped';
  votesCount: number;
  voted: boolean;
}

export type RoadmapBoard = Record<RoadmapCard['status'], RoadmapCard[]>;

export interface WidgetConfig {
  /**
   * Present only when a support extension is installed: people can answer,
   * and these say which live features it provides.
   */
  support?: {
    human: boolean;
    uploads?: UploadPolicy | null;
    typing?: boolean;
    presence?: boolean;
    /** The extension has messages and engagements to show: poll `GET /proactive`. */
    proactive?: boolean;
  };
  /** Present only when the bot check is on and can run. */
  botCheck?: { provider: 'turnstile'; siteKey: string };
  product: {
    name: string;
    locale: string;
    /**
     * Where people can write when the agent cannot help, as a mailto link.
     * Null or absent when none is set, and whenever a support extension
     * handles human replies: then its own flow applies.
     */
    supportEmail?: string | null;
  };
  /** Who answers. Absent from an older server; no avatar means the HelpWell mark. */
  agent?: { name: string; avatarUrl: string | null };
  widget: {
    /** `draggable` starts bottom right; the visitor can move it anywhere (drag.ts). */
    position: 'bottom-right' | 'bottom-left' | 'draggable';
    offset: { x: number; y: number };
    zIndex: number;
    tabs: { home: boolean; messages: boolean; help: boolean; updates: boolean; roadmap: boolean };
    appearance: {
      theme: 'light' | 'dark' | 'system';
      /** A hex colour. Anything else falls back to the brand purple. */
      accent: string;
      bubbleStyle: 'rounded' | 'soft' | 'square';
      pattern: string;
      patternImageUrl: string | null;
      font: string;
      radius: number;
      /** An http(s) URL or a path on the host's origin. Anything else is ignored. */
      launcherIconUrl: string | null;
    };
    displayRules: {
      include: string[];
      exclude: string[];
      audience: 'all' | 'identified' | 'anonymous';
      devices: ('desktop' | 'mobile')[];
    };
    preChat: {
      when: 'never' | 'unknown_only';
      /**
       * `before` shows the form ahead of the first message. `after` skips the
       * form and lets the agent ask for an email once it has answered, via the
       * `askForEmail` banner on the reply.
       */
      timing: 'before' | 'after';
      fields: ('email' | 'name')[];
      requireEmail: boolean;
      consentLine: string;
    };
    /** A status page. When set, the Home tab links to it. */
    statusUrl: string;
    /**
     * The words at the top of Home. Absent from an older server, and empty
     * strings when unset: either way the widget's own greeting.
     * `{{ product.name }}` and `{{ contact.first_name }}` (or the original
     * `{product}` and `{first_name}`) are filled in.
     */
    greeting?: { title?: string; subtitle?: string };
    /** Absent from an older server, which means the old Home layout. */
    home?: { blocks: HomeBlock[] };
    media?: { inlineVideo: boolean };
    status?: { mode: 'auto' | 'manual'; level: StatusLevel; message: string };
  };
  helpCenter: {
    subpath: string;
    domain: string;
    search: boolean;
    askAgent: boolean;
    ratings: boolean;
    readingTime: boolean;
    poweredBy: boolean;
    theme: Record<string, unknown>;
  };
  changelog: {
    widgetTab: boolean;
    /**
     * How new entries are announced: `badge`, `drawer`, `modal`, `popup`,
     * `embed` or `none`. See `changelog-notify.ts` for what each one draws.
     */
    notification: string;
    /** How updates are grouped: by version, or under month headings. Absent: by version. */
    groupBy?: 'version' | 'date';
    roadmapEnabled: boolean;
    whoCanSubmit: 'identified' | 'anyone';
  };
  unread: number;
  /** Whether any live form pops up on a trigger. Absent from an older server: none do. */
  forms?: { triggered: boolean };
}

/** The one error type the UI has to handle. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The server's `error.details`, e.g. `{ humanCheck: 'missing' }`. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The server wants a fresh bot-check token before it will take this. */
  get needsHumanCheck(): boolean {
    return this.details.humanCheck === 'missing' || this.details.humanCheck === 'failed';
  }

  /** True when retrying might work: offline, timeout, upstream hiccup. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface ApiOptions {
  baseUrl: string;
  /** Abort a request that has clearly stalled, so the UI never hangs. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  /**
   * Carry the visitor in the `X-HelpWell-Visitor` header as well as the
   * cookie. Defaults to on when the API is on another origin than the page,
   * where browsers block or partition its cookie; off on the same origin,
   * where the cookie is all it needs.
   */
  visitorToken?: boolean;
}

/** The header the visitor token travels in, both ways. */
export const VISITOR_HEADER = 'x-helpwell-visitor';
/** What is sent before there is a token to send. */
const ASK_FOR_TOKEN = 'new';
/** What the API answers when the token sent names nobody any more. */
const FORGET_TOKEN = 'forget';
const TOKEN_KEY_PREFIX = 'helpwell:visitor:';

/**
 * The visitor token for one API, kept in localStorage under that API's
 * address (so two installs a page talks to never share one), or in memory
 * when the page does not allow storage.
 */
class VisitorToken {
  #key: string;
  #memory: string | null = null;

  constructor(apiUrl: string) {
    this.#key = `${TOKEN_KEY_PREFIX}${apiUrl}`;
  }

  get(): string | null {
    try {
      return localStorage.getItem(this.#key) ?? this.#memory;
    } catch {
      return this.#memory;
    }
  }

  /** What the API said: a fresh token to keep, or to forget the one sent. */
  take(value: string | null): void {
    if (value === null) return;
    if (value === FORGET_TOKEN || value === '') this.clear();
    else if (value.length <= 300) this.#set(value);
  }

  clear(): void {
    this.#memory = null;
    try {
      localStorage.removeItem(this.#key);
    } catch {
      // Private mode or blocked storage: the memory copy is gone either way.
    }
  }

  #set(value: string): void {
    this.#memory = value;
    try {
      localStorage.setItem(this.#key, value);
    } catch {
      // Kept in memory for this page instead.
    }
  }
}

/** The API's absolute address, and whether it is on another origin than this page. */
function apiLocation(baseUrl: string): { url: string; crossOrigin: boolean } {
  try {
    const here = typeof location === 'undefined' ? undefined : location.href;
    const url = new URL(baseUrl, here);
    const crossOrigin = here !== undefined && url.origin !== new URL(here).origin;
    return { url: url.href.replace(/\/+$/, ''), crossOrigin };
  } catch {
    return { url: baseUrl, crossOrigin: false };
  }
}

/**
 * One signal that aborts when either does. `AbortSignal.any` is the built-in
 * way; where it is missing the link is made by hand and undone once the
 * request settles, so a long-lived caller signal does not collect listeners.
 */
function combine(
  outer: AbortSignal | null | undefined,
  inner: AbortController,
): { signal: AbortSignal; release: () => void } {
  if (!outer) return { signal: inner.signal, release: () => {} };
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([outer, inner.signal]), release: () => {} };
  }
  if (outer.aborted) {
    inner.abort();
    return { signal: inner.signal, release: () => {} };
  }
  const abort = () => inner.abort();
  outer.addEventListener('abort', abort, { once: true });
  return { signal: inner.signal, release: () => outer.removeEventListener('abort', abort) };
}

export class Api {
  #baseUrl: string;
  #timeoutMs: number;
  #fetch: typeof globalThis.fetch;
  /** An injected fetch is honoured everywhere, uploads included. */
  #ownFetch: boolean;
  /** Set when the visitor travels in a header: the API is on another site. */
  #visitor: VisitorToken | null;

  constructor(options: ApiOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#ownFetch = options.fetch === undefined;
    const where = apiLocation(this.#baseUrl);
    this.#visitor =
      (options.visitorToken ?? where.crossOrigin) ? new VisitorToken(where.url) : null;
  }

  /** The visitor header for a call, when the visitor travels in one. */
  #visitorHeaders(): Record<string, string> {
    return this.#visitor ? { [VISITOR_HEADER]: this.#visitor.get() ?? ASK_FOR_TOKEN } : {};
  }

  async request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const { json, signal: outer, ...rest } = init;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.#timeoutMs);
    // The caller's signal (a view that has gone) and the timeout both cancel.
    const { signal, release } = combine(outer, timeout);

    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...rest,
        signal,
        // Cookies carry the visitor id, so cross-origin installs need this.
        // Where the cookie is blocked, the header carries it instead.
        credentials: 'include',
        headers: {
          ...(json === undefined ? {} : { 'content-type': 'application/json' }),
          ...this.#visitorHeaders(),
          ...(rest.headers as Record<string, string> | undefined),
        },
        body: json === undefined ? rest.body : JSON.stringify(json),
      });
      this.#visitor?.take(response.headers.get(VISITOR_HEADER));

      if (response.status === 204) return undefined as T;

      const payload = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
        | T
        | null;

      if (!response.ok) {
        const error = (
          payload as {
            error?: { code?: string; message?: string; details?: Record<string, unknown> };
          }
        )?.error;
        throw new ApiError(
          response.status,
          error?.code ?? 'unknown',
          error?.message ?? 'Something went wrong.',
          error?.details && typeof error.details === 'object' ? error.details : {},
        );
      }
      return payload as T;
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      // The caller cancelling is not an outage. Everything else — offline,
      // DNS failure, CORS, the timeout — lands here as one.
      if (outer?.aborted) throw new ApiError(0, 'aborted', 'Cancelled.');
      throw new ApiError(0, 'offline', 'We could not reach support just now.');
    } finally {
      clearTimeout(timer);
      release();
    }
  }

  config = () => this.request<WidgetConfig | null>('/config');

  identify = (token: string) =>
    this.request<{ contactId: string; identified: boolean; firstName?: string }>('/identify', {
      method: 'POST',
      json: { token },
    });

  /**
   * Forget the visitor cookie (and the token, where there is one), so the
   * next person at this computer starts clean.
   */
  resetVisitor = async () => {
    try {
      await this.request<void>('/visitor/reset', { method: 'POST', json: {} });
    } finally {
      this.#visitor?.clear();
    }
  };

  track = (name: string, props?: Record<string, unknown>, url?: string) =>
    this.request<void>('/track', { method: 'POST', json: { name, props, url } });

  chat = (input: {
    message: string;
    conversationId?: string | null;
    pageUrl?: string;
    honeypot?: string;
    email?: string;
    name?: string;
    /** A Turnstile token, for the first message of a conversation while the bot check is on. */
    turnstileToken?: string;
    /** This send's id, the same on a retry of it, so a resent message is not taken twice. */
    requestId?: string;
    /** The proactive chat message a new conversation is a reply to. */
    proactiveId?: string;
  }) => this.request<ChatReply>('/chat', { method: 'POST', json: input });

  /**
   * What a support extension wants shown on this page now (proactive.ts).
   * `visit` is what `GET /engage` is told: referrer, UTM, device, language.
   * Its engagements are then claimed through `/engage/proactive:<id>/show`.
   */
  proactive = (
    path: string,
    anonymousId: string,
    signal?: AbortSignal,
    visit?: URLSearchParams,
  ) => {
    const query = new URLSearchParams(visit);
    query.set('path', path);
    query.set('anon', anonymousId);
    return this.request<{ items?: unknown[]; fields?: unknown }>(`/proactive?${query}`, {
      signal,
    });
  };

  proactiveEvent = (id: string, event: 'seen' | 'clicked' | 'dismissed', anonymousId: string) =>
    this.request<void>(`/proactive/${encodeURIComponent(id)}/events`, {
      method: 'POST',
      json: { event, anon: anonymousId },
    });

  conversation = (id: string, signal?: AbortSignal) =>
    this.request<ConversationThread>(`/conversations/${encodeURIComponent(id)}`, { signal });

  /** The inline email card: an address (and name) on this conversation, not a message. */
  setContact = (
    id: string,
    input: { email: string; name?: string; honeypot?: string; turnstileToken?: string },
  ) =>
    this.request<{ ok: boolean; contact: { email: string; name: string | null } }>(
      `/conversations/${encodeURIComponent(id)}/contact`,
      { method: 'POST', json: input },
    );

  typing = (id: string, typing: boolean) =>
    this.request<void>(`/conversations/${encodeURIComponent(id)}/typing`, {
      method: 'POST',
      json: { typing },
    });

  presence = (id: string, signal?: AbortSignal) =>
    this.request<Presence>(`/conversations/${encodeURIComponent(id)}/presence`, { signal });

  status = (signal?: AbortSignal) => this.request<WidgetStatus>('/status', { signal });

  /**
   * Attach a file to a conversation. The bytes go as the body, never as a
   * form: the server refuses form posts here, because a hostile page can
   * send one. With the browser's own fetch, progress is reported through
   * XMLHttpRequest, which is the only way to see an upload advance.
   */
  upload(
    conversationId: string,
    file: Blob,
    options: { name?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<Attachment> {
    const path = `/conversations/${encodeURIComponent(conversationId)}/attachments`;
    const name = options.name ?? (file as File).name ?? 'attachment';
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'x-helpwell-filename': encodeURIComponent(name),
      ...(file.type ? { 'x-helpwell-type': file.type } : {}),
    };
    if (this.#ownFetch && options.onProgress && typeof XMLHttpRequest !== 'undefined') {
      return this.#xhrUpload(path, file, headers, options);
    }
    return this.request<Attachment>(path, {
      method: 'POST',
      body: file,
      headers,
      signal: options.signal,
    });
  }

  #xhrUpload(
    path: string,
    file: Blob,
    headers: Record<string, string>,
    options: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
  ): Promise<Attachment> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.#baseUrl}${path}`);
      xhr.withCredentials = true;
      xhr.timeout = 120_000;
      for (const [key, value] of Object.entries({ ...headers, ...this.#visitorHeaders() })) {
        xhr.setRequestHeader(key, value);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        this.#visitor?.take(xhr.getResponseHeader(VISITOR_HEADER));
        let payload: {
          error?: { code?: string; message?: string; details?: Record<string, unknown> };
        } | null = null;
        try {
          payload = JSON.parse(xhr.responseText);
        } catch {
          payload = null;
        }
        if (xhr.status >= 200 && xhr.status < 300 && payload) {
          resolve(payload as unknown as Attachment);
          return;
        }
        reject(
          new ApiError(
            xhr.status,
            payload?.error?.code ?? 'unknown',
            payload?.error?.message ?? 'The file did not upload.',
            payload?.error?.details ?? {},
          ),
        );
      };
      const offline = () =>
        reject(new ApiError(0, 'offline', 'We could not reach support just now.'));
      xhr.onerror = offline;
      xhr.ontimeout = offline;
      xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Cancelled.'));
      options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(file);
    });
  }

  seen = (id: string, messageIds: string[], signal?: AbortSignal) =>
    this.request<{ ok: boolean }>(`/conversations/${encodeURIComponent(id)}/seen`, {
      method: 'POST',
      json: { messageIds },
      signal,
    });

  conversations = (signal?: AbortSignal) =>
    this.request<{ items: ConversationSummary[] }>('/conversations', { signal });

  handoff = (id: string) =>
    this.request<{ ok: boolean }>(`/conversations/${encodeURIComponent(id)}/handoff`, {
      method: 'POST',
      json: {},
    });

  feedback = (messageId: string, feedback: 'helpful' | 'not_helpful' | null, comment?: string) =>
    this.request<void>(`/messages/${messageId}/feedback`, {
      method: 'POST',
      json: { feedback, comment },
    });

  search = (query: string, limit = 8, signal?: AbortSignal) =>
    this.request<{ query: string; results: SearchHit[] }>(
      `/search?source=widget&limit=${limit}&q=${encodeURIComponent(query)}`,
      { signal },
    );

  collections = (signal?: AbortSignal) =>
    this.request<{
      items: {
        id: string;
        title: string;
        description: string | null;
        icon: string;
        tint: string;
        articles: number;
      }[];
    }>('/collections', { signal });

  articles = (collection?: string, signal?: AbortSignal) =>
    this.request<{ items: ArticleSummary[] }>(
      collection ? `/articles?collection=${encodeURIComponent(collection)}` : '/articles',
      { signal },
    );

  article = (slug: string, signal?: AbortSignal) =>
    this.request<{ article: ArticleDetail; related: SearchHit[] }>(
      `/articles/${slug.split('/').map(encodeURIComponent).join('/')}`,
      { signal },
    );

  rateArticle = (slug: string, value: 'up' | 'down', comment?: string) =>
    this.request<void>(`/articles/${slug.split('/').map(encodeURIComponent).join('/')}/rating`, {
      method: 'POST',
      json: { value, comment },
    });

  changelog = (cursor?: string | null, limit?: number, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit) params.set('limit', String(limit));
    const query = params.toString();
    return this.request<{ items: ChangelogSummary[]; nextCursor: string | null }>(
      `/changelog${query ? `?${query}` : ''}`,
      { signal },
    );
  };

  changelogEntry = (id: string, signal?: AbortSignal) =>
    this.request<ChangelogDetail>(`/changelog/${encodeURIComponent(id)}`, { signal });

  unread = () => this.request<{ count: number }>('/changelog/unread');

  markRead = (id: string) =>
    this.request<void>(`/changelog/${encodeURIComponent(id)}/read`, { method: 'POST' });

  markAllRead = () => this.request<{ marked: number }>('/changelog/read-all', { method: 'POST' });

  roadmap = (signal?: AbortSignal) => this.request<RoadmapBoard>('/roadmap', { signal });

  vote = (id: string) =>
    this.request<{ voted: boolean; votesCount: number }>(
      `/roadmap/${encodeURIComponent(id)}/vote`,
      { method: 'POST' },
    );

  submitIdea = (title: string, body?: string) =>
    this.request<{ id: string }>('/roadmap', { method: 'POST', json: { title, body } });

  // Engagements, impressions and survey answers are not here: the engage
  // runtime (engage/index.ts) calls `request` itself, with the visit and
  // session its renderers already hold.
}
