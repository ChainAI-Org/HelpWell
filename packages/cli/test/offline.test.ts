/**
 * Offline mode: `helpwell ask --offline` and `dev --offline` with no model.
 *
 * The reply is scripted from what search found (core's FakeModel.grounded,
 * whose wording is tested in core), so these check the parts that are real,
 * against a project the CLI set up and indexed: a question the docs answer
 * resolves, cites the article search put first and scores well enough not to
 * be a gap; a question they do not answer, or share only a stray word with,
 * is unresolved and logged as one.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, CONFIDENCE_THRESHOLD, FakeModel } from '@helpwell/core/agent';
import { createDb, type Db, schema } from '@helpwell/core/db';
import { SettingsStore } from '@helpwell/core/settings';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ask } from '../src/commands/ask.js';
import { init } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';

let dir: string;
let output: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'helpwell-offline-'));
  output = [];
  // Never reach a real provider or a real database from a test, even on a
  // machine that has them configured.
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.HELPWELL_DATABASE_URL;
  delete process.env.DATABASE_URL;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function printed(): string {
  return output.join('');
}

function write(relative: string, contents: string): void {
  const path = join(dir, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

describe('offline answers against real search', () => {
  beforeEach(async () => {
    await init({ cwd: dir, name: 'Acme' });
    write(
      'docs/billing/invoices.md',
      `---
title: Exporting invoices
description: Download a PDF of any invoice.
status: published
---

Open Billing, then Invoices, then press Export. Pick PDF or CSV and the file downloads straight away.
`,
    );
    write(
      'docs/account/two-factor.md',
      `---
title: Turning on two-factor sign-in
status: published
---

Go to Settings, then Security, and switch on Two-factor. Scan the code with an authenticator app.
`,
    );
    await sync({ cwd: dir });
  });

  /** The project's embedded database, opened the way the CLI opens it. */
  async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const handle = await createDb({ url: `pglite://${join(dir, 'helpwell', 'data')}` });
    try {
      return await fn(handle.db);
    } finally {
      await handle.close();
    }
  }

  /** An agent wired exactly as `openAgent` wires it offline. */
  async function offlineAgent(db: Db): Promise<Agent> {
    return new Agent({
      db,
      settings: await new SettingsStore(db).get(),
      model: FakeModel.grounded(db),
      models: { embeddings: null, fallback: null },
    });
  }

  it('answers a covered question grounded, cited and resolved', async () => {
    await withDb(async (db) => {
      const reply = await (await offlineAgent(db)).reply({ message: 'How do I export invoices?' });

      expect(reply.degraded).toBe(false);
      expect(reply.unresolved).toBe(false);
      expect(reply.certainty).toBe('answered');
      expect(reply.citations.map((c) => c.slug)).toEqual(['billing/invoices']);
      expect(reply.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
      expect(reply.text).toContain('Exporting invoices');
      expect(reply.text).toContain('press Export');
      // The marker and the certainty line are the model's, never the reader's.
      expect(reply.text).not.toContain('[1]');
      expect(reply.text).not.toContain('<certainty>');

      expect(await db.select().from(schema.gaps)).toHaveLength(0);
      const [conversation] = await db.select().from(schema.conversations);
      expect(conversation?.status).toBe('resolved');
    });
  });

  it('marks a question nothing matches as not covered, and logs the gap', async () => {
    await withDb(async (db) => {
      const reply = await (await offlineAgent(db)).reply({ message: 'Can I pay in bitcoin?' });

      expect(reply.degraded).toBe(false);
      expect(reply.unresolved).toBe(true);
      expect(reply.certainty).toBe('not_covered');
      expect(reply.citations).toEqual([]);
      expect(reply.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);

      const gaps = await db.select().from(schema.gaps);
      expect(gaps.map((gap) => gap.question)).toEqual(['Can I pay in bitcoin?']);
    });
  });

  it('does not pass a stray shared word off as an answer', async () => {
    await withDb(async (db) => {
      // "export" is in the invoices article; payroll and bitcoin are nowhere.
      const reply = await (await offlineAgent(db)).reply({
        message: 'How do I export payroll to bitcoin?',
      });

      expect(reply.degraded).toBe(false);
      expect(reply.unresolved).toBe(true);
      expect(reply.certainty).toBe('not_covered');
      expect(reply.citations).toEqual([]);
      expect(await db.select().from(schema.gaps)).toHaveLength(1);
    });
  });

  it('calls a match on most of the question partial, and still answers it', async () => {
    await withDb(async (db) => {
      const reply = await (await offlineAgent(db)).reply({
        message: 'How do I export invoices to Dropbox?',
      });

      expect(reply.certainty).toBe('partial');
      expect(reply.citations.map((c) => c.slug)).toEqual(['billing/invoices']);
      expect(reply.unresolved).toBe(false);
    });
  });

  it('prints the cited answer and its confidence from `helpwell ask --offline`', async () => {
    const answer = await ask({ cwd: dir, question: 'How do I turn on two-factor?', offline: true });

    expect(answer).toContain('Turning on two-factor sign-in');
    expect(printed()).toContain('account/two-factor');
    expect(printed()).toMatch(/Confidence \d\.\d\d: High/);
    expect(printed()).not.toContain('Logged as a gap');
    expect(printed()).not.toContain('model was unavailable');

    await withDb(async (db) => {
      const [message] = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.role, 'agent'));
      expect(message?.certainty).toBe('answered');
      expect(message?.citations?.map((c) => c.slug)).toEqual(['account/two-factor']);
      expect(await db.select().from(schema.gaps)).toHaveLength(0);
    });
  });

  it('goes offline on its own with no key, and says so', async () => {
    await ask({ cwd: dir, question: 'Can I pay in bitcoin?' });

    expect(printed()).toContain('No OPENROUTER_API_KEY');
    expect(printed()).toContain('Nothing in the docs matched');
    expect(printed()).toContain('Logged as a gap');
  });
});
