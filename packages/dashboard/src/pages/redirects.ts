/**
 * Redirects: old help centre addresses, and the articles they became.
 *
 * Once a help centre moves here, links to its old pages live on in search
 * results, bookmarks and other people's sites. The help centre answers any
 * address it does not know by looking it up in the redirect map, and sends a
 * match on to the article with a 301. An import fills the map; this screen
 * shows it, adds and removes single addresses, and takes a whole file.
 *
 * In a repo the map is `helpwell/redirects.json`, a file to review and commit
 * like the articles, so there this screen only says where it is. For managed
 * content it is `_redirects.json` among the install's content, read and
 * written through the same `ContentSource` the help centre reads it from.
 *
 * Every target written here is one of this install's own articles, as a path
 * under the help centre. A file brought in is held to the same rule: a target
 * that is not a plain path on this site is left out, and the help centre
 * checks every target again when it answers, so the map can never become an
 * open redirect.
 */

import {
  isRedirectTarget,
  MAX_REDIRECTS,
  mergeRedirects,
  parseRedirects,
  readContentRedirects,
  redirectSourcePath,
  writeContentRedirects,
} from '@helpwell/core/content';
import { rowsOf } from '@helpwell/core/db';
import { SettingsStore } from '@helpwell/core/settings';
import { html, join, mountPath, type RawHtml, slugPath } from '@helpwell/ui';
import { sql } from 'drizzle-orm';
import {
  button,
  card,
  empty,
  field,
  notice,
  pill,
  select,
  textArea,
  textInput,
} from '../components.js';
import { managedContent } from '../content-mode.js';
import { type DashboardContext, renderDashboard } from '../layout.js';
import type { DashboardConfig } from '../server.js';

/** The most a redirects file brought in here may be. Far beyond any real one. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface ArticleChoice {
  slug: string;
  title: string;
}

/** GET `/knowledge/_redirects`. */
export async function redirectsScreen(
  config: DashboardConfig,
  context: DashboardContext,
  url: URL,
): Promise<Response> {
  return render(config, context, { flash: flashFor(url) });
}

/** POST `/knowledge/_redirects`: add one, remove one, or bring in a file. */
export async function redirectsPost(
  config: DashboardConfig,
  context: DashboardContext,
  request: Request,
): Promise<Response> {
  const source = config.content;
  if (!managedContent(context) || !source?.write) {
    return render(config, context, {}, 400);
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_FILE_BYTES + 64 * 1024) {
    return render(
      config,
      context,
      { problem: 'That file is too large to be a redirects file.' },
      413,
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return render(config, context, { problem: 'That did not arrive as a form.' }, 400);
  }
  const value = (name: string) => {
    const entry = form.get(name);
    return typeof entry === 'string' ? entry.trim() : '';
  };
  const back = (done: string) => redirect(`${context.basePath}/knowledge/_redirects?done=${done}`);
  const rules = await readContentRedirects(source);
  const helpPath = await helpCenterPath(config);

  const action = value('action');
  if (action === 'remove') {
    const from = value('from');
    const kept = rules.filter((rule) => rule.from !== from);
    if (kept.length !== rules.length) await writeContentRedirects(source, kept);
    return back('removed');
  }

  if (action === 'add') {
    const from = value('from');
    const slug = value('slug');
    const errors: Record<string, string> = {};
    const path = redirectSourcePath(from);
    if (!path) {
      errors.from =
        'Give the old address as a full URL (https://help.example.com/articles/123) or a path (/articles/123).';
    } else if (helpPath && (path === helpPath || path.startsWith(`${helpPath}/`))) {
      errors.from = 'That is an address in this help center already, not an old one.';
    }
    const article = slug ? await findArticle(config, slug) : null;
    if (!article) errors.slug = 'Pick the article it should go to.';
    if (Object.keys(errors).length > 0 || !article) {
      return render(config, context, { errors, draft: { from, slug } }, 400);
    }
    if (rules.length >= MAX_REDIRECTS && !rules.some((rule) => rule.from === from)) {
      return render(
        config,
        context,
        {
          problem: `There are already ${MAX_REDIRECTS} redirects, which is as many as there can be.`,
        },
        400,
      );
    }
    await writeContentRedirects(
      source,
      mergeRedirects(rules, [{ from, to: `${helpPath}/${slugPath(article.slug)}` }]),
    );
    return back('added');
  }

  if (action === 'import') {
    const file = form.get('file');
    let text = value('json');
    if (file instanceof Blob && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) {
        return render(
          config,
          context,
          { problem: 'That file is too large to be a redirects file.' },
          413,
        );
      }
      text = await file.text();
    }
    if (!text) {
      return render(config, context, { problem: 'Choose a redirects file, or paste one.' }, 400);
    }
    const parsed = parseRedirects(text);
    if (parsed === null) {
      return render(
        config,
        context,
        {
          problem:
            'That is not a redirects file. It should be JSON like { "redirects": [{ "from": "…", "to": "…" }] }.',
        },
        400,
      );
    }
    const usable = parsed.filter(
      (rule) => redirectSourcePath(rule.from) !== null && isRedirectTarget(rule.to),
    );
    if (usable.length > 0) await writeContentRedirects(source, mergeRedirects(rules, usable));
    return back(`imported-${usable.length}-${parsed.length - usable.length}`);
  }

  return back('nothing');
}

/* ---------------------------------------------------------------- render */

interface View {
  flash?: RawHtml | null;
  problem?: string;
  errors?: Record<string, string>;
  draft?: { from: string; slug: string };
}

async function render(
  config: DashboardConfig,
  context: DashboardContext,
  view: View,
  status = 200,
): Promise<Response> {
  const header = {
    title: 'Redirects',
    subtitle: 'Old help center addresses, sent on to the articles they became.',
    actions: button('All articles', { href: `${context.basePath}/knowledge`, glyph: 'back' }),
  };
  const body = await screen(config, context, view);
  return new Response(renderDashboard(context, 'knowledge', header, body), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function screen(
  config: DashboardConfig,
  context: DashboardContext,
  view: View,
): Promise<RawHtml> {
  if (!managedContent(context)) {
    return notice(
      'info',
      html`Redirects are the <code>helpwell/redirects.json</code> file in your repo, which
      <code>helpwell import</code> writes and the help center reads. Edit it there, like the articles.`,
    );
  }
  const source = config.content;
  if (!source?.write) {
    return notice(
      'info',
      'This install’s content cannot be written from here, so its redirects cannot be changed here either.',
    );
  }

  const [rules, articles, helpPath] = await Promise.all([
    readContentRedirects(source),
    articleChoices(config),
    helpCenterPath(config),
  ]);
  const titles = new Map(articles.map((article) => [article.slug, article.title]));
  const base = `${context.basePath}/knowledge/_redirects`;

  const table =
    rules.length === 0
      ? empty(
          'external',
          'No redirects yet',
          'An import from another help center adds one for every article it brings over. You can add one by hand below.',
        )
      : html`<div class="db-tablewrap">
  <table class="db-table">
    <thead><tr><th>Old address</th><th>Goes to</th><th></th></tr></thead>
    <tbody>${join(
      rules.map((rule) => {
        const slug = articleSlug(rule.to, helpPath);
        const title = slug ? titles.get(slug) : undefined;
        return html`<tr>
      <td class="db-truncate" title="${rule.from}"><code>${rule.from}</code></td>
      <td>${
        title && slug
          ? html`<a href="${context.basePath}/knowledge/${slugPath(slug)}">${title}</a>`
          : html`<code>${rule.to}</code> ${pill('warn', 'Not an article here')}`
      }</td>
      <td class="db-right">
        <form method="post" action="${base}" data-confirm="Remove the redirect from ${rule.from}?">
          <input type="hidden" name="action" value="remove">
          <input type="hidden" name="from" value="${rule.from}">
          ${button('Remove', { glyph: 'trash' })}
        </form>
      </td>
    </tr>`;
      }),
    )}</tbody>
  </table>
</div>`;

  return html`
${view.flash ?? null}
${view.problem ? notice('bad', view.problem) : null}
${notice(
  'info',
  'When someone follows a link to an address your old help center used, they are sent on to the article it became. It works once the old domain points at this help center.',
)}
${card(
  'Add a redirect',
  null,
  html`<form method="post" action="${base}">
    <input type="hidden" name="action" value="add">
    ${field(
      'Old address',
      textInput('from', view.draft?.from ?? '', {
        placeholder: 'https://help.example.com/articles/123-refunds',
      }),
      'A full URL, or just its path.',
      view.errors?.from,
    )}
    ${field(
      'Goes to',
      select('slug', view.draft?.slug ?? '', [
        { value: '', label: articles.length ? 'Pick an article' : 'No articles yet' },
        ...articles.map((article) => ({ value: article.slug, label: article.title })),
      ]),
      null,
      view.errors?.slug,
    )}
    <div>${button('Add redirect', { glyph: 'plus', tone: 'primary' })}</div>
  </form>`,
)}
${card(`Redirects · ${String(rules.length)}`, null, table)}
${card(
  'Bring in a redirects file',
  'A redirects file from an import or another HelpWell install: JSON like { "redirects": [{ "from": "…", "to": "/help/…" }] }. Its addresses are added to these; one already here is replaced.',
  html`<form method="post" action="${base}" enctype="multipart/form-data">
    <input type="hidden" name="action" value="import">
    ${field('File', html`<input class="db-input" type="file" name="file" accept="application/json,.json">`)}
    ${field('Or paste it', textArea('json', '', { rows: 4, code: true }))}
    ${button('Bring it in', { glyph: 'upload' })}
  </form>`,
)}`;
}

function flashFor(url: URL): RawHtml | null {
  const done = url.searchParams.get('done');
  if (done === 'added') return notice('good', 'Added. It works in the help center straight away.');
  if (done === 'removed') return notice('good', 'Removed.');
  const imported = done ? /^imported-(\d+)-(\d+)$/.exec(done) : null;
  if (imported) {
    const [count, skipped] = [Number(imported[1]), Number(imported[2])];
    const left =
      skipped > 0
        ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} left out: the old address or the target was not one this help center can use.`
        : '';
    return notice(
      count > 0 ? 'good' : 'warn',
      `Brought in ${count} ${count === 1 ? 'redirect' : 'redirects'}.${left}`,
    );
  }
  return null;
}

/* -------------------------------------------------------------- plumbing */

/**
 * Where the help centre is, which targets are written under: the setting, or
 * /help, as the importer writes them. '' for a help centre at the root.
 */
async function helpCenterPath(config: DashboardConfig): Promise<string> {
  const settings = await new SettingsStore(config.db).get();
  return mountPath(settings.helpCenter.subpath || '/help');
}

/** The article a target names, when it is one under the help centre. */
function articleSlug(to: string, helpPath: string): string | null {
  if (!to.startsWith(`${helpPath}/`)) return null;
  try {
    return decodeURIComponent(to.slice(helpPath.length + 1)).replace(/\/+$/, '') || null;
  } catch {
    return null;
  }
}

async function articleChoices(config: DashboardConfig): Promise<ArticleChoice[]> {
  const result = await config.db.execute(sql`
    SELECT slug, title FROM helpwell.article_index
    WHERE status <> 'archived'
    ORDER BY collection, order_index, title
  `);
  return rowsOf<ArticleChoice>(result);
}

async function findArticle(config: DashboardConfig, slug: string): Promise<ArticleChoice | null> {
  const result = await config.db.execute(
    sql`SELECT slug, title FROM helpwell.article_index WHERE slug = ${slug} LIMIT 1`,
  );
  return rowsOf<ArticleChoice>(result)[0] ?? null;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}
