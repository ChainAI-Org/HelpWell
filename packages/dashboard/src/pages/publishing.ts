/**
 * Changelog and roadmap: screens where a human publishes something rather
 * than reviewing what the agent did. Engage, the third, is pages/engage.ts.
 */

import type { ChangelogPage, RoadmapBoard } from '@helpwell/core/repos';
import { html, icon, join, type RawHtml, raw } from '@helpwell/ui';
import {
  button,
  card,
  empty,
  field,
  formatDate,
  pill,
  select,
  textArea,
  textInput,
} from '../components.js';
import { byMode, managedContent } from '../content-mode.js';
import { can, type DashboardContext } from '../layout.js';

/* ------------------------------------------------------------ changelog */

export function changelogAdminPage(context: DashboardContext, page: ChangelogPage): RawHtml {
  const base = `${context.basePath}/changelog`;

  return html`
<div class="db-toolbar">
  ${can(context, 'configure') ? button('Write an entry', { href: `${base}/new`, tone: 'primary', glyph: 'plus' }) : null}
  ${
    // The drafting command runs in a repo, beside the install's database.
    managedContent(context)
      ? null
      : html`<span class="db-muted" style="margin-inline-start:auto">
    Or run <code>helpwell changelog</code> to draft one from what you shipped.
  </span>`
  }
</div>

${
  page.items.length === 0
    ? empty(
        'changelog',
        'No entries yet',
        byMode(
          context,
          'Write one here, or let HelpWell draft it from your releases with `helpwell changelog`.',
          'Write one here. It goes live on your changelog as soon as you publish it.',
        ),
        can(context, 'configure')
          ? button('Write an entry', { href: `${base}/new`, tone: 'primary', glyph: 'plus' })
          : null,
      )
    : html`<div class="db-tablewrap">
  <table class="db-table">
    <thead><tr><th>Entry</th><th>Version</th><th>Status</th><th>Published</th><th>Tags</th></tr></thead>
    <tbody>
      ${join(
        page.items.map(
          (entry) => html`
      <tr>
        <td>
          <a href="${base}/${encodeURIComponent(entry.id)}">${entry.title}</a>
          ${
            entry.summary
              ? html`<div class="db-muted db-truncate" style="font-size:12.5px;margin-top:2px">${entry.summary}</div>`
              : null
          }
        </td>
        <td class="db-muted">${entry.version ?? '—'}</td>
        <td>${changelogStatusPill(entry.status)}</td>
        <td class="db-muted">${entry.publishedAt ? formatDate(entry.publishedAt, context) : '—'}</td>
        <td>${join(entry.tags.map((tag) => pill('neutral', tag)))}</td>
      </tr>`,
        ),
      )}
    </tbody>
  </table>
</div>`
}

${
  page.nextCursor
    ? html`<div style="margin-top:14px;text-align:center">${button('Older entries', {
        href: `${base}?cursor=${encodeURIComponent(page.nextCursor)}`,
      })}</div>`
    : null
}`;
}

function changelogStatusPill(status: string): RawHtml {
  if (status === 'published') return pill('good', 'Published');
  if (status === 'archived') return pill('neutral', 'Archived');
  return pill('warn', 'Draft');
}

export interface ChangelogDraft {
  id: string | null;
  version: string | null;
  title: string;
  summary: string | null;
  body: string;
  tags: string[];
  status: string;
  publishedAt: Date | string | null;
}

export function changelogEditorPage(
  context: DashboardContext,
  draft: ChangelogDraft,
  errors: Record<string, string> = {},
): RawHtml {
  const base = `${context.basePath}/changelog`;
  const action = draft.id ? `${base}/${encodeURIComponent(draft.id)}` : `${base}/new`;

  return html`
<form method="post" action="${action}" data-protect-draft ${Object.keys(errors).length ? raw('data-helpwell-dirty') : null}>
<div class="db-split">
  <aside>
    ${card(
      'About this entry',
      null,
      field(
        'Version',
        textInput('version', draft.version ?? '', { placeholder: '2.4.0' }),
        'Optional, but it makes a nice permalink.',
      ),
      field(
        'Status',
        select('status', draft.status, [
          { value: 'draft', label: 'Draft — only you can see it' },
          { value: 'published', label: 'Published — public' },
          { value: 'archived', label: 'Archived' },
        ]),
        null,
        errors.status,
      ),
      field(
        'Tags',
        textInput('tags', draft.tags.join(', '), { placeholder: 'New, Improved, Fixed' }),
        'Comma separated.',
      ),
      draft.publishedAt
        ? html`<p class="db-field__hint">Published ${formatDate(draft.publishedAt, context)}. Editing will not move that date.</p>`
        : null,
      html`<div style="margin-top:16px;display:flex;gap:8px">
        ${button('Save', { tone: 'primary', glyph: 'check' })}
        ${button('Cancel', { href: base })}
      </div>`,
    )}

    ${
      draft.id
        ? card('Danger', 'Deleting removes it from the public page and the widget immediately.')
        : null
    }
  </aside>

  ${card(
    null,
    null,
    field(
      'Title',
      textInput('title', draft.title, { placeholder: 'Faster invoice exports' }),
      null,
      errors.title,
    ),
    field(
      'Summary',
      textInput('summary', draft.summary ?? '', { placeholder: 'One line, shown in the feed.' }),
    ),
    field('Body', textArea('body', draft.body, { rows: 18, code: true }), 'Markdown.'),
  )}
</div>
</form>

${
  draft.id
    ? html`<form method="post" action="${action}" data-confirm="Delete this entry? It disappears from the public changelog straight away." style="margin-top:14px">
  <input type="hidden" name="action" value="delete">
  ${button('Delete entry', { tone: 'danger', glyph: 'trash' })}
</form>`
    : null
}`;
}

/* -------------------------------------------------------------- roadmap */

const LANES: {
  key: keyof RoadmapBoard;
  label: string;
  tone: 'accent' | 'info' | 'neutral' | 'good';
}[] = [
  { key: 'under_review', label: 'Under review', tone: 'neutral' },
  { key: 'planned', label: 'Planned', tone: 'info' },
  { key: 'in_progress', label: 'In progress', tone: 'accent' },
  { key: 'shipped', label: 'Shipped', tone: 'good' },
];

export function roadmapAdminPage(context: DashboardContext, board: RoadmapBoard): RawHtml {
  const base = `${context.basePath}/roadmap`;
  const total = LANES.reduce((sum, lane) => sum + board[lane.key].length, 0);

  if (total === 0) {
    return empty(
      'roadmap',
      'Nothing on the roadmap',
      'Add an item here, or let customers suggest one from the widget. Suggestions land in "Under review".',
      can(context, 'configure')
        ? button('Add an item', { href: `${base}/new`, tone: 'primary', glyph: 'plus' })
        : null,
    );
  }

  return html`
<div class="db-toolbar">
  ${can(context, 'configure') ? button('Add an item', { href: `${base}/new`, tone: 'primary', glyph: 'plus' }) : null}
  <span class="db-muted" style="margin-inline-start:auto">
    Moving something to Shipped is what announces it.
  </span>
</div>

<div class="db-grid db-grid--4" style="align-items:start">
  ${join(
    LANES.map(
      (lane) => html`
  <section>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      ${pill(lane.tone, lane.label)}
      <span class="db-muted" style="font-size:12.5px">${String(board[lane.key].length)}</span>
    </div>
    ${
      board[lane.key].length === 0
        ? html`<p class="db-muted" style="font-size:13px">Empty.</p>`
        : join(
            board[lane.key].map(
              (item) => html`
    <form method="post" action="${base}" class="db-card" style="padding:14px;margin-bottom:10px">
      <input type="hidden" name="id" value="${item.id}">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="font-weight:620;font-size:13.5px">${item.title}</div>
          ${item.body ? html`<div class="db-muted" style="font-size:12.5px;margin-top:3px">${item.body}</div>` : null}
        </div>
        <span class="db-pill db-pill--neutral" title="votes">${raw(icon('arrowUp', 11))}${String(item.votesCount)}</span>
      </div>
      ${
        can(context, 'configure')
          ? html`<div style="margin-top:10px">
        ${select(
          'status',
          item.status,
          LANES.map((option) => ({ value: option.key, label: option.label })),
        )}
      </div>
      <div style="margin-top:8px;display:flex;gap:6px">
        ${button('Move', { glyph: 'check' })}
      </div>`
          : html`<div class="db-muted" style="margin-top:8px;font-size:12.5px">${LANES.find((l) => l.key === item.status)?.label ?? item.status}</div>`
      }
    </form>`,
            ),
          )
    }
  </section>`,
    ),
  )}
</div>`;
}

export function roadmapEditorPage(
  context: DashboardContext,
  errors: Record<string, string> = {},
  draft: { title: string; body: string; status: string } = {
    title: '',
    body: '',
    status: 'planned',
  },
): RawHtml {
  const base = `${context.basePath}/roadmap`;
  return html`
<form method="post" action="${base}/new" class="db-card" data-protect-draft ${Object.keys(errors).length ? raw('data-helpwell-dirty') : null} style="max-width:640px">
  <h2 class="db-card__title">Add a roadmap item</h2>
  <p class="db-card__hint">It appears publicly straight away, so people can vote on it.</p>
  ${field('Title', textInput('title', draft.title, { placeholder: 'Bulk export' }), null, errors.title)}
  ${field('Detail', textArea('body', draft.body, { rows: 4, placeholder: 'Optional. What it is and why.' }))}
  ${field(
    'Lane',
    select(
      'status',
      draft.status,
      LANES.map((lane) => ({ value: lane.key, label: lane.label })),
    ),
    null,
    errors.status,
  )}
  <div style="margin-top:14px;display:flex;gap:8px">
    ${button('Add', { tone: 'primary', glyph: 'plus' })}
    ${button('Cancel', { href: base })}
  </div>
</form>`;
}
