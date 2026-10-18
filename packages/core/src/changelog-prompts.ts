/**
 * The setup a changelog source needs outside HelpWell, as a prompt for an AI
 * assistant: a GitHub token that can read releases.
 *
 * `helpwell changelog` with `changelog.source: github_releases` reads the
 * notes on a release from the GitHub API. Without a token GitHub allows 60
 * requests an hour from one IP address and cannot see a private repository,
 * which is fine for a laptop and a public repo and not for a busy CI runner
 * or a private one. The token needs read access to one repository's contents
 * and nothing more, and the prompt says exactly that.
 */

import type { SetupPromptSpec } from './setup-prompt.js';

export const GITHUB_TOKEN_ENV = 'GITHUB_TOKEN';

export interface GitHubTokenPromptOptions {
  productName?: string;
  /** `owner/name`, from `changelog.repo` or the repo's GitHub remote. */
  repo?: string;
}

export function githubTokenPromptSpec(options: GitHubTokenPromptOptions = {}): SetupPromptSpec {
  const product = options.productName?.trim() || 'my product';
  const repo = options.repo?.trim() || '<owner>/<repo>';
  const known = Boolean(options.repo?.trim());
  return {
    task: `a GitHub token so HelpWell can read ${product}'s releases`,
    goal: `\`helpwell changelog\` reads the notes on ${repo}'s GitHub releases with ${GITHUB_TOKEN_ENV} set, wherever it runs: in GitHub Actions, and on my machine if I run it there.`,
    context: [
      `HelpWell's \`helpwell changelog\` drafts a customer-facing changelog entry from the notes on a GitHub release when \`changelog.source\` is \`github_releases\` in helpwell/helpwell.config.json, or is not set and the repo's origin remote is on GitHub. It calls GET https://api.github.com/repos/${repo}/releases/latest (or /releases/tags/<tag> with --release) and never writes to GitHub.`,
      `Without a token GitHub allows 60 requests an hour from one IP address, which shared CI runners use up, and a private repository cannot be read at all. With ${GITHUB_TOKEN_ENV} set, HelpWell sends it and the limit is 5,000 an hour.`,
      'Read access to the repository contents is all it needs.',
      `In GitHub Actions, the workflow's built-in token already works for the same repository: the job needs \`permissions: contents: read\` and the step needs ${GITHUB_TOKEN_ENV} set from \`secrets.GITHUB_TOKEN\`. No personal token is needed there.`,
      known
        ? `The repository is ${repo}.`
        : 'I have not said which repository: ask me for its owner/name.',
    ],
    steps: [
      'Ask me where `helpwell changelog` runs: in GitHub Actions, on my machine, or both. Only set up those.',
      `GitHub Actions, same repository: in the workflow job that runs \`helpwell changelog\`, add \`permissions: contents: read\` and set ${GITHUB_TOKEN_ENV} on the step from \`secrets.GITHUB_TOKEN\`, as in the block below. Keep everything already in the workflow.`,
      `My machine, or CI outside GitHub: walk me through creating a fine-grained personal access token at https://github.com/settings/personal-access-tokens/new with the settings in the table: only ${repo}, Contents read-only, nothing else, and the shortest expiry my team allows.`,
      `Tell me where to paste the token myself: as ${GITHUB_TOKEN_ENV} in the repo's .env file (check .env is in .gitignore first), or in my CI provider's secret settings.`,
      `If \`changelog.repo\` in helpwell/helpwell.config.json is empty, set it to ${repo}. Leave \`changelog.source\` as \`github_releases\`, or unset; if it says tags or commits, ask me before changing it.`,
    ],
    tables: [
      {
        title: 'The fine-grained token',
        rows: [
          { setting: 'Token type', value: 'Fine-grained personal access token' },
          { setting: 'Resource owner', value: known ? repo.split('/')[0]! : '<owner>' },
          { setting: 'Repository access', value: `Only select repositories: ${repo}` },
          { setting: 'Repository permissions: Contents', value: 'Read-only' },
          { setting: 'Repository permissions: Metadata', value: 'Read-only (GitHub adds it)' },
          { setting: 'Every other permission', value: 'No access' },
          { setting: 'Environment variable', value: GITHUB_TOKEN_ENV },
        ],
      },
    ],
    blocks: [
      {
        caption: 'GitHub Actions: the job that drafts the entry',
        language: 'yaml',
        content: `jobs:
  changelog:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: npx helpwell changelog
        env:
          ${GITHUB_TOKEN_ENV}: \${{ secrets.GITHUB_TOKEN }}
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}`,
      },
    ],
    rules: [
      'Give the token read-only access to contents of this one repository. Never grant write, admin, workflow or organisation permissions.',
      `Never put the token in helpwell.config.json, a workflow file or any committed file. It lives in .env (git-ignored) or the CI secret store as ${GITHUB_TOKEN_ENV}.`,
    ],
    verify: [
      `Run: curl -sS -o /dev/null -w "%{http_code}\\n" -H "Authorization: Bearer $${GITHUB_TOKEN_ENV}" https://api.github.com/repos/${repo}/releases/latest (200 means it can read the latest release; 404 means there is no published release yet, or the token cannot see the repository).`,
      'Run: npx helpwell changelog --dry-run. It prints a draft made from the latest release and saves nothing.',
    ],
    report: `Tell me where ${GITHUB_TOKEN_ENV} is set, which repository it can read, when it expires, and what the dry run printed.`,
  };
}
