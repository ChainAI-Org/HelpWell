/**
 * `--json`: one JSON document on stdout, for coding agents and scripts.
 *
 * Commands print for people, through ui.ts and the odd direct write. Rather
 * than teach every command two output modes, `--json` moves everything a
 * command writes to stdout over to stderr while it runs, then prints the
 * command's return value as JSON on the real stdout. A person watching still
 * sees the progress; a pipe gets exactly one document it can parse.
 *
 *   { "ok": true, "command": "sync", "result": { ... } }
 *   { "ok": false, "command": "sync", "error": { "code": "...", "message": "..." } }
 */

import { isHelpWellError } from '@helpwell/core';
import { NotInstalledError } from './project.js';

type Write = typeof process.stdout.write;

/** Send stdout to stderr until the returned function is called. */
export function divertStdout(): () => void {
  const original = process.stdout.write;
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
    (process.stderr.write as (...args: unknown[]) => boolean)(chunk, ...rest)) as Write;
  return () => {
    process.stdout.write = original;
  };
}

export interface JsonOutcome {
  ok: boolean;
  command: string;
  result?: unknown;
  error?: { code: string; message: string };
}

export function writeJson(outcome: JsonOutcome): void {
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
}

/** The error half of the document: a stable code and the message a person would see. */
export function jsonError(error: unknown): { code: string; message: string } {
  if (error instanceof NotInstalledError) return { code: 'not_installed', message: error.message };
  if (isHelpWellError(error)) return { code: error.code, message: error.message };
  return { code: 'failed', message: error instanceof Error ? error.message : String(error) };
}

/** Run a command with stdout diverted, then print its outcome as JSON. */
export async function runAsJson(
  command: string,
  run: () => Promise<{ exitCode: number; result?: unknown; error?: unknown }>,
): Promise<{ exitCode: number }> {
  const restore = divertStdout();
  let outcome: { exitCode: number; result?: unknown; error?: unknown };
  try {
    outcome = await run();
  } catch (error) {
    outcome = { exitCode: 1, error };
  } finally {
    restore();
  }
  writeJson({
    ok: outcome.exitCode === 0,
    command,
    ...(outcome.result !== undefined ? { result: outcome.result } : {}),
    ...(outcome.error !== undefined ? { error: jsonError(outcome.error) } : {}),
  });
  return { exitCode: outcome.exitCode };
}
