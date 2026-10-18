import { describe, expect, it } from 'vitest';
import { githubTokenPromptSpec } from '../src/changelog-prompts.js';
import { formatSetupPrompt, STANDARD_SETUP_RULES } from '../src/setup-prompt.js';

describe('setup prompts for AI assistants', () => {
  const prompt = formatSetupPrompt({
    task: 'email sending for Acme',
    goal: 'Acme can send support email from support@acme.com.',
    context: ['DNS is hosted at Cloudflare.'],
    steps: ['Open the DNS page for acme.com.', 'Add each record below.'],
    tables: [
      {
        title: 'DNS records',
        rows: [
          { Type: 'TXT', Host: 'resend._domainkey', Value: 'p=MIGf|MA0', Priority: null },
          {
            Type: 'MX',
            Host: 'send',
            Value: 'feedback-smtp.us-east-1.amazonses.com',
            Priority: 10,
          },
        ],
      },
    ],
    blocks: [
      {
        caption: 'Run this to check:',
        language: 'bash',
        content: 'dig TXT resend._domainkey.acme.com +short',
      },
    ],
    rules: ['Leave the existing MX records on acme.com alone.'],
    verify: ['Click Verify in HelpWell.'],
  });

  it('keeps the goal, numbered steps and task rules', () => {
    expect(prompt).toContain('You are helping me set up email sending for Acme.');
    expect(prompt).toContain('## Goal\n\nAcme can send support email from support@acme.com.');
    expect(prompt).toContain('1. Open the DNS page for acme.com.\n2. Add each record below.');
    expect(prompt).toContain('- Leave the existing MX records on acme.com alone.');
    expect(prompt).toContain('1. Click Verify in HelpWell.');
  });

  it('says "set up" unless the spec names what the assistant helps with', () => {
    const using = formatSetupPrompt({
      task: 'the inbox',
      verb: 'work on',
      goal: 'y',
      steps: ['z'],
    });
    expect(using).toMatch(/^You are helping me work on the inbox. /);
    const blank = formatSetupPrompt({ task: 'the inbox', verb: '  ', goal: 'y', steps: ['z'] });
    expect(blank).toMatch(/^You are helping me set up the inbox. /);
  });

  it('always tells the assistant never to ask for secrets', () => {
    for (const rule of STANDARD_SETUP_RULES) expect(prompt).toContain(rule);
    const bare = formatSetupPrompt({ task: 'x', goal: 'y', steps: ['z'] });
    expect(bare).toContain(STANDARD_SETUP_RULES[0]);
  });

  it('renders exact values as a table and as JSON, escaping pipes in cells', () => {
    expect(prompt).toContain('| Type | Host | Value | Priority |');
    expect(prompt).toContain('| TXT | resend._domainkey | p=MIGf\\|MA0 | — |');
    expect(prompt).toContain('"Value": "p=MIGf|MA0"');
    expect(prompt).toContain('"Priority": 10');
  });

  it('fences code so backticks inside cannot close the block early', () => {
    const tricky = formatSetupPrompt({
      task: 'x',
      goal: 'y',
      steps: ['z'],
      blocks: [{ caption: 'Snippet', language: 'md', content: 'use ```ts fences```' }],
    });
    expect(tricky).toContain('````md\nuse ```ts fences```\n````');
  });
});

describe('the GitHub token prompt', () => {
  it('asks for read-only access to one repository, checkably, and never for the token', () => {
    const prompt = formatSetupPrompt(
      githubTokenPromptSpec({ productName: 'Acme', repo: 'acme/app' }),
    );
    expect(prompt).toContain('https://api.github.com/repos/acme/app/releases/latest');
    expect(prompt).toContain('Only select repositories: acme/app');
    expect(prompt).toContain('| Repository permissions: Contents | Read-only |');
    expect(prompt).toContain('permissions:\n      contents: read');
    expect(prompt).toContain('secrets.GITHUB_TOKEN');
    expect(prompt).toContain('-H "Authorization: Bearer $GITHUB_TOKEN"');
    for (const rule of STANDARD_SETUP_RULES) expect(prompt).toContain(rule);
  });

  it('asks which repository when it does not know', () => {
    const prompt = formatSetupPrompt(githubTokenPromptSpec());
    expect(prompt).toContain('<owner>/<repo>');
    expect(prompt).toContain('ask me for its owner/name');
  });
});
