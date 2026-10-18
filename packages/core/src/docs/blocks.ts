/**
 * What a docs-writing model is told about the help center's blocks and the
 * screenshots it may use, and the check that takes out any image it was not
 * given. Shared by `helpwell docs` and by hosts that draft articles on their
 * own schedule.
 */

import { posix as pathPosix } from 'node:path';

/**
 * The Markdown blocks the help centre renders (KB-05), as the model is told
 * about them. The syntax is the renderer's in `@helpwell/ui`; the examples
 * here have to stay in step with it.
 */
export const BLOCK_VOCABULARY = [
  'Blocks the help center renders. Use one where it genuinely helps a reader, never for decoration:',
  '- A callout, in GitHub alert syntax: a blockquote whose first line is [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION]. For example "> [!WARNING]" on one line, then "> Deleting a workspace cannot be undone." on the next. Keep them rare: one or two in an article.',
  '- Numbered steps: a line ":::steps", then a "### " heading naming each step with its instructions under it, then a line ":::".',
  '- Tabs, for the same task on different platforms or plans: a line ":::tabs", then "== Label" on its own line before each tab\'s content, then a line ":::".',
  '- A collapsible section, for detail most readers can skip: a line ":::details The question or title", the content, then a line ":::".',
  '- A video: a line on its own like "![What it shows](URL)" where URL is a YouTube, Vimeo, Loom or Wistia link, or an .mp4 file. Only a video URL that appears in the material.',
  '- Tables, fenced code blocks, and **bold** for a button or menu label exactly as it appears on screen.',
];

/** A screenshot an article may reference. */
export interface ShotReference {
  /** The path an article in a collection folder uses: `../_screenshots/billing.png`. */
  ref: string;
  /** Where on the app it is taken. */
  path: string;
}

export function screenshotGuidance(shots: ShotReference[]): string[] {
  if (shots.length === 0) {
    return ['There are no screenshots to use. Do not add any image.'];
  }
  return [
    'Screenshots you may use, and no others. Put one on a line of its own as ![What it shows](path), with the path exactly as listed, where it shows the reader what a step describes:',
    ...shots.map((shot) => `- ${shot.ref}: the page at ${shot.path}`),
    'Never invent an image path, and never add an image or a screenshot that is not listed here.',
  ];
}

const IMAGE = /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

/**
 * Take out every image a model added that it was not allowed to: anything
 * not in `allowed`. An image alone on its line takes the line with it, so no
 * blank gap is left where it was. Code is left alone.
 */
export function keepKnownImages(
  body: string,
  allowed: Set<string>,
): { body: string; removed: string[] } {
  const removed: string[] = [];
  const known = (url: string) => allowed.has(pathPosix.normalize(url.split(/[?#]/)[0] ?? ''));
  let fenced = false;
  const lines: string[] = [];
  for (const line of body.split('\n')) {
    if (/^ {0,3}```/.test(line)) {
      fenced = !fenced;
      lines.push(line);
      continue;
    }
    if (fenced) {
      lines.push(line);
      continue;
    }
    const kept = line
      .split(/(`[^`]*`)/)
      .map((part) =>
        part.startsWith('`')
          ? part
          : part.replace(IMAGE, (whole, _alt: string, url: string) => {
              if (known(url)) return whole;
              removed.push(url);
              return '';
            }),
      )
      .join('');
    // A line that only held a removed image goes too.
    if (kept.trim() === '' && line.trim() !== '') continue;
    lines.push(kept);
  }
  return { body: lines.join('\n'), removed };
}

/** The images an article already has, so a rewrite may keep them. */
export function imagesIn(body: string): string[] {
  return [...body.matchAll(IMAGE)].map((match) =>
    pathPosix.normalize((match[2] ?? '').split(/[?#]/)[0] ?? ''),
  );
}
