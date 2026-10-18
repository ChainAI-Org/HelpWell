/**
 * Terminal output.
 *
 * A CLI that installs into somebody's repo has to be legible in a plain
 * terminal, in CI with no colour, and through a pipe. Everything here degrades
 * to readable text when colour is off, and nothing depends on cursor control.
 */

// Built from a char code so the source file stays plain ASCII: a literal
// escape byte in a .ts file is invisible in review and easy to mangle.
const ESC = `${String.fromCharCode(27)}[`;

const useColour =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  Boolean(process.stdout.isTTY);

const code = (open: number, close: number) => (text: string) =>
  useColour ? `${ESC}${open}m${text}${ESC}${close}m` : text;

export const style = {
  bold: code(1, 22),
  dim: code(2, 22),
  violet: code(35, 39),
  green: code(32, 39),
  yellow: code(33, 39),
  red: code(31, 39),
};

export function say(message = ''): void {
  process.stdout.write(`${message}\n`);
}

export function heading(text: string): void {
  say();
  say(style.bold(text));
}

export function step(text: string): void {
  say(`${style.violet('›')} ${text}`);
}

export function ok(text: string): void {
  say(`${style.green('✓')} ${text}`);
}

export function warn(text: string): void {
  say(`${style.yellow('!')} ${text}`);
}

export function fail(text: string): void {
  process.stderr.write(`${style.red('✗')} ${text}\n`);
}

export function detail(text: string): void {
  say(`  ${style.dim(text)}`);
}

/* ----------------------------------------------------------------- verbose */

let verbose = false;
/** A progress line is drawn and not yet ended with a newline. */
let lineOpen = false;

/** `--verbose`. The dispatcher sets it at the start of every command. */
export function setVerbose(on: boolean): void {
  verbose = on;
}

export function isVerbose(): boolean {
  return verbose;
}

/**
 * A line only `--verbose` prints: the working behind a summary line. It goes
 * to stderr, so `helpwell ask … > answer.txt` still captures only the answer.
 */
export function trace(text: string): void {
  if (!verbose) return;
  // Clear a half-drawn progress line first; its next update redraws it.
  if (lineOpen) {
    process.stdout.write(`\r${ESC}K`);
    lineOpen = false;
  }
  process.stderr.write(`  ${style.dim(`· ${text}`)}\n`);
}

/** A key/value block, aligned. Used by `doctor` and every summary. */
export function table(rows: [string, string][]): void {
  const width = rows.reduce((max, [key]) => Math.max(max, key.length), 0);
  for (const [key, value] of rows) {
    say(`  ${style.dim(key.padEnd(width))}  ${value}`);
  }
}

export function list(items: string[]): void {
  for (const item of items) say(`  ${style.dim('·')} ${item}`);
}

/**
 * A progress line that rewrites itself on a TTY and prints one line per update
 * everywhere else, so CI logs stay readable rather than filling with escapes.
 */
export function progress(label: string): { update(text: string): void; done(text: string): void } {
  let started = false;
  return {
    update(text: string) {
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${style.violet('›')} ${label} ${style.dim(text)}${ESC}K`);
        started = true;
        lineOpen = true;
      } else {
        say(`  ${label} ${text}`);
      }
    },
    done(text: string) {
      if (started && process.stdout.isTTY) process.stdout.write(`\r${ESC}K`);
      lineOpen = false;
      ok(text);
    },
  };
}

/** The banner, drawn in text. No image, and no ASCII art of the logo. */
export function banner(version: string): void {
  say();
  say(`${style.violet(style.bold('HelpWell'))} ${style.dim(version)}`);
  say(style.dim('The Autonomous Help Desk: an AI agent that keeps its own docs current.'));
}
