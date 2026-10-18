/**
 * The knowledge base, the article editor, and the gap list.
 *
 * The repo is authoritative (KB-01). Articles are Markdown files the team
 * already owns, so the editor never writes to the database directly: Save
 * hands the file to the host app's `writeArticle` hook, which puts it in the
 * repo, and only then is the article re-indexed. Without a hook the editor
 * still works, and offers the file to copy or download with the exact path it
 * belongs at, so the two can never disagree.
 *
 * Every change the index has seen is kept as a version, and the article page
 * shows that history with a diff a person can read: which lines changed, and
 * within an edited paragraph which words (KB-16, KB-22). An older version can
 * be restored, which saves its words again as the newest version; nothing in
 * the history is ever rewritten.
 *
 * Where the install can keep them, images are pasted, dropped or picked into
 * the Markdown (client/article-images.ts) and uploaded through its asset store.
 *
 * The gap list is the other half of the same loop: questions the agent could
 * not answer, ranked by how often they are asked, so the next doc to write is
 * obvious (GP-01).
 */

import type { GapListItem } from '@helpwell/core/agent';
import {
  captureLoginSetupPrompt,
  captureSetupPrompt,
  collapseDiff,
  type DiffLine,
  titleCase,
  writeArticleSetupPrompt,
} from '@helpwell/core/content';
import type { ArticleComparison, ArticleVersionSummary } from '@helpwell/core/repos';
import {
  html,
  IMAGE_EDITOR_STYLES,
  icon,
  join,
  markdownBlockStyles,
  type RawHtml,
  raw,
  slugPath,
} from '@helpwell/ui';
import { clientScript } from '../client/index.js';
import {
  button,
  card,
  empty,
  field,
  formatDate,
  formatDateTime,
  notice,
  pill,
  relativeTime,
  searchBox,
  segment,
  select,
  textArea,
  textInput,
} from '../components.js';
import { byMode, managedContent } from '../content-mode.js';
import { can, type DashboardContext } from '../layout.js';
import { setupPromptPanel } from '../setup-prompt.js';
import { type GapContext, gapCard } from './gap-draft.js';

export interface ArticleRow {
  slug: string;
  title: string;
  description: string | null;
  collection: string;
  status: string;
  reading_minutes: number;
  updated_at: string | Date;
  embedded: boolean;
}

export function knowledgePage(
  context: DashboardContext,
  articles: ArticleRow[],
  query: { q?: string },
  /** Folder id -> the title its _meta.json gave it. */
  collectionTitles: Map<string, string> = new Map(),
): RawHtml {
  const base = `${context.basePath}/knowledge`;

  const byCollection = new Map<string, ArticleRow[]>();
  for (const article of articles) {
    const list = byCollection.get(article.collection) ?? [];
    list.push(article);
    byCollection.set(article.collection, list);
  }

  const published = articles.filter((a) => a.status === 'published').length;
  const drafts = articles.filter((a) => a.status === 'draft').length;
  const archived = articles.filter((a) => a.status === 'archived').length;
  const embedded = articles.filter((a) => a.embedded).length;

  const toolbar = html`<div class="db-toolbar">
  ${searchBox(base, query.q ?? '', 'Search the knowledge base')}
  <span class="db-muted" style="margin-inline-start:auto">
    ${String(published)} published · ${String(drafts)} draft · ${String(archived)} archived · ${String(embedded)} embedded
  </span>
</div>`;

  if (articles.length === 0) {
    return html`
${toolbar}
${empty(
  'knowledge',
  query.q ? 'Nothing matches that' : 'No articles yet',
  query.q
    ? 'Try a different search.'
    : byMode(
        context,
        'Articles are Markdown files in your repo. Write the first one here, or run `helpwell docs generate` to draft a set from your code, then `helpwell sync` to index them.',
        'Write the first one here. Published articles appear in the help center and the agent once they are indexed. Drafts stay private.',
      ),
  query.q || !can(context, 'content')
    ? null
    : button('New article', { href: `${base}/new`, glyph: 'plus', tone: 'primary' }),
)}`;
  }

  return html`
${toolbar}

${notice(
  'info',
  managedContent(context)
    ? html`Articles are saved here. Published articles appear in the help center and the agent
    once they are indexed. Draft and archived articles stay hidden. This screen shows what is indexed right now.`
    : html`Your repo is the source of truth. Articles are Markdown files there: edit one in the repo
    and run <code>helpwell sync</code>, or edit it here, where Save writes the file through your
    app or hands it to you to put there. This screen shows what is indexed right now.`,
)}

${join(
  [...byCollection.entries()].map(
    ([collection, rows]) => html`
<section style="margin-bottom:22px">
  <h2 style="font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--hw-muted);margin:0 0 10px">
    ${collectionTitles.get(collection) ?? titleCase(collection)} <span style="font-weight:600">· ${String(rows.length)}</span>
  </h2>
  <div class="db-tablewrap">
    <table class="db-table">
      <thead>
        <tr><th>Article</th><th>Status</th><th>Reading time</th><th>Search</th><th>Updated</th></tr>
      </thead>
      <tbody>
        ${join(
          rows.map(
            (article) => html`
        <tr>
          <td>
            <a href="${base}/${slugPath(article.slug)}">${article.title}</a>
            ${
              article.description
                ? html`<div class="db-muted db-truncate" style="font-size:12.5px;margin-top:2px">${article.description}</div>`
                : null
            }
          </td>
          <td>${statusPill(article.status)}</td>
          <td class="db-nums">${String(article.reading_minutes)} min</td>
          <td>${
            article.embedded ? pill('accent', 'Text + semantic') : pill('neutral', 'Text only')
          }</td>
          <td class="db-muted">${relativeTime(article.updated_at, context)}</td>
        </tr>`,
          ),
        )}
      </tbody>
    </table>
  </div>
</section>`,
  ),
)}`;
}

function statusPill(status: string): RawHtml {
  return status === 'published'
    ? pill('good', 'Published')
    : status === 'draft'
      ? pill('warn', 'Draft')
      : pill('neutral', 'Archived');
}

export interface ArticleDetailRow extends ArticleRow {
  body: string;
  headings: { depth: number; text: string; id: string }[];
  applies_to: string | null;
  content_hash: string | null;
  /** 0006: the file relative to the docs folder, when the index knows it. */
  path?: string | null;
}

export interface ArticleHistory {
  versions: ArticleVersionSummary[];
  /** The diff on show, when a version was picked. */
  comparison: ArticleComparison | null;
  /**
   * Whether an older version can be restored: the article can be saved from
   * here, through the host's hook or a writable content source.
   */
  canRestore?: boolean;
}

export function articlePage(
  context: DashboardContext,
  article: ArticleDetailRow,
  editUrl: string | null,
  stats: { citations: number; helpful: number; unhelpful: number },
  view: {
    /** The body rendered the way the help centre renders it. */
    bodyHtml: string;
    history: ArticleHistory;
    /** A notice to show first: saved, or why not. */
    flash?: RawHtml | null;
  } = { bodyHtml: '', history: { versions: [], comparison: null } },
): RawHtml {
  const base = `${context.basePath}/knowledge/${slugPath(article.slug)}`;
  const { versions, comparison } = view.history;

  return html`
${view.flash ?? null}
<div class="db-split">
  <aside>
    ${card(
      byMode(context, 'In the repo', 'The article'),
      byMode(
        context,
        'Edit it here, or edit the file and run helpwell sync.',
        article.status === 'published'
          ? 'Edit it here. A save goes live once the article is indexed.'
          : 'Edit it here. Set its status to Published when it is ready for visitors and the agent.',
      ),
      html`<dl class="db-kv">
        <dt>File</dt><dd>${article.path ?? `${article.slug}.md`}</dd>
        <dt>Slug</dt><dd>${article.slug}</dd>
        <dt>Collection</dt><dd>${article.collection}</dd>
        <dt>Status</dt><dd>${article.status}</dd>
        <dt>Applies to</dt><dd>${article.applies_to ?? '—'}</dd>
        <dt>Indexed</dt><dd>${formatDate(article.updated_at, context)}</dd>
      </dl>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        ${can(context, 'content') ? button('Edit', { href: `${base}?edit=1`, glyph: 'article', tone: 'primary' }) : null}
        ${editUrl ? button('Open in the repo', { href: editUrl, glyph: 'external' }) : null}
      </div>`,
    )}

    ${card(
      'How it is doing',
      'From answers that cited this article.',
      html`<dl class="db-kv">
        <dt>Cited</dt><dd>${String(stats.citations)} times</dd>
        <dt>Helpful</dt><dd>${String(stats.helpful)}</dd>
        <dt>Not helpful</dt><dd>${String(stats.unhelpful)}</dd>
      </dl>`,
    )}

    ${card(
      'History',
      'Every change the index has seen, newest first.',
      historyList(context, base, versions, comparison?.to.id ?? null),
    )}
  </aside>

  <div>
    ${
      comparison
        ? diffCard(context, base, comparison, {
            // The newest version is what the article says already.
            restore:
              Boolean(view.history.canRestore) &&
              can(context, 'content') &&
              comparison.to.id !== versions[0]?.id,
          })
        : null
    }
    ${card(
      article.title,
      article.description,
      html`<div class="db-preview">${raw(view.bodyHtml)}</div>`,
    )}
  </div>
</div>
${previewStyles()}`;
}

const ORIGIN_LABEL: Record<string, string> = {
  sync: 'Sync',
  dashboard: 'Dashboard',
  api: 'API',
};

function historyList(
  context: DashboardContext,
  base: string,
  versions: ArticleVersionSummary[],
  current: number | null,
): RawHtml {
  if (versions.length === 0) {
    return html`<p class="db-muted" style="margin:0;font-size:13px">No versions recorded yet. The next change the index sees starts the history.</p>`;
  }
  return html`<ol class="db-history">
  ${join(
    versions.map((version, index) => {
      const first = index === versions.length - 1;
      const restored = version.restoredFrom
        ? versions.find((other) => other.id === version.restoredFrom)
        : undefined;
      const what = version.restoredFrom
        ? restored
          ? `Restored from ${formatDateTime(restored.createdAt, context)}`
          : 'Restored from an earlier version'
        : first
          ? 'First version'
          : 'Changed';
      return html`<li${version.id === current ? raw(' aria-current="true"') : null}>
      <a href="${base}?compare=${String(version.id)}">
        <span class="db-history__when">${formatDateTime(version.createdAt, context)}</span>
        <span class="db-history__what">${what} · ${ORIGIN_LABEL[version.origin] ?? version.origin}</span>
      </a>
    </li>`;
    }),
  )}
</ol>`;
}

function diffCard(
  context: DashboardContext,
  base: string,
  comparison: ArticleComparison,
  options: { restore: boolean },
): RawHtml {
  const summary = comparison.from
    ? `${formatDateTime(comparison.from.createdAt, context)} to ${formatDateTime(comparison.to.createdAt, context)}`
    : `The first version, ${formatDateTime(comparison.to.createdAt, context)}`;
  const counts = `${comparison.added} added · ${comparison.removed} removed`;
  const titleChanged = comparison.from && comparison.from.title !== comparison.to.title;

  return card(
    'What changed',
    `${summary}. ${counts}.`,
    titleChanged
      ? html`<p style="margin:0 0 12px;font-size:13.5px">Title: <del class="db-diff__word">${comparison.from?.title ?? ''}</del> → <ins class="db-diff__word">${comparison.to.title}</ins></p>`
      : null,
    diffView(comparison.lines),
    html`<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      ${
        options.restore
          ? html`<form method="post" action="${base}" data-confirm="Restore the version from ${formatDateTime(comparison.to.createdAt, context)}? It is saved as the newest version, and the history keeps everything in between." data-busy="Restoring…">
        <input type="hidden" name="action" value="restore">
        <input type="hidden" name="version" value="${String(comparison.to.id)}">
        ${button('Restore this version', { glyph: 'refresh', tone: 'primary' })}
      </form>`
          : null
      }
      ${button('Close', { href: base, glyph: 'close' })}
    </div>`,
  );
}

/** A unified diff, long unchanged stretches folded, changed words marked. */
export function diffView(lines: DiffLine[]): RawHtml {
  if (!lines.some((line) => line.op !== 'same')) {
    return html`<p class="db-muted" style="margin:0">No difference in the words.</p>`;
  }
  const chunks = collapseDiff(lines, 3);
  return html`<div class="db-diff" role="table" aria-label="Changes">${join(
    chunks.map((chunk) =>
      chunk.kind === 'skip'
        ? html`<div class="db-diff__skip" role="row">${String(chunk.count)} unchanged ${chunk.count === 1 ? 'line' : 'lines'}</div>`
        : join(chunk.lines.map(diffLine)),
    ),
  )}</div>`;
}

function diffLine(line: DiffLine): RawHtml {
  const sign = line.op === 'add' ? '+' : line.op === 'remove' ? '−' : ' ';
  const label = line.op === 'add' ? 'Added' : line.op === 'remove' ? 'Removed' : 'Unchanged';
  const text = line.parts
    ? join(
        line.parts.map((part) =>
          part.op === 'same'
            ? html`${part.text}`
            : part.op === 'add'
              ? html`<ins class="db-diff__word">${part.text}</ins>`
              : html`<del class="db-diff__word">${part.text}</del>`,
        ),
      )
    : html`${line.text || ' '}`;
  return html`<div class="db-diff__line db-diff__line--${line.op}" role="row"><span class="db-diff__sign" aria-label="${label}">${sign}</span><span class="db-diff__text">${text}</span></div>`;
}

/* ---------------------------------------------------------------- editor */

export interface EditorState {
  /** Null for a new article. */
  slug: string | null;
  /** Relative to the docs folder, when known; for a new one, where it would go. */
  path: string | null;
  title: string;
  description: string;
  collection: string;
  status: 'draft' | 'published' | 'archived';
  body: string;
}

export interface EditorView {
  state: EditorState;
  /** Existing collections, for the new-article picker: id and title. */
  collections: { id: string; title: string }[];
  /** The preview, rendered by the help centre's renderer. */
  previewHtml: string;
  /** Whether the host passed `writeArticle`, so Save can write. */
  canSave: boolean;
  /**
   * Whether images can be pasted, dropped or picked into the body: the
   * install has an asset store and can save the article they go in.
   */
  canUpload?: boolean;
  /** A preview or refused save returned edits that have not been saved. */
  unsaved?: boolean;
  /** The docs folder as the host named it, for "save this file to …". */
  docsDir: string;
  errors?: Record<string, string>;
  /** Shown above the form: why a save failed. */
  problem?: string | null;
  /**
   * The file to hand over when there is no hook: the composed Markdown and
   * the path it belongs at.
   */
  download?: { path: string; markdown: string } | null;
  /** The gap this article answers, shown beside it; saving marks the gap drafted. */
  gap?: GapContext | null;
  /** Shown first: who drafted it, or why the model could not. */
  intro?: RawHtml | null;
}

export function editorPage(context: DashboardContext, view: EditorView): RawHtml {
  const { state } = view;
  const isNew = state.slug === null;
  const action = isNew
    ? `${context.basePath}/knowledge/new`
    : `${context.basePath}/knowledge/${slugPath(state.slug ?? '')}`;
  const cancel = isNew ? `${context.basePath}/knowledge` : action;
  const docs = view.docsDir.replace(/\/+$/, '');

  const statusChoices = [
    { value: 'draft', label: 'Draft: not in the help center yet' },
    { value: 'published', label: 'Published' },
    {
      value: 'archived',
      label: byMode(context, 'Archived: hidden, kept in the repo', 'Archived: hidden, kept here'),
    },
  ];

  // A new article picks its folder; an existing one stays where it is, since
  // moving a file is a change to make in the repo.
  const collectionField = isNew
    ? field(
        'Collection',
        html`<input class="db-input" type="text" name="collection" list="db-collections" value="${state.collection}" placeholder="Getting started">
<datalist id="db-collections">${join(
          view.collections.map((c) => html`<option value="${c.id}">${c.title}</option>`),
        )}</datalist>`,
        'The folder it goes in. Pick one, or type a name for a new collection.',
        view.errors?.collection,
      )
    : html`<div class="db-field"><span class="db-field__label">File</span><code>${docs}/${state.path ?? ''}</code></div>`;

  return html`
${view.intro ?? null}
${view.problem ? notice('bad', view.problem) : null}
${view.download ? downloadPanel(context, view.download, docs) : null}
${
  !view.canSave && !view.download
    ? notice(
        'info',
        managedContent(context)
          ? html`This install cannot save articles from here. Write and preview as usual; <b>Save</b>
          then gives you the article to copy or download.`
          : html`This install cannot save to the repo from here yet. Write and preview as usual; <b>Save</b>
          then gives you the file to copy or download, and the exact path to put it at.`,
      )
    : null
}

<form method="post" action="${action}" id="db-editor" class="db-editor"
      ${view.unsaved ? raw('data-helpwell-dirty') : null}
      data-preview="${context.basePath}/knowledge/_preview"
      data-path="${state.path ?? ''}"${
        view.canUpload ? html` data-upload="${context.basePath}/knowledge/_upload"` : null
      }>
  <div class="db-split db-split--editor">
    <aside>
      ${card(
        'Details',
        null,
        field(
          'Title',
          textInput('title', state.title, { placeholder: 'What someone would search for' }),
          null,
          view.errors?.title,
        ),
        field(
          'Description',
          textInput('description', state.description, {
            placeholder: 'One line, shown in results',
          }),
        ),
        collectionField,
        field('Status', select('status', state.status, statusChoices), null, view.errors?.status),
        html`<div style="display:flex;gap:8px;flex-wrap:wrap">
          ${button(view.canSave ? 'Save' : 'Get the file', { name: 'action', value: 'save', glyph: view.canSave ? 'check' : 'download', tone: 'primary' })}
          ${button('Refresh preview', { name: 'action', value: 'preview', glyph: 'eye' })}
          ${button('Cancel', { href: cancel })}
        </div>`,
      )}
      ${view.gap ? gapCard(context, view.gap) : null}
      ${blocksCard()}
      ${screenshotsCard(context, docs, view.canUpload)}
      ${view.canSave || managedContent(context) ? null : card('Save straight to the repo', 'Wire up the editor once, and Save writes the file.', setupPromptPanel('write-article', writeArticleSetupPrompt({ docs })))}
    </aside>

    <div class="db-editor__panes">
      ${card(
        'Markdown',
        null,
        field(
          'Body',
          textArea('body', state.body, { rows: 24, code: true }),
          null,
          view.errors?.body,
        ),
        view.canUpload ? imageTools() : null,
      )}
      ${card(
        'Preview',
        'As the help center will show it.',
        html`<div class="db-preview" id="db-preview" aria-live="polite">${raw(view.previewHtml)}</div>`,
      )}
    </div>
  </div>
</form>
${previewStyles()}
${editorScript(context)}
${view.canUpload ? clientScript(context, 'image-editor') : null}
${view.canUpload ? clientScript(context, 'article-images') : null}`;
}

/** What the image picker offers: the formats an upload may be. */
const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/gif,image/webp';

/**
 * The image button and what it says. Hidden until the script runs, since
 * without it there is nothing to upload with.
 */
function imageTools(): RawHtml {
  return html`<div class="db-imagetools" data-image-tools hidden>
  <label class="db-btn">${raw(icon('upload', 15))}<span>Add an image</span><input type="file" accept="${ACCEPTED_IMAGES}" data-image-picker multiple></label>
  <label class="db-btn"><span>Annotate an image</span><input type="file" accept="${ACCEPTED_IMAGES}" data-annotate-picker></label>
  <span class="db-field__hint">Or paste or drop one into the Markdown. PNG, JPEG, GIF or WebP, up to 10 MB.</span>
  <span class="db-field__hint" data-image-status role="status" aria-live="polite"></span>
</div>`;
}

function downloadPanel(
  context: DashboardContext,
  file: { path: string; markdown: string },
  docs: string,
): RawHtml {
  const name = file.path.split('/').pop() ?? 'article.md';
  const href = `data:text/markdown;charset=utf-8,${encodeURIComponent(file.markdown)}`;
  return card(
    byMode(context, 'Save this file in your repo', 'Keep a copy of this article'),
    null,
    managedContent(context)
      ? html`<p style="margin:0 0 10px">Nothing was saved: this install cannot save articles from here.
      Copy or download it so your changes are not lost. It belongs at <code id="db-save-path">${file.path}</code>.</p>`
      : html`<p style="margin:0 0 10px">Nothing was saved: this install has no <code>writeArticle</code> hook.
      Put this file at <code id="db-save-path">${docs}/${file.path}</code>, then run <code>helpwell sync</code>.</p>`,
    html`
    <pre class="db-code" id="db-save-file" style="white-space:pre-wrap;max-height:320px;overflow:auto">${file.markdown}</pre>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button type="button" class="db-btn" data-copy="db-save-file">${raw('<span>Copy the file</span>')}</button>
      <button type="button" class="db-btn" data-copy="db-save-path">${raw('<span>Copy the path</span>')}</button>
      <a class="db-btn" href="${raw(href.replace(/"/g, '%22'))}" download="${name}"><span>Download ${name}</span></a>
    </div>`,
  );
}

function blocksCard(): RawHtml {
  const rows: [string, string][] = [
    ['Callout', '> [!TIP]\n> Export before you close the month.'],
    [
      'Steps',
      ':::steps\n### Open Billing\nGo to Settings, then Billing.\n### Export\nClick Export.\n:::',
    ],
    ['Tabs', ':::tabs\n== macOS\nPress Cmd+K.\n== Windows\nPress Ctrl+K.\n:::'],
    ['Accordion', ':::details How are refunds worked out?\nPro rata, to the day.\n:::'],
    ['Video', '![What it shows](https://www.youtube.com/watch?v=…)'],
  ];
  return card(
    'Blocks',
    'Callouts take NOTE, TIP, IMPORTANT, WARNING or CAUTION. Videos: YouTube, Vimeo, Loom, Wistia or an .mp4.',
    html`<div class="db-cheats">${join(
      rows.map(
        ([name, example]) =>
          html`<details><summary>${name}</summary><pre class="db-code">${example}</pre></details>`,
      ),
    )}</div>`,
  );
}

function screenshotsCard(context: DashboardContext, docs: string, canUpload = false): RawHtml {
  // With no repo there is no capture command to run, and nowhere to run it.
  if (managedContent(context)) {
    return card(
      canUpload ? 'Images' : 'Screenshots',
      null,
      canUpload
        ? html`<p style="margin:0;font-size:13px">Paste, drop or pick an image in the Markdown box and it is
      uploaded and put where the cursor is. Or use an https:// address,
      <code>![The billing page](https://…/billing.png)</code>.</p>`
        : html`<p style="margin:0;font-size:13px">Reference an image stored with your articles by its path,
      <code>![The billing page](../_screenshots/billing.png)</code>, or use an https:// address.</p>`,
    );
  }
  return card(
    'Screenshots',
    null,
    html`<p style="margin:0 0 10px;font-size:13px">Reference one by its path from the article,
      <code>![The billing page](../_screenshots/billing.png)</code>. <code>helpwell capture</code>
      retakes them from your running app, annotated, and <code>helpwell sync</code> serves them.${
        canUpload
          ? ' An image pasted, dropped or picked in the Markdown box is saved in the docs folder, under _media.'
          : null
      }</p>`,
    setupPromptPanel('capture', captureSetupPrompt({ docs })),
    setupPromptPanel('capture-login', captureLoginSetupPrompt({ docs })),
  );
}

/**
 * The preview and diff look, on this page only. The block styles are the
 * help centre's own, so the preview matches the published page.
 */
export function previewStyles(): RawHtml {
  return raw(`<style>
.db-preview { font-size: 15px; line-height: 1.7; color: var(--hw-ink2); overflow-wrap: anywhere; }
.db-preview > :first-child { margin-top: 0; }
.db-preview h1, .db-preview h2, .db-preview h3, .db-preview h4 { color: var(--hw-ink); margin: 22px 0 8px; }
.db-preview h2 { font-size: 19px; } .db-preview h3 { font-size: 16.5px; } .db-preview h4 { font-size: 15px; }
.db-preview p, .db-preview ul, .db-preview ol, .db-preview pre, .db-preview blockquote { margin: 0 0 14px; }
.db-preview img, .db-preview video { max-width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--hw-hairline); }
.db-preview pre { background: var(--hw-inner); padding: 12px 14px; border-radius: 12px; overflow-x: auto; }
.db-preview code { font-size: .9em; background: var(--hw-control); padding: 1px 5px; border-radius: 6px; }
.db-preview pre code { background: none; padding: 0; }
.db-preview blockquote { padding-inline-start: 14px; border-inline-start: 3px solid var(--hw-accent-line); color: var(--hw-muted); }
.db-preview table { border-collapse: collapse; width: 100%; font-size: 14px; }
.db-preview th, .db-preview td { padding: 8px 10px; text-align: start; border-bottom: 1px solid var(--hw-hairline); }
.db-preview .hc-anchor { display: none; }
${markdownBlockStyles('.db-preview')}
@media (min-width: 1100px) { .db-split--editor { grid-template-columns: 320px minmax(0, 1fr); } }
.db-editor__panes { display: grid; gap: 14px; }
@media (min-width: 1400px) { .db-editor__panes { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; } }
.db-editor__panes .db-card + .db-card { margin-top: 0; }
.db-editor textarea[name="body"] { min-height: 480px; }
.db-editor textarea[name="body"].db-drop { outline: 2px dashed var(--hw-accent); outline-offset: 2px; }
.db-imagetools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.db-imagetools[hidden] { display: none; }
.db-imagetools label.db-btn { position: relative; overflow: hidden; cursor: pointer; }
.db-imagetools input[type='file'] { position: absolute; inset: 0; opacity: 0; cursor: pointer; font-size: 0; }
.db-imagetools label:focus-within { outline: 2px solid var(--hw-accent); outline-offset: 2px; }
.db-annotate-image { display: block; margin: 6px 0 16px; }
${IMAGE_EDITOR_STYLES}
.db-cheats details { border-top: 1px solid var(--hw-hairline); padding: 6px 0; }
.db-cheats summary { cursor: pointer; font-weight: 600; font-size: 13px; }
.db-cheats pre { margin: 6px 0 0; white-space: pre-wrap; font-size: 12px; }
.db-history { list-style: none; margin: 0; padding: 0; }
.db-history li + li { border-top: 1px solid var(--hw-hairline); }
.db-history a { display: block; padding: 8px 10px; margin: 0 -10px; border-radius: 10px; text-decoration: none; color: var(--hw-ink2); }
.db-history a:hover { background: var(--hw-control); }
.db-history li[aria-current='true'] a { background: #F0EAFE; }
.db-history li[aria-current='true'] .db-history__when { color: #6A2FD6; }
.db-history__when { display: block; font-weight: 600; font-size: 13px; color: var(--hw-ink); }
.db-history__what { display: block; font-size: 12.5px; color: var(--hw-muted); }
.db-diff { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 12.5px; line-height: 1.55; border: 1px solid var(--hw-hairline); border-radius: 12px; overflow: hidden; }
.db-diff__line { display: flex; gap: 8px; padding: 1px 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.db-diff__line--add { background: var(--hw-good-bg); }
.db-diff__line--remove { background: var(--hw-bad-bg); }
.db-diff__sign { flex: none; width: 1ch; color: var(--hw-muted); user-select: none; }
.db-diff__line--add .db-diff__sign { color: var(--hw-good); }
.db-diff__line--remove .db-diff__sign { color: var(--hw-bad); }
.db-diff__text { flex: 1; min-width: 0; }
.db-diff__word { text-decoration: none; border-radius: 3px; padding: 0 1px; }
ins.db-diff__word { background: color-mix(in srgb, var(--hw-good) 22%, transparent); }
del.db-diff__word { background: color-mix(in srgb, var(--hw-bad) 22%, transparent); text-decoration: line-through; }
.db-diff__skip { padding: 4px 10px; background: var(--hw-inner); color: var(--hw-muted); font-family: inherit; font-size: 12px; }
</style>`);
}

/**
 * The live preview: the Markdown is posted to the dashboard as it is typed,
 * rendered on the server by the same renderer as the help centre, and swapped
 * in. Without JavaScript, "Refresh preview" does the same with a round trip.
 * The code is client/previews.ts, served as a file.
 */
function editorScript(context: DashboardContext): RawHtml {
  return clientScript(context, 'article-preview');
}

/* ------------------------------------------------------------------ gaps */

const GAP_TABS = { new: 'Open', drafted: 'Drafted', dismissed: 'Dismissed' } as const;

export function isGapStatus(value: string | null): value is GapListItem['status'] {
  return value === 'new' || value === 'drafted' || value === 'dismissed';
}

/**
 * What the last action did, shown above the list: a dismissed gap leaves the
 * Open list, so the notice names it, says where it went and offers Undo.
 */
export interface GapFlash {
  id: string;
  question: string;
  /** The status the gap was given. */
  done: GapListItem['status'];
  /** The status it had before, which Undo puts back. */
  from: GapListItem['status'];
}

function gapFlash(base: string, status: string, flash: GapFlash): RawHtml {
  const text =
    flash.done === 'new'
      ? html`Moved “${flash.question}” back to Open.`
      : html`${flash.done === 'dismissed' ? 'Dismissed' : 'Marked drafted:'} “${flash.question}”. It is under ${GAP_TABS[flash.done]} now.`;
  return notice(
    flash.done === 'dismissed' ? 'info' : 'good',
    text,
    html`<form method="post" action="${base}">
  <input type="hidden" name="id" value="${flash.id}">
  <input type="hidden" name="from" value="${status}">
  ${button('Undo', { name: 'status', value: flash.from })}
</form>`,
  );
}

export function gapsPage(
  context: DashboardContext,
  gaps: GapListItem[],
  query: {
    status?: string;
    canDraft?: boolean;
    counts?: Record<GapListItem['status'], number>;
    flash?: GapFlash | null;
  },
): RawHtml {
  const base = `${context.basePath}/gaps`;
  const status = query.status ?? 'new';
  const canDraft = (query.canDraft ?? true) && can(context, 'content');
  const canAnswer = can(context, 'content');
  const tab = (key: keyof typeof GAP_TABS) => ({
    label: query.counts ? `${GAP_TABS[key]} · ${query.counts[key]}` : GAP_TABS[key],
    href: `${base}?status=${key}`,
    current: status === key,
  });

  const toolbar = html`<div class="db-toolbar">
  ${segment([tab('new'), tab('drafted'), tab('dismissed')])}
</div>
${query.flash && canAnswer ? gapFlash(base, status, query.flash) : null}`;

  if (gaps.length === 0) {
    return html`
${toolbar}
${empty(
  'gaps',
  status === 'new' ? 'No gaps right now' : 'Nothing here',
  status === 'new'
    ? 'Every question the agent has been asked was covered by your docs. This list fills itself when one is not.'
    : undefined,
)}`;
  }

  return html`
${toolbar}

${notice(
  'info',
  canDraft
    ? "Each row is a question the agent could not answer from your docs, with the number of times it has been asked. Draft an article opens the writing model's draft in the editor; saving it marks the gap drafted."
    : html`Each row is a question the agent could not answer from your docs. Drafting an article needs a model key, so for now Write it opens an empty article. <a href="${context.basePath}/home">Add the key</a> to have the writing model draft it.`,
)}

<div class="db-tablewrap">
  <table class="db-table">
    <thead>
      <tr><th>Question</th><th>Asks</th><th>Suggested home</th><th>Last asked</th><th></th></tr>
    </thead>
    <tbody>
      ${join(
        gaps.map(
          (gap) => html`
      <tr>
        <td>
          <div style="font-weight:620">${gap.question}</div>
          ${
            gap.variants.length > 0
              ? html`<div class="db-muted db-truncate" style="font-size:12.5px;margin-top:3px">
                  also asked as: ${gap.variants.slice(0, 2).join(' · ')}
                </div>`
              : null
          }
        </td>
        <td class="db-nums">${String(gap.asks)}</td>
        <td class="db-muted">${
          gap.suggestedCollection
            ? `${gap.suggestedCollection}${gap.suggestedTitle ? ` / ${gap.suggestedTitle}` : ''}`
            : '—'
        }</td>
        <td class="db-muted">${relativeTime(gap.lastAskedAt, context)}</td>
        <td class="db-right">
          <div class="db-rowactions">
            ${
              status === 'new' && canDraft
                ? html`<form method="post" action="${base}/${encodeURIComponent(gap.id)}/draft" data-busy="Drafting…">
              ${button('Draft an article', { glyph: 'sparkle', tone: 'primary' })}
            </form>`
                : null
            }
            ${
              canAnswer
                ? html`<form method="post" action="${base}" style="display:inline-flex;gap:6px">
              <input type="hidden" name="id" value="${gap.id}">
              <input type="hidden" name="from" value="${status}">
              ${
                status === 'new'
                  ? html`${button('Write it', {
                      href: `${context.basePath}/knowledge/new?${new URLSearchParams({
                        title: gap.suggestedTitle ?? gap.question,
                        collection: gap.suggestedCollection ?? '',
                        gap: gap.id,
                      }).toString()}`,
                      glyph: 'article',
                    })}${button('Drafted', {
                      name: 'status',
                      value: 'drafted',
                      glyph: 'check',
                    })}${button('Dismiss', { name: 'status', value: 'dismissed' })}`
                  : html`${button('Move back to Open', { name: 'status', value: 'new' })}`
              }
            </form>`
                : null
            }
          </div>
        </td>
      </tr>`,
        ),
      )}
    </tbody>
  </table>
</div>`;
}
