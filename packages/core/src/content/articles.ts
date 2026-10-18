/**
 * Reading the knowledge base out of the repo.
 *
 * `helpwell/docs/<collection>/<article>.md` is canonical (KB-01). Nothing here
 * touches the database: the CLI calls `readKnowledgeBase()` and hands the result
 * to the indexer, which is what keeps "the files are the truth" honest.
 *
 * `readKnowledgeBaseFrom()` reads the same layout through a `ContentSource`,
 * for a host whose content is not on this server's disk. Both hand what they
 * found to one assembler, so a file means the same thing wherever it lives.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Frontmatter, parseFrontmatter } from './frontmatter.js';
import { type MediaPaths, rewriteMediaUrls } from './media.js';
import { titleCase } from './naming.js';
import type { ContentSource } from './source.js';

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

export interface Article {
  slug: string;
  collection: string;
  title: string;
  description: string | null;
  body: string;
  headings: Heading[];
  status: 'draft' | 'published' | 'archived';
  appliesTo: string | null;
  order: number;
  readingMinutes: number;
  /** Path relative to the docs root, for "edit in repo" links. */
  path: string;
  updatedAt: Date;
  contentHash: string;
  /**
   * The file exactly as written, front matter included. `body` has had its
   * image paths rewritten to served URLs; this has not, so it is what an
   * editor loads and what the article's history records.
   */
  source?: string;
}

export interface Collection {
  /** folder name, and the first segment of every article slug in it */
  id: string;
  title: string;
  description: string | null;
  /** Lucide or FontAwesome icon name (KB-23) */
  icon: string;
  /** lavender | peach | butter | mint (KB-23) */
  tint: string;
  /** null when _meta.json does not say; those sort last, alphabetically */
  order: number | null;
  askAgent: boolean;
  visibility: 'public' | 'identified';
  articles: Article[];
}

export interface KnowledgeBase {
  collections: Collection[];
  articles: Article[];
}

/** The tint rotation, so a new collection never looks randomly coloured. */
export const TINTS = ['lavender', 'peach', 'butter', 'mint'] as const;
export type Tint = (typeof TINTS)[number];

const WORDS_PER_MINUTE = 220;

export function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Headings become the table of contents and the anchors an answer can cite. */
export function extractHeadings(markdown: string): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  let inFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (!m) continue;
    const text = m[2]!.trim().replace(/\s*#+\s*$/, '');
    let id = slugify(text);
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}-${count}`;
    out.push({ depth: m[1]!.length, text, id });
  }
  return out;
}

/** Stable content hash, so re-indexing skips files that have not changed. */
export function hashContent(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (((h2 >>> 0) * 4294967296 + (h1 >>> 0)) >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function asString(value: unknown, fallback: string | null = null): string | null {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export interface ParseArticleOptions {
  collection: string;
  file: string;
  updatedAt?: Date;
  /**
   * How relative image paths become served URLs. Defaults to the layout
   * `helpwell init` writes; `false` leaves the body exactly as written, which
   * is what anything that writes the file back (`docs update`) needs.
   */
  media?: MediaPaths | false;
}

export function parseArticle(source: string, options: ParseArticleOptions): Article {
  const { data, content } = parseFrontmatter(source);
  const fileSlug = basename(options.file).replace(/\.mdx?$/, '');
  const slug = asString(data.slug) ?? `${options.collection}/${fileSlug}`;
  const title = asString(data.title) ?? titleFromBody(content) ?? fileSlug;
  const status = (asString(data.status, 'published') ?? 'published') as Article['status'];
  const path = `${options.collection}/${basename(options.file)}`;
  const body = options.media === false ? content : rewriteMediaUrls(content, path, options.media);

  return {
    slug,
    collection: options.collection,
    title,
    description: asString(data.description),
    body,
    headings: extractHeadings(content),
    status: ['draft', 'published', 'archived'].includes(status) ? status : 'published',
    appliesTo: asString(data.appliesTo) ?? asString(data['applies-to']),
    order: typeof data.order === 'number' ? data.order : 0,
    readingMinutes: readingMinutes(content),
    path,
    updatedAt: options.updatedAt ?? new Date(),
    // The served URLs are part of what the index holds, so they are part of
    // the hash: the first sync after an upgrade re-indexes exactly the
    // articles with images in them. An article with none hashes as it
    // always did, so nothing else is re-embedded.
    contentHash: hashContent(body === content ? source : `${source}\n${body}`),
    source,
  };
}

function titleFromBody(body: string): string | null {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1]!.trim() : null;
}

interface CollectionMeta extends Omit<Collection, 'articles' | 'tint'> {
  /** null when the folder did not pick one, so the rotation can fill it in */
  tint: string | null;
}

function parseCollectionMeta(text: string | null, id: string): CollectionMeta {
  let meta: Frontmatter = {};
  try {
    if (text !== null) meta = JSON.parse(text) as Frontmatter;
  } catch {
    // A collection without _meta.json still works; it just takes the defaults.
  }
  const tint = asString(meta.tint);
  const visibility = asString(meta.visibility, 'public') as Collection['visibility'];
  return {
    id,
    title: asString(meta.title) ?? titleCase(id),
    description: asString(meta.description),
    icon: asString(meta.icon) ?? 'book-open',
    tint: tint && (TINTS as readonly string[]).includes(tint) ? tint : null,
    order: typeof meta.order === 'number' ? meta.order : null,
    askAgent: meta.askAgent !== false,
    visibility: visibility === 'identified' ? 'identified' : 'public',
  };
}

/**
 * Fill in the tints nobody chose.
 *
 * Walks the collections in the order they will be displayed and hands out the
 * rotation, skipping any tint a collection claimed explicitly so two cards next
 * to each other never come out the same colour.
 */
function assignTints<T extends { tint: string | null }>(
  collections: T[],
): (T & { tint: string })[] {
  const claimed = new Set(collections.map((c) => c.tint).filter(Boolean) as string[]);
  const free = TINTS.filter((t) => !claimed.has(t));
  let cursor = 0;
  return collections.map((c) => {
    if (c.tint) return { ...c, tint: c.tint };
    const pool = free.length > 0 ? free : TINTS;
    const tint = pool[cursor % pool.length]!;
    cursor++;
    return { ...c, tint };
  });
}

export interface ReadKnowledgeBaseOptions {
  /** How relative image paths become served URLs; `false` leaves them as written. */
  media?: MediaPaths | false;
}

/** One collection folder as found: its name, its `_meta.json`, and its Markdown files. */
interface FoundCollection {
  id: string;
  meta: string | null;
  files: { file: string; source: string; updatedAt: Date }[];
}

/**
 * Whether a top-level folder can be a collection: hidden and underscored ones
 * are not. It is one when it also holds a `_meta.json` or an article (see
 * `assemble`), so a `_meta.json` alone makes a collection with no articles
 * yet, and a folder of images, or an empty one, is not a collection at all.
 */
function isCollectionFolder(name: string): boolean {
  return !name.startsWith('.') && !name.startsWith('_');
}

const ARTICLE_FILE = /\.mdx?$/;

/** Read every collection and article under a docs root. */
export function readKnowledgeBase(
  docsRoot: string,
  options: ReadKnowledgeBaseOptions = {},
): KnowledgeBase {
  let entries: string[];
  try {
    entries = readdirSync(docsRoot);
  } catch {
    return { collections: [], articles: [] };
  }

  const found = entries
    .filter(isCollectionFolder)
    .filter((name) => statSync(join(docsRoot, name)).isDirectory())
    .sort()
    .map((id): FoundCollection => {
      const dir = join(docsRoot, id);
      let meta: string | null = null;
      try {
        meta = readFileSync(join(dir, '_meta.json'), 'utf8');
      } catch {
        // No _meta.json: the collection takes the defaults.
      }
      const files = readdirSync(dir)
        .filter((f) => ARTICLE_FILE.test(f))
        .sort()
        .map((file) => {
          const full = join(dir, file);
          return { file, source: readFileSync(full, 'utf8'), updatedAt: statSync(full).mtime };
        });
      return { id, meta, files };
    });

  return assemble(found, options.media);
}

/** How many files are read from a source at once. */
const READ_CONCURRENCY = 16;

/**
 * Read every collection and article in a content source: the same layout,
 * the same rules and the same result as `readKnowledgeBase`. A folder exists
 * here only when a file does, as in any object store, which is why neither
 * reader counts an empty folder as a collection: the repo on disk and the
 * same files in a source must mean the same thing.
 *
 * Image paths are rewritten against the source's own screenshots location
 * unless `media.screenshots` says otherwise.
 */
export async function readKnowledgeBaseFrom(
  source: ContentSource,
  options: ReadKnowledgeBaseOptions = {},
): Promise<KnowledgeBase> {
  const groups = new Map<string, { meta: string | null; files: { path: string; at: Date }[] }>();
  for (const entry of await source.list()) {
    const parts = entry.path.split('/');
    const id = parts[0] ?? '';
    if (parts.length < 2 || !isCollectionFolder(id)) continue;
    const group = groups.get(id) ?? { meta: null, files: [] };
    groups.set(id, group);
    if (parts.length !== 2) continue;
    const file = parts[1] ?? '';
    if (file === '_meta.json') group.meta = entry.path;
    else if (ARTICLE_FILE.test(file)) group.files.push({ path: entry.path, at: entry.modifiedAt });
  }

  const found: FoundCollection[] = [];
  for (const id of [...groups.keys()].sort()) {
    const group = groups.get(id);
    if (!group) continue;
    const meta = group.meta ? await source.readText(group.meta) : null;
    const sorted = [...group.files].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    const files = await mapLimit(sorted, READ_CONCURRENCY, async ({ path, at }) => {
      const text = await source.readText(path);
      return text === null ? null : { file: basename(path), source: text, updatedAt: at };
    });
    found.push({
      id,
      meta,
      files: files.filter((file): file is FoundCollection['files'][number] => file !== null),
    });
  }

  const media =
    options.media === false
      ? false
      : { ...options.media, screenshots: options.media?.screenshots ?? source.screenshots };
  return assemble(found, media);
}

/**
 * What both readers share: decide which folders are collections, then parse,
 * order, and colour them.
 *
 * A collection is a folder with a `_meta.json` or at least one article in
 * it. The `_meta.json` alone is enough, so a collection someone has set up
 * but not written for yet is kept (and indexed) rather than pruned. A folder
 * with neither, such as `docs/images`, is not one: it would otherwise become
 * an empty "Images" collection. Nor is an empty folder, which git does not
 * keep and an object store cannot hold, so it could not mean the same thing
 * everywhere.
 */
function assemble(found: FoundCollection[], media: MediaPaths | false | undefined): KnowledgeBase {
  const kept = found.filter((folder) => folder.meta !== null || folder.files.length > 0);
  const parsed = kept.map(({ id, meta, files }) => {
    const articles = files
      .map((file) =>
        parseArticle(file.source, {
          collection: id,
          file: file.file,
          updatedAt: file.updatedAt,
          media,
        }),
      )
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    return { ...parseCollectionMeta(meta, id), articles };
  });

  // Collections that set an order come first, in that order; the rest follow
  // alphabetically. Adding a folder therefore cannot renumber its neighbours.
  parsed.sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    return ao - bo || a.title.localeCompare(b.title);
  });

  const collections = assignTints(parsed);
  return { collections, articles: collections.flatMap((c) => c.articles) };
}

/** `fn` over `items`, at most `limit` at a time, results in order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
