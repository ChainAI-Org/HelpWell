/**
 * A diff a person can read.
 *
 * Help articles are prose, and a prose line is a whole paragraph, so a line
 * diff alone marks the paragraph as replaced when one word changed. This one
 * diffs lines first, then pairs each removed line with the added line that
 * replaced it and diffs those two word by word, so the page can show exactly
 * which words moved (KB-16, KB-22).
 *
 * Longest common subsequence, after trimming what the two versions share at
 * either end. Articles are hundreds of lines; a pair too large to compare
 * cheaply is shown as a replacement rather than stalling the request.
 */

export type DiffOp = 'same' | 'add' | 'remove';

export interface DiffPart {
  op: DiffOp;
  text: string;
}

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** For a changed line, the words that changed within it. */
  parts?: DiffPart[];
}

/** Beyond this many cells the table would cost more than the diff is worth. */
const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');
  const lines: DiffLine[] = sequence(a, b).map(({ op, text }) => ({ op, text }));
  return withWordParts(lines);
}

/** Collapse long unchanged stretches, keeping `context` lines around each change. */
export type DiffChunk = { kind: 'lines'; lines: DiffLine[] } | { kind: 'skip'; count: number };

export function collapseDiff(lines: DiffLine[], context = 3): DiffChunk[] {
  const keep = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.op === 'same') return;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(lines.length - 1, index + context);
      k++
    ) {
      keep[k] = true;
    }
  });

  const chunks: DiffChunk[] = [];
  let run: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) chunks.push({ kind: 'skip', count: skipped });
      skipped = 0;
      run.push(line);
    } else {
      if (run.length > 0) chunks.push({ kind: 'lines', lines: run });
      run = [];
      skipped++;
    }
  });
  if (run.length > 0) chunks.push({ kind: 'lines', lines: run });
  if (skipped > 0) chunks.push({ kind: 'skip', count: skipped });
  return chunks;
}

/** How many lines each side changed. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.op === 'add') added++;
    else if (line.op === 'remove') removed++;
  }
  return { added, removed };
}

/* ------------------------------------------------------------- internals */

function sequence(a: string[], b: string[]): DiffPart[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const same = (items: string[]) => items.map((text): DiffPart => ({ op: 'same', text }));
  const middle = lcs(a.slice(head, a.length - tail), b.slice(head, b.length - tail));
  return [...same(a.slice(0, head)), ...middle, ...same(a.slice(a.length - tail))];
}

function lcs(a: string[], b: string[]): DiffPart[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ op: 'add', text }));
  if (m === 0) return a.map((text) => ({ op: 'remove', text }));
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    return [
      ...a.map((text): DiffPart => ({ op: 'remove', text })),
      ...b.map((text): DiffPart => ({ op: 'add', text })),
    ];
  }

  // table[i][j]: the LCS length of a[i..] and b[j..], flattened.
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }

  const out: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] ?? '' });
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      out.push({ op: 'remove', text: a[i] ?? '' });
      i++;
    } else {
      out.push({ op: 'add', text: b[j] ?? '' });
      j++;
    }
  }
  while (i < n) out.push({ op: 'remove', text: a[i++] ?? '' });
  while (j < m) out.push({ op: 'add', text: b[j++] ?? '' });
  return out;
}

/**
 * A run of removed lines followed by a run of added ones is an edit. Pair
 * them in order and mark the words that differ, so "14 days" becoming
 * "30 days" reads as one word changed, not a paragraph replaced.
 */
function withWordParts(lines: DiffLine[]): DiffLine[] {
  let index = 0;
  while (index < lines.length) {
    if (lines[index]?.op !== 'remove') {
      index++;
      continue;
    }
    const removedStart = index;
    while (lines[index]?.op === 'remove') index++;
    const addedStart = index;
    while (lines[index]?.op === 'add') index++;

    const pairs = Math.min(addedStart - removedStart, index - addedStart);
    for (let k = 0; k < pairs; k++) {
      const removed = lines[removedStart + k];
      const added = lines[addedStart + k];
      if (!removed || !added) continue;
      const words = sequence(tokens(removed.text), tokens(added.text));
      // Words that are mostly different are not an edit of one line into the
      // other; highlighting them would be noise.
      const kept = words.filter((part) => part.op === 'same' && part.text.trim()).length;
      const total = words.filter((part) => part.text.trim()).length;
      if (total === 0 || kept / total < 0.3) continue;
      removed.parts = merge(words.filter((part) => part.op !== 'add'));
      added.parts = merge(words.filter((part) => part.op !== 'remove'));
    }
  }
  return lines;
}

/** Words and the whitespace between them, so joining the parts gives the line back. */
function tokens(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token !== '');
}

function merge(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (last && last.op === part.op) last.text += part.text;
    else out.push({ ...part });
  }
  return out;
}
