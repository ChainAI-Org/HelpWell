/**
 * `--verbose` for model calls.
 *
 * A wrapper that reports each call as it finishes: which model answered, the
 * tokens each way, what it cost and how long it took. Every command that
 * talks to a real model builds it through here, so the report reads the same
 * whether the call came from `docs generate`, the agent inside `eval`, or an
 * embedding during `sync`. With `--verbose` off it costs one boolean check.
 */

import type { ModelPort, Usage } from '@helpwell/core/agent';
import { trace } from './ui.js';

export function traced(model: ModelPort): ModelPort {
  return {
    async chat(request) {
      const started = Date.now();
      try {
        const response = await model.chat(request);
        const tools = response.toolCalls.map((call) => call.name);
        trace(
          [
            `model ${response.model || request.model}`,
            usage(response.usage),
            since(started),
            tools.length > 0 ? `asked for ${tools.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        );
        return response;
      } catch (error) {
        trace(`model ${request.model} failed after ${since(started)}: ${reason(error)}`);
        throw error;
      }
    },

    async embed(request) {
      const started = Date.now();
      try {
        const response = await model.embed(request);
        trace(
          `embed ${request.model} · ${request.input.length} ${
            request.input.length === 1 ? 'text' : 'texts'
          } · ${usage(response.usage)} · ${since(started)}`,
        );
        return response;
      } catch (error) {
        trace(`embed ${request.model} failed after ${since(started)}: ${reason(error)}`);
        throw error;
      }
    },
  };
}

function usage(value: Usage): string {
  const tokens = `${value.tokensIn.toLocaleString('en-US')} in / ${value.tokensOut.toLocaleString('en-US')} out`;
  return `${tokens} · $${value.costUsd.toFixed(4)}`;
}

function since(started: number): string {
  const ms = Date.now() - started;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
