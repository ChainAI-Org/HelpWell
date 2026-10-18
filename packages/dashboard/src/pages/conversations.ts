/**
 * Conversations: a review log, not a work queue.
 *
 * Nobody is assigned anything here and nothing is waiting on a reply. The
 * screen exists so a human can read what the agent said, correct a topic, tag
 * a pattern, and mark that they have looked (IN-01).
 */

import type { ConversationPage, ConversationThread } from '@helpwell/core/repos';
import {
  html,
  icon,
  join,
  type RawHtml,
  raw,
  renderMarkdown,
  safeHref,
  slugPath,
} from '@helpwell/ui';
import {
  button,
  card,
  duration,
  empty,
  formatDate,
  meter,
  money,
  person,
  relativeTime,
  searchBox,
  segment,
  statusPill,
} from '../components.js';
import type { DashboardContext } from '../layout.js';

export interface ConversationsQuery {
  status?: 'resolved' | 'unresolved';
  q?: string;
  /** Exact topic, as the agent or a reviewer assigned it. */
  topic?: string;
  cursor?: string;
}

export function conversationsPage(
  context: DashboardContext,
  page: ConversationPage,
  query: ConversationsQuery,
): RawHtml {
  const base = `${context.basePath}/conversations`;
  const withParams = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...query, ...patch };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, String(value));
    }
    const encoded = params.toString();
    return encoded ? `${base}?${encoded}` : base;
  };
  const filtered = Boolean(query.q || query.status || query.topic);

  if (page.items.length === 0) {
    return html`
${toolbar(base, query, withParams)}
${empty(
  'conversations',
  filtered ? 'Nothing matches those filters' : 'No conversations yet',
  filtered
    ? 'Clear the filters to see everything.'
    : 'Once someone asks the widget a question, it will appear here.',
  filtered ? button('Clear filters', { href: base }) : null,
)}`;
  }

  return html`
${toolbar(base, query, withParams)}
<div class="db-tablewrap">
  <table class="db-table">
    <thead>
      <tr>
        <th>Person</th>
        <th>Question</th>
        <th>Topic</th>
        <th>Status</th>
        <th>Messages</th>
        <th>Last message</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${join(
        page.items.map(
          (item) => html`
      <tr>
        <td>${person(item.contact)}</td>
        <td><a class="db-truncate" style="display:block" href="${base}/${encodeURIComponent(item.id)}">${item.snippet || 'Conversation'}</a></td>
        <td>${
          item.topic
            ? html`<a class="db-pill db-pill--accent" href="${raw(safeHref(withParams({ topic: item.topic, cursor: undefined })))}" title="Only this topic">${item.topic}</a>`
            : html`<span class="db-muted">—</span>`
        }</td>
        <td>${statusPill(item.status)}</td>
        <td class="db-nums">${item.messageCount}</td>
        <td class="db-muted">${relativeTime(item.lastMessageAt, context)}</td>
        <td class="db-right">${
          item.reviewedAt
            ? html`<span class="db-pill db-pill--neutral" title="Reviewed ${formatDate(item.reviewedAt, context)}">${raw(icon('check', 12))} Reviewed</span>`
            : null
        }</td>
      </tr>`,
        ),
      )}
    </tbody>
  </table>
</div>
${
  page.nextCursor
    ? html`<div style="margin-top:14px;text-align:center">${button('Older conversations', {
        href: withParams({ cursor: page.nextCursor }),
      })}</div>`
    : null
}`;
}

function toolbar(
  base: string,
  query: ConversationsQuery,
  withParams: (patch: Record<string, string | undefined>) => string,
): RawHtml {
  return html`<div class="db-toolbar">
  ${searchBox(base, query.q ?? '', 'Search questions, names, emails')}
  ${segment([
    {
      label: 'All',
      href: withParams({ status: undefined, cursor: undefined }),
      current: !query.status,
    },
    {
      label: 'Unresolved',
      href: withParams({ status: 'unresolved', cursor: undefined }),
      current: query.status === 'unresolved',
    },
    {
      label: 'Resolved',
      href: withParams({ status: 'resolved', cursor: undefined }),
      current: query.status === 'resolved',
    },
  ])}
  ${
    query.topic
      ? html`<span class="db-tag">Topic: ${query.topic}
      <a href="${raw(safeHref(withParams({ topic: undefined, cursor: undefined })))}" aria-label="Clear the topic filter">${raw(icon('close', 11))}</a>
    </span>`
      : null
  }
</div>`;
}

/* --------------------------------------------------------------- thread */

export function conversationPage(context: DashboardContext, thread: ConversationThread): RawHtml {
  const base = `${context.basePath}/conversations/${encodeURIComponent(thread.id)}`;

  return html`
<div class="db-split">
  <aside>
    ${card(
      'Who',
      'What the product told us, and nothing else.',
      thread.contact.id
        ? html`<a href="${context.basePath}/contacts/${encodeURIComponent(thread.contact.id)}">${person(
            thread.contact,
            thread.contact.identified ? 'Signed in' : 'Anonymous visitor',
          )}</a>`
        : html`<p class="db-muted">Anonymous visitor</p>`,
    )}

    ${card(
      'This conversation',
      null,
      html`<dl class="db-kv">
        <dt>Started</dt><dd>${formatDate(thread.startedAt, context)}</dd>
        <dt>Messages</dt><dd>${String(thread.messageCount)}</dd>
        <dt>Cost</dt><dd>${money(thread.costUsd)}</dd>
        ${thread.pageUrl ? html`<dt>Page</dt><dd class="db-truncate">${thread.pageUrl}</dd>` : null}
        ${thread.rating ? html`<dt>Rating</dt><dd>${thread.rating}</dd>` : null}
      </dl>`,
    )}

    <form class="db-card" method="post" action="${base}">
      <h2 class="db-card__title">Review</h2>
      <p class="db-card__hint">Correct the topic, add a tag, mark that you have read it.</p>

      <label class="db-field">
        <span class="db-field__label">Topic</span>
        <input class="db-input" name="topic" value="${thread.topic ?? ''}" placeholder="e.g. Billing">
      </label>

      <label class="db-field">
        <span class="db-field__label">Status</span>
        <select class="db-select" name="status">
          <option value="unresolved"${thread.status === 'unresolved' ? raw(' selected') : null}>Unresolved</option>
          <option value="resolved"${thread.status === 'resolved' ? raw(' selected') : null}>Resolved</option>
        </select>
      </label>

      <label class="db-field">
        <span class="db-field__label">Add a tag</span>
        <input class="db-input" name="tag" placeholder="billing, bug, pricing…">
      </label>

      ${
        thread.tags.length > 0
          ? html`<div class="db-tagrow" style="margin-bottom:14px">${join(
              thread.tags.map(
                (tag) => html`<span class="db-tag">${tag}
              <button type="submit" name="removeTag" value="${tag}" aria-label="Remove ${tag}">${raw(icon('close', 11))}</button>
            </span>`,
              ),
            )}</div>`
          : null
      }

      <label class="db-switch" style="padding-top:0">
        <input type="checkbox" name="reviewed" value="1"${thread.reviewedAt ? raw(' checked') : null}>
        <span class="db-switch__text">
          <span class="db-switch__title">Reviewed</span>
          <span class="db-switch__hint" style="display:block">${
            thread.reviewedAt
              ? `Marked ${formatDate(thread.reviewedAt, context)}`
              : 'Not yet looked at'
          }</span>
        </span>
      </label>

      <div style="margin-top:14px">${button('Save', { tone: 'primary', glyph: 'check' })}</div>
    </form>
  </aside>

  ${card(
    null,
    null,
    html`<div class="db-thread">
      ${join(thread.messages.map((message) => messageBubble(message, context)))}
    </div>`,
  )}
</div>`;
}

type Message = ConversationThread['messages'][number];
type Source = Message['sources'][number];

function messageBubble(message: Message, context: DashboardContext): RawHtml {
  if (message.role === 'event') {
    return html`<div class="db-msg__event">${message.body}</div>`;
  }

  const body =
    message.role === 'agent'
      ? html`<div class="db-msg__bubble db-msg__bubble--rich">${raw(renderMarkdown(message.body).html)}</div>`
      : html`<div class="db-msg__bubble">${message.body}</div>`;

  return html`<div class="db-msg db-msg--${message.role}">
  ${body}
  ${
    message.citations.length > 0
      ? html`<div class="db-tagrow" style="margin-top:6px">${join(
          message.citations.map((citation) => {
            const source = message.sources.find((s) => s.slug === citation.slug);
            return html`<a class="db-cite" href="${context.basePath}/knowledge/${slugPath(citation.slug)}">${raw(
              icon('article', 11),
            )}${citation.title}${source ? html`<span class="db-cite__how">${matchLabel(source)}</span>` : null}</a>`;
          }),
        )}</div>`
      : null
  }
  ${message.role === 'agent' ? reviewPanel(message) : null}
  ${
    message.toolCalls.length > 0
      ? html`<div class="db-tool">${join(
          message.toolCalls.map(
            (call) =>
              html`${call.name}(${JSON.stringify(call.arguments)})${call.ms ? ` · ${String(call.ms)}ms` : ''}\n`,
          ),
        )}</div>`
      : null
  }
  <div class="db-msg__meta">
    <span>${relativeTime(message.createdAt, context)}</span>
    ${message.model ? html`<span>${message.model}</span>` : null}
    ${message.latencyMs !== null && message.role === 'agent' ? html`<span title="How long the visitor waited">${duration(message.latencyMs)}</span>` : null}
    ${message.costUsd !== null && message.role === 'agent' ? html`<span title="What this reply cost">${money(message.costUsd)}</span>` : null}
    ${
      message.role === 'agent' && (message.tokensIn || message.tokensOut)
        ? html`<span title="Tokens in and out">${(message.tokensIn ?? 0).toLocaleString()} in · ${(message.tokensOut ?? 0).toLocaleString()} out</span>`
        : null
    }
    ${
      message.feedback
        ? html`<span>${raw(
            icon(message.feedback === 'helpful' ? 'thumbUp' : 'thumbDown', 12),
          )} ${message.feedback === 'helpful' ? 'Helpful' : 'Not helpful'}</span>`
        : null
    }
  </div>
</div>`;
}

/**
 * How sure HelpWell was of one answer, and what search found for it. Read
 * only: the score and its reason are the agent's own, and there is nothing
 * to tune here. The reason is text the model helped write, so it is escaped
 * like any other.
 */
function reviewPanel(message: Message): RawHtml | null {
  if (message.confidence === null && message.sources.length === 0) return null;
  return html`<details class="db-review">
  <summary>
    ${
      message.confidence === null
        ? html`<span class="db-review__label">What search found</span>`
        : html`<span class="db-review__label">Confidence</span>${meter('Confidence', message.confidence)}`
    }
    ${message.certainty ? html`<span class="db-review__certainty">${CERTAINTY_LABEL[message.certainty]}</span>` : null}
  </summary>
  ${message.confidenceReason ? html`<p class="db-review__reason">${message.confidenceReason}</p>` : null}
  ${
    message.sources.length > 0
      ? html`<table class="db-review__sources">
    <caption>Passages the answer was given</caption>
    <thead><tr><th scope="col">#</th><th scope="col">Article</th><th scope="col">Similarity</th><th scope="col">Found by</th><th scope="col">Used</th></tr></thead>
    <tbody>${join(
      message.sources.map(
        (source) => html`<tr${source.cited ? raw(' data-cited="true"') : null}>
      <td class="db-nums">${source.ref > 0 ? String(source.ref) : '—'}</td>
      <td>${source.title}</td>
      <td class="db-nums">${source.similarity === null ? '—' : source.similarity.toFixed(2)}</td>
      <td>${foundBy(source)}</td>
      <td>${source.cited ? (source.inferred ? 'Followed, not cited' : source.ref > 0 ? 'Cited' : 'Attached') : 'Not used'}</td>
    </tr>`,
      ),
    )}</tbody>
  </table>`
      : null
  }
</details>`;
}

const CERTAINTY_LABEL: Record<NonNullable<Message['certainty']>, string> = {
  answered: 'Model said: answered',
  partial: 'Model said: partly answered',
  not_covered: 'Model said: not in the docs',
};

function foundBy(source: Source): string {
  const text = source.matchedBy.includes('text');
  const meaning = source.matchedBy.includes('semantic');
  if (text && meaning) return 'Words and meaning';
  if (meaning) return 'Meaning';
  if (text) return 'Words';
  return source.ref === 0 ? 'Attached by the agent' : '—';
}

/** The short line on a citation chip: how close it was. */
function matchLabel(source: Source): string {
  if (source.inferred) return 'followed';
  if (source.similarity !== null) return `${source.similarity.toFixed(2)} similar`;
  if (source.matchedBy.includes('text')) return 'word match';
  return '';
}
