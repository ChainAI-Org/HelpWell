/**
 * The model port.
 *
 * Everything that talks to a model goes through this interface, which buys two
 * things: the agent can be tested without a network or a key, and swapping
 * OpenRouter for something else later is one file rather than a rewrite.
 *
 * Keys are the customer's own (AG-01). HelpWell never proxies a model call.
 */

import { HelpWellError } from '../errors.js';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** set on assistant messages that asked for tools */
  toolCalls?: ModelToolCall[];
  /** set on tool messages, matching the call they answer */
  toolCallId?: string;
  name?: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments */
  parameters: Record<string, unknown>;
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface ChatRequest {
  model: string;
  messages: ModelMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  text: string;
  toolCalls: ModelToolCall[];
  usage: Usage;
  model: string;
  /** true when the model stopped because it wanted tools run */
  wantsTools: boolean;
}

export interface EmbedRequest {
  model: string;
  input: string[];
  signal?: AbortSignal;
}

export interface EmbedResponse {
  vectors: number[][];
  usage: Usage;
}

export interface ModelPort {
  chat(request: ChatRequest): Promise<ChatResponse>;
  embed(request: EmbedRequest): Promise<EmbedResponse>;
}

/* ------------------------------------------------------------- OpenRouter */

export interface OpenRouterOptions {
  /** May be empty: every call then fails with `not_configured`, and the agent answers from search. */
  apiKey: string;
  baseUrl?: string;
  /** Sent as HTTP-Referer so the customer's OpenRouter dashboard shows the app */
  appUrl?: string;
  appName?: string;
  fetch?: typeof globalThis.fetch;
  /**
   * How long one call may take before it counts as failed, so a hung upstream
   * reaches the fallback model or the search-only answer instead of hanging
   * the request. Defaults: 60 s for chat, 30 s for embeddings.
   */
  timeoutMs?: { chat?: number; embed?: number };
}

const CHAT_TIMEOUT_MS = 60_000;
const EMBED_TIMEOUT_MS = 30_000;

interface OpenRouterChoice {
  message?: {
    content?: string | null;
    tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  };
  finish_reason?: string;
}

interface OpenRouterChatBody {
  choices?: OpenRouterChoice[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; code?: string };
}

type UpstreamError = { error?: { message?: string; code?: string } };

export class OpenRouterModel implements ModelPort {
  readonly #key: string;
  readonly #baseUrl: string;
  readonly #appUrl?: string;
  readonly #appName: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #chatTimeoutMs: number;
  readonly #embedTimeoutMs: number;

  constructor(options: OpenRouterOptions) {
    // A missing key is refused per call, not here. The API builds a model for
    // every request, and an install with no key yet must still answer from
    // search rather than fail every message with "not set up".
    this.#key = options.apiKey ?? '';
    this.#baseUrl = options.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.#appUrl = options.appUrl;
    this.#appName = options.appName ?? 'HelpWell';
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#chatTimeoutMs = options.timeoutMs?.chat || CHAT_TIMEOUT_MS;
    this.#embedTimeoutMs = options.timeoutMs?.embed || EMBED_TIMEOUT_MS;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.#requireKey();
    const body = {
      model: request.model,
      messages: request.messages.map(toOpenRouterMessage),
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1024,
      ...(request.tools?.length
        ? {
            tools: request.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: 'auto',
          }
        : {}),
      usage: { include: true },
    };

    const json = await this.#post<OpenRouterChatBody>(
      '/chat/completions',
      body,
      request.signal,
      this.#chatTimeoutMs,
    );
    const choice = json.choices?.[0];
    const rawCalls = choice?.message?.tool_calls ?? [];

    return {
      text: choice?.message?.content ?? '',
      toolCalls: rawCalls.map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: safeJson(call.function.arguments),
      })),
      usage: {
        tokensIn: json.usage?.prompt_tokens ?? 0,
        tokensOut: json.usage?.completion_tokens ?? 0,
        costUsd: json.usage?.cost ?? 0,
      },
      model: json.model ?? request.model,
      wantsTools: rawCalls.length > 0 || choice?.finish_reason === 'tool_calls',
    };
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    this.#requireKey();
    const json = await this.#post<{
      data?: { embedding: number[] }[];
      usage?: { prompt_tokens?: number; cost?: number };
    }>(
      '/embeddings',
      { model: request.model, input: request.input },
      request.signal,
      this.#embedTimeoutMs,
    );

    return {
      vectors: (json.data ?? []).map((d) => d.embedding),
      usage: {
        tokensIn: json.usage?.prompt_tokens ?? 0,
        tokensOut: 0,
        costUsd: json.usage?.cost ?? 0,
      },
    };
  }

  #requireKey(): void {
    if (!this.#key) {
      throw new HelpWellError('not_configured', 'No OpenRouter key is set.', {
        publicMessage: 'The assistant is not set up yet.',
      });
    }
  }

  async #post<T extends object>(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<T> {
    // One controller for both reasons to stop: the caller gave up, or the
    // upstream took too long. Built by hand rather than with AbortSignal.any,
    // which the oldest supported Node does not have.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.#key}`,
          'content-type': 'application/json',
          ...(this.#appUrl ? { 'http-referer': this.#appUrl } : {}),
          'x-title': this.#appName,
        },
        body: JSON.stringify(body),
      });

      let json: T & UpstreamError;
      try {
        json = (await response.json()) as T & UpstreamError;
      } catch (cause) {
        if (controller.signal.aborted) throw cause;
        json = {} as T & UpstreamError;
      }

      if (!response.ok || json.error) {
        const message = json.error?.message ?? `OpenRouter returned ${response.status}`;
        // 401 is the customer's key, not our bug: say so plainly so the
        // Connections screen can show "your key was rejected".
        const code =
          response.status === 401 || response.status === 403 ? 'not_configured' : 'upstream_failed';
        throw new HelpWellError(code, message, {
          details: { status: response.status, code: json.error?.code },
        });
      }

      return json;
    } catch (cause) {
      if (cause instanceof HelpWellError) throw cause;
      throw new HelpWellError(
        'upstream_failed',
        timedOut
          ? `OpenRouter did not answer within ${Math.round(timeoutMs / 1000)} seconds.`
          : 'Could not reach OpenRouter.',
        { cause },
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

function toOpenRouterMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    };
  }
  if (message.toolCalls?.length) {
    return {
      role: message.role,
      content: message.content || null,
      tool_calls: message.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

/** Tool arguments as an object. Anything else, including an array, is `{}`. */
function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
