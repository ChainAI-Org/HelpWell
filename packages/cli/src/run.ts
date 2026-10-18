/**
 * The command table and the dispatcher.
 *
 * Kept apart from `bin.ts` so the whole CLI can be driven from a test without
 * spawning a process or touching `process.exit`. Every command reports its
 * outcome through its return value; the exit code is decided here and nowhere
 * else.
 */

import { isHelpWellError } from '@helpwell/core';
import { bool, num, parseArgs, str } from './args.js';
import { ask, dev } from './commands/ask.js';
import { capture } from './commands/capture.js';
import { type ChangelogSource, changelog } from './commands/changelog.js';
import { redactSettings, runExport, runMigrate, runPrune } from './commands/data.js';
import { docsGenerate, docsUpdate } from './commands/docs.js';
import { doctor } from './commands/doctor.js';
import { runEvals } from './commands/evals.js';
import { IMPORT_SOURCES, runImport } from './commands/import.js';
import { init } from './commands/init.js';
import { link, linkStatus, unlink } from './commands/link.js';
import { PROMPT_TOPICS, prompt } from './commands/prompt.js';
import { settingsPull, settingsPush } from './commands/settings.js';
import { sync } from './commands/sync.js';
import { webhooksList, webhooksRetry, webhooksTest } from './commands/webhooks.js';
import { runAsJson, writeJson } from './json.js';
import { NotInstalledError } from './project.js';
import { banner, detail, fail, heading, isVerbose, say, setVerbose, style, table } from './ui.js';

export const VERSION = '0.1.0';

/** What `--verbose` adds, in the words the help screens use. */
const VERBOSE_SHOWS =
  'files read, every model call with its tokens and cost, git commands, the stack on failure';

const FRAMEWORKS = ['next', 'remix', 'node', 'hono'] as const;
type Framework = (typeof FRAMEWORKS)[number];

function isFramework(value: string): value is Framework {
  return (FRAMEWORKS as readonly string[]).includes(value);
}

interface CommandSpec {
  name: string;
  summary: string;
  usage: string;
  /** Flags worth knowing about, as [flag, what it does]. */
  flags?: [string, string][];
}

const COMMANDS: CommandSpec[] = [
  {
    name: 'init',
    summary: 'Install HelpWell into this repo',
    usage:
      'helpwell init [--name "Acme"] [--docs docs] [--app-url https://app.acme.com] [--framework next]',
    flags: [
      ['--name', 'product name; defaults to the package or folder name'],
      [
        '--app-url',
        'the public address of the app; localhost is used for capture and dev otherwise',
      ],
      ['--framework', `${FRAMEWORKS.join(' | ')}, for the mount snippet`],
      ['--force', 'overwrite files that already exist'],
      ['--dry-run', 'say what would be written and change nothing'],
      [
        '--ci',
        'also write GitHub Actions workflows: `helpwell eval` on pull requests, `helpwell docs update` on pushes to main',
      ],
    ],
  },
  {
    name: 'doctor',
    summary: 'Check the install and say what is wrong',
    usage: 'helpwell doctor',
  },
  {
    name: 'migrate',
    summary: 'Create or update the database schema',
    usage: 'helpwell migrate [--url postgres://…]',
  },
  {
    name: 'sync',
    summary: 'Index the docs in your repo',
    usage: 'helpwell sync [--force] [--no-embeddings] [--settings | --no-settings]',
    flags: [
      ['--force', 're-embed everything, not just what changed'],
      ['--no-embeddings', 'index text only, even with a key set'],
      [
        '--settings',
        "push the file's settings even when the dashboard has newer ones (a fresh CI checkout always looks newer; pass --no-settings there if the dashboard owns settings)",
      ],
      ['--no-settings', 'index the docs and leave settings in the database alone'],
    ],
  },
  {
    name: 'dev',
    summary: 'Talk to your agent in the terminal',
    usage: 'helpwell dev [--offline]',
    flags: [
      [
        '--offline',
        'script each answer from the top search hit, cited; no model or key needed (the default with no OPENROUTER_API_KEY)',
      ],
    ],
  },
  {
    name: 'ask',
    summary: 'Ask one question and print the answer',
    usage: 'helpwell ask "how do I export invoices?" [--offline]',
    flags: [
      [
        '--offline',
        'script the answer from the top search hit, cited; no model or key needed (the default with no OPENROUTER_API_KEY)',
      ],
      ['--', 'everything after it is the question, dashes and all'],
    ],
  },
  {
    name: 'docs generate',
    summary: 'Draft help articles from your repo',
    usage: 'helpwell docs generate [--about "billing"] [--count 5] [--dry-run]',
    flags: [
      ['--about', 'narrow the drafts to one area; the repo is still read'],
      ['--count', 'how many to draft, at most 20'],
      ['--dry-run', 'print what it would write'],
    ],
  },
  {
    name: 'docs update',
    summary: 'Rewrite articles the latest changes made wrong',
    usage: 'helpwell docs update [--since v1.4.0] [--dry-run]',
    flags: [
      ['--since', 'the ref to diff against; defaults to the last tag, then the first commit'],
      ['--dry-run', 'say which articles would change and leave them alone'],
    ],
  },
  {
    name: 'changelog',
    summary: 'Draft a changelog entry from what you shipped',
    usage:
      'helpwell changelog [--source github_releases|tags|commits] [--repo acme/app] [--since v1.4.0] [--to HEAD] [--release v1.5.0] [--publish] [--dry-run] [--prompt]',
    flags: [
      [
        '--source',
        'where to draft from: github_releases (release notes), tags (commits since the previous tag) or commits (commits since the last published entry); defaults to changelog.source in Settings, and unset, github_releases when the repo is on GitHub and has a release, otherwise tags (manual drafts nothing)',
      ],
      [
        '--repo',
        'owner/name on GitHub, for github_releases; defaults to changelog.repo, then the origin remote',
      ],
      [
        '--since',
        'start of the range; defaults to the last published entry (commits) or the previous tag (tags), then the first commit',
      ],
      ['--to', 'end of the range; defaults to HEAD'],
      [
        '--release',
        'version to stamp on the entry; from git, defaults to the tag at --to; from GitHub, the release to read, defaults to the latest',
      ],
      ['--publish', 'publish straight away rather than saving a draft'],
      ['--dry-run', 'print the draft and save nothing'],
      ['--prompt', 'print the setup for a GITHUB_TOKEN as a prompt for an AI assistant'],
    ],
  },
  {
    name: 'capture',
    summary: 'Retake the screenshots your docs use',
    usage:
      'helpwell capture [--url http://localhost:3000] [--only widget] [--out docs/_screenshots]',
    flags: [
      ['--url', 'where the app is running; defaults to appUrl in the config'],
      ['--only', 'only shots whose name contains this'],
      ['--out', 'where to write; defaults to screenshots.dir in the config'],
    ],
  },
  {
    name: 'eval',
    summary: 'Replay real questions and score the answers',
    usage: 'helpwell eval [--ref <label>] [--threshold 80]',
    flags: [
      ['--ref', 'a label stored with the run, e.g. the commit SHA, so runs can be told apart'],
      ['--threshold', 'exit non-zero below this score, for CI'],
      ['--dry-run', 'score the cases and record nothing'],
    ],
  },
  {
    name: 'export',
    summary: 'Write everything HelpWell holds to a JSON file',
    usage: 'helpwell export [--out helpwell-export.json] [--anonymise]',
    flags: [
      ['--out', 'the file to write; stdout otherwise'],
      [
        '--anonymise',
        'null emails, names, avatars, ids from your app, IP hashes, locations, comments, page URLs and identify attributes; replace message bodies with their length; hash search queries, gap questions and roadmap titles; empty event props and webhook payloads. Webhook secrets are redacted either way.',
      ],
    ],
  },
  {
    name: 'prune',
    summary: 'Apply your retention rule and tidy up',
    usage: 'helpwell prune [--months 12]',
  },
  {
    name: 'import',
    summary: 'Bring docs or contacts over from another tool',
    usage: `helpwell import <${IMPORT_SOURCES.join(' | ')} | ./folder | contacts.csv> [target] [--dry-run]`,
    flags: [
      ['markdown | html | notion | gitbook', 'a folder: helpwell import notion ./export'],
      [
        'zendesk',
        '--subdomain acme [--locale en-us]; ZENDESK_API_TOKEN and --email for private articles',
      ],
      ['intercom', 'INTERCOM_TOKEN in the environment'],
      ['helpscout', 'HELPSCOUT_DOCS_API_KEY in the environment'],
      ['freshdesk', '--subdomain acme, and FRESHDESK_API_KEY in the environment'],
      ['document360', 'DOCUMENT360_API_TOKEN in the environment'],
      ['crisp', '--website-id <id>, and CRISP_IDENTIFIER and CRISP_KEY in the environment'],
      ['crawl', 'a public help site: helpwell import crawl https://help.acme.com [--max 200]'],
      ['contacts', 'a CSV or JSON file: id, email, name, signed_up, tags, then any attributes'],
      ['--dry-run', 'say what would happen and change nothing'],
      ['--force', 'replace article files that already exist'],
      ['--draft', 'write every article as a draft'],
      ['--no-images', 'leave remote images where they are instead of downloading them'],
      ['--prompt', 'print instructions for an AI assistant to prepare a contacts export'],
    ],
  },
  {
    name: 'webhooks',
    summary: 'See recent webhook deliveries',
    usage: 'helpwell webhooks [--status failed | retrying | delivered | pending]',
    flags: [
      ['--status', 'only deliveries in this state'],
      [
        'HELPWELL_WEBHOOK_GUARD=off',
        'development only: lets deliveries reach http:// and localhost, which the guard refuses',
      ],
    ],
  },
  {
    name: 'webhooks retry',
    summary: 'Retry failed webhook deliveries that are due',
    usage: 'helpwell webhooks retry [--now]',
    flags: [
      ['--now', 'retry every failure with attempts left, due or not'],
      ['(cron)', 'run it every few minutes to keep retries on schedule on a quiet install'],
    ],
  },
  {
    name: 'webhooks test',
    summary: 'Send a test delivery to your webhooks',
    usage: 'helpwell webhooks test [--to https://hooks.acme.com/helpwell]',
    flags: [
      ['--to', 'send to this address only'],
      [
        'HELPWELL_WEBHOOK_GUARD=off',
        'development only: lets a test reach http://localhost; never set it in production',
      ],
    ],
  },
  {
    name: 'prompt',
    summary: 'Print any setup step as a prompt for an AI assistant',
    usage: 'helpwell prompt [topic] [--copy] [--json]',
    flags: [
      ...PROMPT_TOPICS.map((topic) => [topic.name, topic.summary] as [string, string]),
      ['--copy', 'put it on the clipboard instead of printing it'],
      ['--json', 'print the spec and the prompt as JSON'],
      ...PROMPT_TOPICS.flatMap((topic) =>
        (topic.flags ?? []).map(
          ([flag, what]) => [flag, `${topic.name}: ${what}`] as [string, string],
        ),
      ),
    ],
  },
  {
    name: 'link',
    summary: 'Connect a remote support extension for human support',
    usage: 'helpwell link --url https://support.example.com/api --product <id> [--prompt]',
    flags: [
      ['--url', "the service's base URL; https only, except on localhost"],
      ['--product', 'the product id the service gave you'],
      [
        '--status',
        'where it points, whether HELPWELL_SUPPORT_TOKEN is set, and whether it answers',
      ],
      ['--prompt', 'also print the setup as a prompt for an AI assistant'],
      ['(token)', 'never a flag: set HELPWELL_SUPPORT_TOKEN in the server environment'],
    ],
  },
  {
    name: 'unlink',
    summary: 'Forget the remote support extension in helpwell.config.json',
    usage: 'helpwell unlink',
  },
  {
    name: 'settings pull',
    summary: 'Write the settings in the database into helpwell.config.json',
    usage: 'helpwell settings pull [--url postgres://…]',
  },
  {
    name: 'settings push',
    summary: 'Push helpwell.config.json into the database, whichever is newer',
    usage: 'helpwell settings push [--url postgres://…]',
  },
];

export interface RunResult {
  exitCode: number;
}

export async function run(argv: string[], cwd = process.cwd()): Promise<RunResult> {
  const { positionals, flags, rest } = parseArgs(argv);
  const command = positionals[0];
  const sub = positionals[1];
  // Per run, not per process: a test drives many commands in one process.
  setVerbose(bool(flags, 'verbose') ?? false);
  const json = bool(flags, 'json') ?? false;

  // --version wins over everything, including the no-command help screen.
  if (bool(flags, 'version', 'v') || command === 'version') {
    if (json) writeJson({ ok: true, command: 'version', result: { version: VERSION } });
    else say(VERSION);
    return { exitCode: 0 };
  }

  if (!command || bool(flags, 'help', 'h')) {
    if (json) {
      writeJson({ ok: true, command: 'help', result: { version: VERSION, commands: COMMANDS } });
    } else {
      printHelp(command, sub);
    }
    return { exitCode: 0 };
  }

  const name =
    sub && ['docs', 'settings', 'webhooks'].includes(command) ? `${command} ${sub}` : command;
  if (json) {
    if (command === 'dev') {
      writeJson({
        ok: false,
        command,
        error: {
          code: 'bad_request',
          message: '`helpwell dev` is interactive; use `helpwell ask --json`.',
        },
      });
      return { exitCode: 1 };
    }
    return runAsJson(name, () => dispatch(command, sub, positionals, flags, rest, cwd, true));
  }
  const outcome = await dispatch(command, sub, positionals, flags, rest, cwd, false);
  return { exitCode: outcome.exitCode };
}

interface Outcome {
  exitCode: number;
  /** What `--json` prints: the command's own return value. */
  result?: unknown;
  error?: unknown;
}

/** Run one command. Never throws: a failure is reported and becomes exit code 1. */
async function dispatch(
  command: string,
  sub: string | undefined,
  positionals: string[],
  flags: ReturnType<typeof parseArgs>['flags'],
  rest: string[],
  cwd: string,
  json: boolean,
): Promise<Outcome> {
  const url = str(flags, 'url');

  try {
    switch (command) {
      case 'init': {
        const framework = str(flags, 'framework');
        if (framework !== undefined && !isFramework(framework)) {
          fail(`Unknown framework: ${framework}`);
          detail(`Pick one of ${FRAMEWORKS.join(', ')}.`);
          return { exitCode: 1 };
        }
        const result = await init({
          cwd,
          name: str(flags, 'name'),
          docs: str(flags, 'docs'),
          appUrl: str(flags, 'appUrl'),
          framework,
          force: bool(flags, 'force') ?? false,
          dryRun: bool(flags, 'dryRun') ?? false,
          ci: bool(flags, 'ci') ?? false,
        });
        return { exitCode: 0, result };
      }

      case 'doctor': {
        const result = await doctor({ cwd, url });
        return { exitCode: result.ok ? 0 : 1, result };
      }

      case 'migrate':
        return { exitCode: 0, result: await runMigrate({ cwd, url }) };

      case 'sync': {
        // An explicit --settings means "overwrite"; --no-settings means
        // "leave them"; neither means "push only when the file is newer".
        const settings = bool(flags, 'settings');
        const result = await sync({
          cwd,
          url,
          force: bool(flags, 'force') ?? false,
          noEmbeddings: bool(flags, 'embeddings') === false,
          settings: settings === undefined ? undefined : settings ? 'force' : false,
        });
        return { exitCode: 0, result };
      }

      case 'dev':
        await dev({ cwd, url, offline: bool(flags, 'offline') ?? false });
        return { exitCode: 0 };

      case 'ask': {
        // `helpwell ask -- "--weird question"` keeps a question that starts
        // with dashes.
        const question = [...positionals.slice(1), ...rest].join(' ').trim();
        if (!question) {
          fail('Ask what? `helpwell ask "how do I export invoices?"`');
          return { exitCode: 1 };
        }
        const answer = await ask({ cwd, url, question, offline: bool(flags, 'offline') ?? false });
        return { exitCode: 0, result: { question, answer } };
      }

      case 'docs': {
        if (sub === 'update') {
          const edits = await docsUpdate({
            cwd,
            since: str(flags, 'since'),
            dryRun: bool(flags, 'dryRun') ?? false,
          });
          return { exitCode: 0, result: edits };
        }
        if (sub === 'generate' || sub === undefined) {
          const drafts = await docsGenerate({
            cwd,
            about: str(flags, 'about'),
            count: num(flags, 'count'),
            dryRun: bool(flags, 'dryRun') ?? false,
          });
          return { exitCode: 0, result: drafts };
        }
        fail(`Unknown: helpwell docs ${sub}`);
        detail('Try `helpwell docs generate` or `helpwell docs update`.');
        return { exitCode: 1 };
      }

      case 'changelog': {
        const source = str(flags, 'source');
        const draft = await changelog({
          cwd,
          url,
          source: source as ChangelogSource | undefined,
          repo: str(flags, 'repo'),
          prompt: bool(flags, 'prompt') ?? false,
          since: str(flags, 'since'),
          to: str(flags, 'to'),
          version: str(flags, 'release'),
          publish: bool(flags, 'publish') ?? false,
          dryRun: bool(flags, 'dryRun') ?? false,
        });
        return { exitCode: 0, result: draft };
      }

      case 'capture': {
        const result = await capture({
          cwd,
          url: str(flags, 'url'),
          only: str(flags, 'only'),
          out: str(flags, 'out'),
        });
        return { exitCode: result.ok ? 0 : 1, result };
      }

      case 'eval':
      case 'evals': {
        const result = await runEvals({
          cwd,
          url,
          ref: str(flags, 'ref'),
          threshold: num(flags, 'threshold'),
          dryRun: bool(flags, 'dryRun') ?? false,
        });
        return { exitCode: result.belowThreshold ? 1 : 0, result };
      }

      case 'export': {
        const out = str(flags, 'out');
        const document = await runExport({
          cwd,
          url,
          out,
          anonymise: bool(flags, 'anonymise') ?? bool(flags, 'anonymize') ?? false,
          quiet: json,
        });
        // With --json and no file, the export itself is the result.
        if (!out) return { exitCode: 0, result: JSON.parse(document) };
        const data = (JSON.parse(document) as { data: Record<string, unknown[]> }).data;
        return {
          exitCode: 0,
          result: {
            out,
            tables: Object.fromEntries(Object.entries(data).map(([k, rows]) => [k, rows.length])),
          },
        };
      }

      case 'prune':
        return { exitCode: 0, result: await runPrune({ cwd, url, months: num(flags, 'months') }) };

      case 'import': {
        const result = await runImport({
          cwd,
          url,
          source: sub,
          target: positionals[2],
          dryRun: bool(flags, 'dryRun') ?? false,
          force: bool(flags, 'force') ?? false,
          draft: bool(flags, 'draft') ?? false,
          images: bool(flags, 'images'),
          collection: str(flags, 'collection'),
          subdomain: str(flags, 'subdomain'),
          locale: str(flags, 'locale'),
          email: str(flags, 'email'),
          websiteId: str(flags, 'websiteId'),
          max: num(flags, 'max'),
          prompt: bool(flags, 'prompt') ?? false,
        });
        return { exitCode: 0, result };
      }

      case 'webhooks': {
        if (sub === 'retry') {
          return {
            exitCode: 0,
            result: await webhooksRetry({ cwd, url, now: bool(flags, 'now') ?? false }),
          };
        }
        if (sub === 'test') {
          const result = await webhooksTest({ cwd, url, target: str(flags, 'to') });
          return { exitCode: result.length > 0 ? 0 : 1, result };
        }
        if (sub === undefined || sub === 'list') {
          const status = str(flags, 'status');
          const known = ['pending', 'delivered', 'failed', 'retrying'] as const;
          return {
            exitCode: 0,
            result: await webhooksList({ cwd, url, status: known.find((s) => s === status) }),
          };
        }
        fail(`Unknown: helpwell webhooks ${sub}`);
        detail('Try `helpwell webhooks`, `helpwell webhooks retry` or `helpwell webhooks test`.');
        return { exitCode: 1 };
      }

      case 'link': {
        if (sub === 'status' || bool(flags, 'status')) {
          const status = await linkStatus({ cwd, prompt: bool(flags, 'prompt') ?? false });
          return { exitCode: status.check?.ok ? 0 : 1, result: status };
        }
        const result = await link({
          cwd,
          url: url ?? sub,
          product: str(flags, 'product'),
          token: flags.token === undefined ? undefined : String(flags.token),
          prompt: bool(flags, 'prompt') ?? false,
          interactive: json ? false : undefined,
        });
        return { exitCode: result.check && !result.check.ok ? 1 : 0, result };
      }

      case 'prompt': {
        const result = prompt({
          cwd,
          topic: sub,
          copy: bool(flags, 'copy') ?? false,
          quiet: json,
          framework: str(flags, 'framework'),
          platform: str(flags, 'platform'),
          form: str(flags, 'form'),
          event: str(flags, 'event'),
          engagement: str(flags, 'engagement'),
          origin: str(flags, 'origin'),
          domains: str(flags, 'domains'),
          url,
          product: str(flags, 'product'),
          repo: str(flags, 'repo'),
          tool: str(flags, 'tool'),
        });
        return { exitCode: 0, result };
      }

      case 'unlink':
        return { exitCode: 0, result: unlink({ cwd }) };

      case 'settings': {
        // Secrets never go out in --json, the same as in an export.
        if (sub === 'pull') {
          return { exitCode: 0, result: redactSettings(await settingsPull({ cwd, url })) };
        }
        if (sub === 'push') {
          return { exitCode: 0, result: redactSettings(await settingsPush({ cwd, url })) };
        }
        fail(`Unknown: helpwell settings ${sub ?? ''}`.trim());
        detail('Try `helpwell settings pull` or `helpwell settings push`.');
        return { exitCode: 1 };
      }

      default:
        fail(`Unknown command: ${command}`);
        say();
        printHelp();
        return { exitCode: 1 };
    }
  } catch (error) {
    return { exitCode: reportError(error), error };
  }
}

function reportError(error: unknown): number {
  if (error instanceof NotInstalledError) {
    fail(error.message);
    detail('`helpwell init` writes a config, some instructions and a first article.');
    return 1;
  }

  if (isHelpWellError(error)) {
    fail(error.message);
    return 1;
  }

  fail(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack && (isVerbose() || process.env.HELPWELL_DEBUG)) {
    say(style.dim(error.stack));
  } else {
    detail('Run it again with --verbose for the stack trace.');
  }
  return 1;
}

/**
 * The help screen: the whole table, or one command. A two-word command
 * (`docs update`) is matched on both words, so it gets its own screen rather
 * than its sibling's.
 */
export function printHelp(forCommand?: string, sub?: string): void {
  const spec = forCommand
    ? (COMMANDS.find((c) => c.name === `${forCommand} ${sub}`) ??
      COMMANDS.find((c) => c.name === forCommand) ??
      COMMANDS.find((c) => c.name.startsWith(`${forCommand} `)))
    : undefined;

  if (spec) {
    heading(spec.name);
    say(`  ${spec.summary}`);
    say();
    say(`  ${style.dim(spec.usage)}`);
    if (spec.flags) {
      say();
      table(spec.flags);
    }
    say();
    detail(`--verbose shows the working: ${VERBOSE_SHOWS}.`);
    say();
    return;
  }

  banner(VERSION);
  heading('Commands');
  table(COMMANDS.map((command) => [command.name, command.summary] as [string, string]));
  heading('On any command');
  table([
    ['--verbose', `show the working: ${VERBOSE_SHOWS}`],
    ['--help', 'more on that one command'],
    ['--json', 'print the result as one JSON document on stdout, for scripts and agents'],
  ]);
  say();
}
