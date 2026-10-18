/**
 * JSON out of a model's reply.
 *
 * Models wrap JSON in prose and fences however they feel that day, so the
 * outermost braces are taken rather than trusting the whole reply to parse.
 * Returns null, never throws: a reply that is not usable is the caller's to
 * explain.
 */
export function parseModelJson(text: string): unknown {
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
