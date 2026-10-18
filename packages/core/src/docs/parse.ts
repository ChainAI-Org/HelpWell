/**
 * Reading what a docs-writing model returns, and putting a rewritten body
 * back into an article without touching its front matter.
 */

export interface Draft {
  collection: string;
  title: string;
  description: string;
  body: string;
}

export function parseDrafts(text: string): Draft[] {
  const parsed = parseJsonBlock(text);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { articles?: unknown })?.articles)
      ? (parsed as { articles: unknown[] }).articles
      : [];

  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.title === 'string' && typeof item.body === 'string')
    .map((item) => ({
      collection: typeof item.collection === 'string' ? item.collection : 'Help',
      title: String(item.title),
      description: typeof item.description === 'string' ? item.description : '',
      body: String(item.body),
    }));
}

export function parseVerdict(
  text: string,
): { stale: boolean; reason: string; body: string | null } | null {
  const parsed = parseJsonBlock(text) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    stale: parsed.stale === true,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    body: typeof parsed.body === 'string' ? parsed.body : null,
  };
}

/**
 * Models wrap JSON in prose and fences however they feel that day, so take the
 * outermost braces rather than trusting the whole reply to parse.
 */
export function parseJsonBlock(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const arrayStart = candidate.indexOf('[');
  const from = start === -1 ? arrayStart : arrayStart === -1 ? start : Math.min(start, arrayStart);
  if (from === -1) return null;

  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  if (end <= from) return null;

  try {
    return JSON.parse(candidate.slice(from, end + 1));
  } catch {
    return null;
  }
}

/**
 * Swap the body of an article and keep its frontmatter block byte for byte.
 * A file that never had frontmatter gets just the body back.
 */
export function replaceBody(original: string, body: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(original);
  const trimmed = body.trim();
  if (!match) return `${trimmed}\n`;
  const block = match[0].endsWith('\n') ? match[0] : `${match[0]}\n`;
  return `${block}\n${trimmed}\n`;
}
