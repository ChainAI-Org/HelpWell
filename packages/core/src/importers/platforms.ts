/**
 * Importers for the help desks people move from (MG-01): Zendesk, Intercom,
 * Help Scout, Freshdesk, Document360 and Crisp. GitBook and Notion export
 * folders, so they are read by local.ts instead.
 *
 * Each one reads that platform's public API with a key the person sets in
 * their own environment, maps its hierarchy onto HelpWell's one level of
 * collections, and returns plain `ImportedArticle`s; writing them is
 * write.ts's job. Nothing here stores or prints a key.
 */

import { HelpWellError } from '../errors.js';
import { htmlToMarkdown } from './html-to-markdown.js';
import type { ImportedArticle, ImportedCollection, ImportPlan } from './plan.js';

export interface PlatformOptions {
  fetch?: typeof fetch;
  /** Environment to read keys from. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Called with a short progress line. */
  onProgress?: (text: string) => void;
  subdomain?: string;
  locale?: string;
  email?: string;
  websiteId?: string;
}

export const PLATFORMS = [
  'zendesk',
  'intercom',
  'helpscout',
  'freshdesk',
  'document360',
  'crisp',
] as const;
export type Platform = (typeof PLATFORMS)[number];

/** The environment variable each platform's key is read from. */
export const PLATFORM_KEYS: Record<Platform, string[]> = {
  zendesk: ['ZENDESK_API_TOKEN'],
  intercom: ['INTERCOM_TOKEN'],
  helpscout: ['HELPSCOUT_DOCS_API_KEY'],
  freshdesk: ['FRESHDESK_API_KEY'],
  document360: ['DOCUMENT360_API_TOKEN'],
  crisp: ['CRISP_IDENTIFIER', 'CRISP_KEY'],
};

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

async function getJson<T>(
  doFetch: typeof fetch,
  url: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await doFetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new HelpWellError(
        'unauthorized',
        `${new URL(url).host} refused the key (HTTP ${response.status}). Check the key and its permissions.`,
      );
    }
    if (!response.ok) {
      throw new HelpWellError(
        'upstream_failed',
        `${new URL(url).host} answered HTTP ${response.status} for ${new URL(url).pathname}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function need(env: Record<string, string | undefined>, name: string, platform: string): string {
  const value = env[name];
  if (!value) {
    throw new HelpWellError(
      'not_configured',
      `Set ${name} in your environment to import from ${platform}. HelpWell reads it from there and never stores it.`,
    );
  }
  return value;
}

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

export async function importFromPlatform(
  platform: Platform,
  options: PlatformOptions = {},
): Promise<ImportPlan> {
  const run = {
    zendesk: zendesk,
    intercom: intercom,
    helpscout: helpScout,
    freshdesk: freshdesk,
    document360: document360,
    crisp: crisp,
  }[platform];
  return run({ fetch: options.fetch ?? fetch, env: options.env ?? process.env, ...options });
}

type Resolved = PlatformOptions & {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
};

/* ---------------------------------------------------------------- Zendesk */

/**
 * Zendesk Guide. A public help centre needs no key at all; set
 * ZENDESK_API_TOKEN and --email to include restricted articles. Sections
 * become collections, because they are what an article sits in.
 */
async function zendesk(options: Resolved): Promise<ImportPlan> {
  const sub = options.subdomain?.replace(/\.zendesk\.com.*$/, '').replace(/^https?:\/\//, '');
  if (!sub)
    throw new HelpWellError(
      'bad_request',
      'Zendesk needs --subdomain (acme for acme.zendesk.com).',
    );
  const locale = options.locale ?? 'en-us';
  const token = options.env.ZENDESK_API_TOKEN;
  const headers: Record<string, string> =
    token && options.email ? { authorization: basic(`${options.email}/token`, token) } : {};
  const base = `https://${sub}.zendesk.com/api/v2/help_center/${locale}`;

  const sections = new Map<number, ImportedCollection>();
  for (let url: string | null = `${base}/sections.json?per_page=100`; url; ) {
    const page: {
      sections: { id: number; name: string; description?: string; position?: number }[];
      next_page: string | null;
    } = await getJson(options.fetch, url, headers);
    for (const s of page.sections) {
      sections.set(s.id, {
        title: s.name,
        description: s.description || null,
        order: s.position ?? null,
      });
    }
    url = page.next_page;
  }

  const articles: ImportedArticle[] = [];
  for (let url: string | null = `${base}/articles.json?per_page=100`; url; ) {
    const page: {
      articles: {
        title: string;
        body: string | null;
        html_url: string;
        section_id: number;
        draft: boolean;
        position?: number;
      }[];
      next_page: string | null;
    } = await getJson(options.fetch, url, headers);
    for (const a of page.articles) {
      articles.push({
        title: a.title,
        body: htmlToMarkdown(a.body ?? '', { baseUrl: a.html_url }),
        collection: sections.get(a.section_id) ?? { title: 'General' },
        status: a.draft ? 'draft' : 'published',
        order: a.position ?? null,
        sourceUrl: a.html_url,
      });
    }
    options.onProgress?.(`${articles.length} articles`);
    url = page.next_page;
  }
  return { source: 'zendesk', articles, warnings: [] };
}

/* --------------------------------------------------------------- Intercom */

/** Intercom Articles. INTERCOM_TOKEN is an access token with read access to articles. */
async function intercom(options: Resolved): Promise<ImportPlan> {
  const token = need(options.env, 'INTERCOM_TOKEN', 'Intercom');
  const headers = { authorization: `Bearer ${token}`, 'intercom-version': '2.11' };
  const base = 'https://api.intercom.io';

  const collections = new Map<string, ImportedCollection>();
  for (let page = 1, pages = 1; page <= pages; page++) {
    const result: {
      data: { id: string; name: string; description?: string | null; order?: number }[];
      pages?: { total_pages?: number };
    } = await getJson(
      options.fetch,
      `${base}/help_center/collections?page=${page}&per_page=150`,
      headers,
    );
    for (const c of result.data) {
      collections.set(String(c.id), {
        title: c.name,
        description: c.description ?? null,
        order: c.order ?? null,
      });
    }
    pages = result.pages?.total_pages ?? 1;
  }

  const articles: ImportedArticle[] = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const result: {
      data: {
        title: string;
        description?: string | null;
        body: string | null;
        state: string;
        parent_id: string | number | null;
        url: string | null;
      }[];
      pages?: { total_pages?: number };
    } = await getJson(options.fetch, `${base}/articles?page=${page}&per_page=50`, headers);
    for (const a of result.data) {
      articles.push({
        title: a.title,
        description: a.description || null,
        body: htmlToMarkdown(a.body ?? '', { baseUrl: a.url ?? undefined }),
        collection: collections.get(String(a.parent_id)) ?? { title: 'General' },
        status: a.state === 'published' ? 'published' : 'draft',
        sourceUrl: a.url,
      });
    }
    options.onProgress?.(`${articles.length} articles`);
    pages = result.pages?.total_pages ?? 1;
  }
  return { source: 'intercom', articles, warnings: [] };
}

/* ------------------------------------------------------------- Help Scout */

/** Help Scout Docs. HELPSCOUT_DOCS_API_KEY is the Docs API key from your profile. */
async function helpScout(options: Resolved): Promise<ImportPlan> {
  const key = need(options.env, 'HELPSCOUT_DOCS_API_KEY', 'Help Scout');
  const headers = { authorization: basic(key, 'X') };
  const base = 'https://docsapi.helpscout.net/v1';

  const articles: ImportedArticle[] = [];
  const collections: { id: string; name: string; description?: string; order?: number }[] = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const result: {
      collections: { page: number; pages: number; items: typeof collections };
    } = await getJson(options.fetch, `${base}/collections?page=${page}`, headers);
    collections.push(...result.collections.items);
    pages = result.collections.pages;
  }

  for (const collection of collections) {
    const target: ImportedCollection = {
      title: collection.name,
      description: collection.description ?? null,
      order: collection.order ?? null,
    };
    for (let page = 1, pages = 1; page <= pages; page++) {
      const refs: { articles: { page: number; pages: number; items: { id: string }[] } } =
        await getJson(
          options.fetch,
          `${base}/collections/${collection.id}/articles?page=${page}&status=all`,
          headers,
        );
      for (const ref of refs.articles.items) {
        const { article } = await getJson<{
          article: { name: string; text: string; status: string; publicUrl?: string };
        }>(options.fetch, `${base}/articles/${ref.id}`, headers);
        articles.push({
          title: article.name,
          body: htmlToMarkdown(article.text ?? '', { baseUrl: article.publicUrl }),
          collection: target,
          status: article.status === 'published' ? 'published' : 'draft',
          sourceUrl: article.publicUrl ?? null,
        });
      }
      options.onProgress?.(`${articles.length} articles`);
      pages = refs.articles.pages;
    }
  }
  return { source: 'helpscout', articles, warnings: [] };
}

/* -------------------------------------------------------------- Freshdesk */

/** Freshdesk Solutions. --subdomain acme for acme.freshdesk.com, and FRESHDESK_API_KEY. */
async function freshdesk(options: Resolved): Promise<ImportPlan> {
  const key = need(options.env, 'FRESHDESK_API_KEY', 'Freshdesk');
  const sub = options.subdomain?.replace(/\.freshdesk\.com.*$/, '').replace(/^https?:\/\//, '');
  if (!sub)
    throw new HelpWellError(
      'bad_request',
      'Freshdesk needs --subdomain (acme for acme.freshdesk.com).',
    );
  const headers = { authorization: basic(key, 'X') };
  const base = `https://${sub}.freshdesk.com/api/v2/solutions`;

  const articles: ImportedArticle[] = [];
  const categories: { id: number; name: string }[] = await getJson(
    options.fetch,
    `${base}/categories`,
    headers,
  );
  for (const category of categories) {
    const folders: { id: number; name: string; description?: string | null }[] = await getJson(
      options.fetch,
      `${base}/categories/${category.id}/folders`,
      headers,
    );
    for (const folder of folders) {
      const target: ImportedCollection = {
        title: folder.name,
        description: folder.description ?? null,
      };
      for (let page = 1; ; page++) {
        const batch: { id: number; title: string; description: string; status: number }[] =
          await getJson(
            options.fetch,
            `${base}/folders/${folder.id}/articles?page=${page}&per_page=100`,
            headers,
          );
        for (const a of batch) {
          const url = `https://${sub}.freshdesk.com/support/solutions/articles/${a.id}`;
          articles.push({
            title: a.title,
            body: htmlToMarkdown(a.description ?? '', { baseUrl: url }),
            collection: target,
            status: a.status === 2 ? 'published' : 'draft',
            sourceUrl: url,
          });
        }
        options.onProgress?.(`${articles.length} articles`);
        if (batch.length < 100) break;
      }
    }
  }
  return { source: 'freshdesk', articles, warnings: [] };
}

/* ------------------------------------------------------------ Document360 */

interface D360Category {
  id: string;
  name: string;
  description?: string | null;
  order?: number;
  articles?: { id: string; title: string; order?: number }[];
  child_categories?: D360Category[];
}

/** Document360. DOCUMENT360_API_TOKEN is a project API token; the main version is read. */
async function document360(options: Resolved): Promise<ImportPlan> {
  const token = need(options.env, 'DOCUMENT360_API_TOKEN', 'Document360');
  const headers = { api_token: token };
  const base = 'https://apihub.document360.io/v2';
  const lang = options.locale ?? 'en';

  const versions: { data: { id: string; is_main_version?: boolean }[] } = await getJson(
    options.fetch,
    `${base}/ProjectVersions`,
    headers,
  );
  const version = versions.data.find((v) => v.is_main_version) ?? versions.data[0];
  if (!version)
    return { source: 'document360', articles: [], warnings: ['The project has no versions.'] };

  const tree: { data: D360Category[] } = await getJson(
    options.fetch,
    `${base}/ProjectVersions/${version.id}/categories?includeArticles=true`,
    headers,
  );
  const articles: ImportedArticle[] = [];
  const warnings: string[] = [];
  const visit = async (category: D360Category, top: ImportedCollection) => {
    for (const ref of category.articles ?? []) {
      try {
        const { data } = await getJson<{
          data: {
            title: string;
            content?: string | null;
            html_content?: string | null;
            description?: string | null;
            status?: number;
            url?: string | null;
          };
        }>(options.fetch, `${base}/Articles/${ref.id}/${lang}`, headers);
        articles.push({
          title: data.title ?? ref.title,
          description: data.description ?? null,
          body: data.content?.trim()
            ? data.content
            : htmlToMarkdown(data.html_content ?? '', { baseUrl: data.url ?? undefined }),
          collection: top,
          order: ref.order ?? null,
          status: data.status === 0 ? 'draft' : 'published',
          sourceUrl: data.url ?? null,
        });
      } catch (error) {
        warnings.push(`${ref.title}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    options.onProgress?.(`${articles.length} articles`);
    for (const child of category.child_categories ?? []) await visit(child, top);
  };
  for (const category of tree.data) {
    await visit(category, {
      title: category.name,
      description: category.description ?? null,
      order: category.order ?? null,
    });
  }
  return { source: 'document360', articles, warnings };
}

/* ------------------------------------------------------------------ Crisp */

/**
 * Crisp Helpdesk. --website-id, and CRISP_IDENTIFIER / CRISP_KEY from a Crisp
 * plugin token. Crisp stores articles as Markdown already.
 */
async function crisp(options: Resolved): Promise<ImportPlan> {
  const identifier = need(options.env, 'CRISP_IDENTIFIER', 'Crisp');
  const key = need(options.env, 'CRISP_KEY', 'Crisp');
  if (!options.websiteId) throw new HelpWellError('bad_request', 'Crisp needs --website-id.');
  const headers = { authorization: basic(identifier, key), 'x-crisp-tier': 'plugin' };
  const base = `https://api.crisp.chat/v1/website/${options.websiteId}/helpdesk/locale/${options.locale ?? 'en'}`;

  const articles: ImportedArticle[] = [];
  for (let page = 1; ; page++) {
    const list: { data: { article_id: string }[] } = await getJson(
      options.fetch,
      `${base}/articles/${page}`,
      headers,
    );
    if (!list.data?.length) break;
    for (const ref of list.data) {
      const { data } = await getJson<{
        data: {
          title: string;
          description?: string | null;
          content?: string | null;
          category?: { name?: string } | null;
          url?: string | null;
          status?: string;
        };
      }>(options.fetch, `${base}/article/${ref.article_id}`, headers);
      articles.push({
        title: data.title,
        description: data.description ?? null,
        body: data.content ?? '',
        collection: { title: data.category?.name || 'General' },
        status: data.status === 'draft' ? 'draft' : 'published',
        sourceUrl: data.url ?? null,
      });
    }
    options.onProgress?.(`${articles.length} articles`);
  }
  return { source: 'crisp', articles, warnings: [] };
}
