/**
 * What an answer says about its own sources, read back out of the text.
 *
 * Citations used to be the top three search results, attached before the
 * model had said a word, so every answer "cited" something and the widget's
 * chips reported what search found rather than what the answer used. Now the
 * passages in the prompt are numbered and the model puts the number of each
 * one it used in square brackets, [1] or [2][3], after the sentence it
 * supports. Those markers are the citations. They are taken out of the text
 * before a customer sees it, because the widget shows the articles as chips.
 *
 * The model also ends its reply with one line the customer never sees:
 *
 *   <certainty>answered: the export steps are in passage 1</certainty>
 *
 * `answered`, `partial` or `not_covered`, then a short reason. A line in the
 * reply rather than a tool call, because a tool call costs a second round trip
 * on every answer and a line costs a dozen tokens. A model that forgets it is
 * scored as not having said (see agent/confidence.ts), and a model that
 * forgets the markers gets one fallback: when the answer plainly follows a
 * passage's wording, that passage is cited as inferred rather than confirmed.
 */

export type Certainty = 'answered' | 'partial' | 'not_covered';

export const CERTAINTIES: readonly Certainty[] = ['answered', 'partial', 'not_covered'];

export interface CertaintyReport {
  level: Certainty;
  /** The model's own reason, one line, or null when it gave none. */
  reason: string | null;
}

/** A passage the model can cite by number: one the prompt listed, or one a tool returned. */
export interface CitablePassage {
  ref: number;
  slug: string;
  title: string;
  collection: string;
  /** What the model was given of the article, for comparing the answer with (passages.ts). */
  text: string;
}

export interface ParsedAnswer {
  /** The reply as the customer should see it: markers and the certainty line gone. */
  text: string;
  /** Passage numbers the answer cited, first use first, only ones that exist. */
  cited: number[];
  certainty: CertaintyReport | null;
}

const MAX_REASON = 200;

/**
 * `[1]`, `[2, 3]` or `[4; 5]`, with the spaces around it, and not a Markdown
 * link (`[1](url)`) or link definition (`[1]: url`) whose text is a number.
 * `lead` is set when the marker opens a line.
 */
const MARKER = /(^|\n)?([ \t]*)\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\](?![(:])([ \t]*)/g;

/** Fenced blocks and inline code: `items[1]` there is code, not a citation. */
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

/** Read the markers and the certainty line out of a reply. */
export function parseAnswer(raw: string, validRefs: ReadonlySet<number>): ParsedAnswer {
  const { text: withoutCertainty, certainty } = extractCertainty(raw);

  const cited: number[] = [];
  const stripMarkers = (prose: string) =>
    prose.replace(
      MARKER,
      (match, lead: string | undefined, _before: string, inner: string, after: string) => {
        const refs = inner.split(/[,;]/).map((part) => Number(part.trim()));
        // A number that is no passage is left alone: it is more likely to be
        // content ("press [1] on the keypad") than a citation.
        if (!refs.every((ref) => validRefs.has(ref))) return match;
        for (const ref of refs) if (!cited.includes(ref)) cited.push(ref);
        // Mid-sentence the space before the marker goes and the one after
        // stays, so "Billing [1]." reads "Billing." and "see [1] and" reads
        // "see and". A marker opening a line takes its spaces with it.
        return lead === undefined ? after : lead;
      },
    );

  let stripped = '';
  let from = 0;
  for (const code of withoutCertainty.matchAll(CODE)) {
    stripped += stripMarkers(withoutCertainty.slice(from, code.index)) + code[0];
    from = code.index + code[0].length;
  }
  stripped += stripMarkers(withoutCertainty.slice(from));

  return { text: stripped.trim(), cited, certainty };
}

/**
 * The certainty line, and the text without it. Lenient on purpose: models
 * wrap it in bold, put the level in an attribute, or forget the closing tag.
 */
export function extractCertainty(raw: string): {
  text: string;
  certainty: CertaintyReport | null;
} {
  let certainty: CertaintyReport | null = null;

  // Any bold or italic wrapped around the tag goes with it.
  const tag = /[ \t]*[*_]*[ \t]*<certainty\b([^>]*)>([\s\S]*?)(?:<\/certainty>|$)[ \t]*[*_]*/i;
  const match = tag.exec(raw);
  if (match) {
    const attribute = /level\s*=\s*["']?([a-z_ -]+)/i.exec(match[1] ?? '')?.[1];
    certainty = readCertainty(attribute ? `${attribute} ${match[2] ?? ''}` : (match[2] ?? ''));
    const text = raw.slice(0, match.index) + raw.slice(match.index + match[0].length);
    return { text: text.trimEnd(), certainty };
  }

  // No tag, but a last line that reads "Certainty: partial - ..." is the same
  // report in the wrong clothes, and must not reach the customer either.
  const lines = raw.trimEnd().split('\n');
  const last = lines[lines.length - 1] ?? '';
  const line = /^\s*[*_]*\s*certainty\s*[*_]*\s*[:\-–—]\s*(.+)$/i.exec(last);
  if (line) {
    certainty = readCertainty(line[1] ?? '');
    if (certainty) return { text: lines.slice(0, -1).join('\n').trimEnd(), certainty };
  }

  return { text: raw, certainty: null };
}

function readCertainty(body: string): CertaintyReport | null {
  const match =
    /^[\s*_"']*(answered|partial|not[\s_-]*covered)\b[\s*_"']*[:\-–—,.]?\s*([\s\S]*)$/i.exec(
      body.trim(),
    );
  if (!match) return null;
  const word = (match[1] ?? '').toLowerCase().replace(/[\s_-]+/g, '_');
  const level: Certainty =
    word === 'answered' ? 'answered' : word === 'partial' ? 'partial' : 'not_covered';
  const reason = (match[2] ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[*_]+$/, '')
    .trim();
  return { level, reason: reason ? reason.slice(0, MAX_REASON) : null };
}

/* ------------------------------------------------------------- inference */

/**
 * The passage an answer plainly follows, when the model forgot to cite it.
 *
 * Counts the content words the answer shares with each passage (title and
 * text), after dropping common words and the commonest English endings. The
 * bar is deliberately high: at least three shared words, and at least 30% of
 * the smaller of the two, so a greeting or a refusal never picks up a source.
 */
export function inferCitation(
  answer: string,
  passages: readonly CitablePassage[],
): CitablePassage | null {
  const said = contentWords(answer);
  if (said.size === 0) return null;

  let best: { passage: CitablePassage; shared: number } | null = null;
  for (const passage of passages) {
    const words = contentWords(`${passage.title} ${passage.text}`);
    let shared = 0;
    for (const word of said) if (words.has(word)) shared++;
    const enough = shared >= 3 && shared / Math.min(said.size, words.size) >= 0.3;
    if (enough && (!best || shared > best.shared)) best = { passage, shared };
  }
  return best?.passage ?? null;
}

const COMMON = new Set([
  'the',
  'and',
  'are',
  'you',
  'your',
  'yours',
  'can',
  'could',
  'would',
  'should',
  'will',
  'does',
  'did',
  'have',
  'has',
  'had',
  'how',
  'what',
  'when',
  'where',
  'why',
  'who',
  'which',
  'this',
  'that',
  'these',
  'those',
  'there',
  'their',
  'they',
  'them',
  'then',
  'than',
  'from',
  'into',
  'onto',
  'with',
  'without',
  'for',
  'not',
  'but',
  'all',
  'any',
  'some',
  'just',
  'also',
  'only',
  'here',
  'about',
  'our',
  'out',
  'get',
  'got',
  'was',
  'were',
  'been',
  'being',
  'its',
  'it’s',
  "it's",
  'too',
  'very',
  'more',
  'most',
  'one',
  'use',
  'using',
  'able',
  'sure',
  'yes',
  'please',
  'thanks',
  'thank',
]);

function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || COMMON.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** The commonest English endings, so "exporting" and "exports" meet "export". */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
