/**
 * Argument parsing.
 *
 * Forty lines instead of a dependency. A CLI that installs into somebody's
 * repo should add as little to their lockfile as it can get away with, and
 * this handles everything HelpWell's commands need: `--flag`, `--key value`,
 * `--key=value`, `-k`, `--no-thing`, and `--` to stop parsing.
 */

export interface ParsedArgs {
  /** Everything before the first flag, e.g. ["docs", "generate"]. */
  positionals: string[];
  flags: Record<string, string | boolean>;
  /** Everything after a bare `--`, passed through untouched. */
  rest: string[];
}

/**
 * Flags that are switches. They never take the token after them as a value,
 * so `helpwell ask --offline "how do I export?"` keeps its question. Anything
 * not listed here takes a value when one follows (`--count 3`), and
 * `--key=value` always works, switches included (`--force=false`).
 */
const SWITCHES = new Set([
  'force',
  'dryRun',
  'offline',
  'help',
  'version',
  'verbose',
  'anonymise',
  'anonymize',
  'publish',
  'settings',
  'embeddings',
  'ci',
  'json',
  'now',
  'draft',
  'images',
  'prompt',
  'copy',
]);

const SHORT_SWITCHES = new Set(['h', 'v']);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];

  let i = 0;
  for (; i < argv.length; i++) {
    const token = argv[i] ?? '';

    if (token === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const equals = body.indexOf('=');

      if (equals !== -1) {
        flags[camel(body.slice(0, equals))] = body.slice(equals + 1);
        continue;
      }

      // `--no-embeddings` reads better than `--embeddings=false`.
      if (body.startsWith('no-')) {
        flags[camel(body.slice(3))] = false;
        continue;
      }

      const name = camel(body);
      const next = argv[i + 1];
      if (!SWITCHES.has(name) && next !== undefined && !next.startsWith('-')) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const letters = token.slice(1);
      const next = argv[i + 1];
      // A single short flag can take a value; a cluster like -abc cannot.
      if (
        letters.length === 1 &&
        !SHORT_SWITCHES.has(letters) &&
        next !== undefined &&
        !next.startsWith('-')
      ) {
        flags[letters] = next;
        i++;
      } else {
        for (const letter of letters) flags[letter] = true;
      }
      continue;
    }

    positionals.push(token);
  }

  return { positionals, flags, rest };
}

function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function str(flags: ParsedArgs['flags'], ...names: string[]): string | undefined {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

export function bool(flags: ParsedArgs['flags'], ...names: string[]): boolean | undefined {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return undefined;
}

export function num(flags: ParsedArgs['flags'], ...names: string[]): number | undefined {
  const value = str(flags, ...names);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
