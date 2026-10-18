/**
 * A scripted model, for tests and for `helpwell dev --offline`.
 *
 * Real behaviour is asserted against this rather than a live key, so the test
 * suite is deterministic, free and runs in CI without secrets.
 *
 * `cites` and `certainty` write the reply the way a real model is asked to
 * (agent/grounding.ts): passage numbers in square brackets, and a certainty
 * line at the end. They go through the same parsing a real reply does, so a
 * test exercises the whole path rather than a shortcut around it.
 *
 * `FakeModel.grounded(db)` is the one that answers without a script: it
 * quotes and cites what search found (grounded-script.ts), for offline mode
 * and a playground with no key.
 */

import type { Db } from '../db/client.js';
import { searchWithSignals } from '../search/search.js';
import {
  type GroundedMatch,
  type GroundedWording,
  groundedReply,
  questionOf,
} from './grounded-script.js';
import type { Certainty } from './grounding.js';
import type {
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ModelPort,
  ModelToolCall,
} from './model.js';

export interface ScriptedTurn {
  /** What the model says. */
  text?: string;
  /** Passage numbers to cite, appended to the text as `[1][2]`. */
  cites?: number[];
  /** Appended as the `<certainty>` line. A bare level gives no reason. */
  certainty?: Certainty | { level: Certainty; reason?: string };
  /** Tools it asks for before answering. */
  toolCalls?: Omit<ModelToolCall, 'id'>[];
  usage?: { tokensIn?: number; tokensOut?: number; costUsd?: number };
  /** Throw instead of answering, to exercise the fallback path. */
  error?: Error;
}

/** A turn worked out from the request, for a script that depends on what was asked. */
export type ScriptFn = (request: ChatRequest, turn: number) => ScriptedTurn;

export interface GroundedModelOptions {
  /**
   * How each reply reads, from what search found. Defaults to a plain quote
   * for a terminal (`plainWording`). The citation and the certainty line are
   * added whatever the wording.
   */
  wording?: GroundedWording;
}

export class FakeModel implements ModelPort {
  readonly requests: ChatRequest[] = [];
  readonly embedRequests: EmbedRequest[] = [];
  #turns: ScriptedTurn[] | ScriptFn;
  #turn = 0;

  constructor(turns: ScriptedTurn[] | ScriptFn = [{ text: 'Here is the answer.' }]) {
    this.#turns = turns;
  }

  /**
   * A model that needs no key and answers from the docs. Before each reply it
   * runs the search the agent has just run, text only (there is no key to
   * embed the question with) and as an anonymous visitor would, to learn how
   * much of the question matched. Then it quotes the closest sentence of the
   * top passage the agent put in its prompt, cites it, and says how sure it
   * is, so the answer is grounded, cited and scored like a real model's.
   *
   * Give the agent `models: { embeddings: null, fallback: null }` with it:
   * these vectors do not live in the space real embeddings were stored in,
   * and there is no second model to fall back to.
   */
  static grounded(db: Db, options: GroundedModelOptions = {}): FakeModel {
    return new GroundedModel(db, options);
  }

  /** Replace the script mid-test. */
  script(turns: ScriptedTurn[] | ScriptFn): void {
    this.#turns = turns;
    this.#turn = 0;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const turn =
      typeof this.#turns === 'function'
        ? this.#turns(request, this.#turn)
        : this.#turns[Math.min(this.#turn, this.#turns.length - 1)];
    this.#turn++;
    if (turn?.error) throw turn.error;

    const toolCalls = (turn?.toolCalls ?? []).map((call, i) => ({
      id: `call_${this.#turn}_${i}`,
      name: call.name,
      arguments: call.arguments,
    }));

    return {
      text: render(turn),
      toolCalls,
      usage: {
        tokensIn: turn?.usage?.tokensIn ?? 100,
        tokensOut: turn?.usage?.tokensOut ?? 50,
        costUsd: turn?.usage?.costUsd ?? 0.001,
      },
      model: request.model,
      wantsTools: toolCalls.length > 0,
    };
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    this.embedRequests.push(request);
    // A deterministic bag-of-words vector: similar text lands nearby, which is
    // all a semantic-search test needs.
    const vectors = request.input.map((text) => {
      const v = new Array(64).fill(0) as number[];
      for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
        let h = 0;
        for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
        v[h % 64] = (v[h % 64] ?? 0) + 1;
      }
      const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
    return { vectors, usage: { tokensIn: 10, tokensOut: 0, costUsd: 0.00001 } };
  }
}

/** `FakeModel.grounded()`: a script written from the search that ran just before it. */
class GroundedModel extends FakeModel {
  readonly #db: Db;
  readonly #last: { match?: GroundedMatch };

  constructor(db: Db, options: GroundedModelOptions) {
    const last: { match?: GroundedMatch } = {};
    super((request, turn) =>
      groundedReply(request, { match: last.match, turn, wording: options.wording }),
    );
    this.#db = db;
    this.#last = last;
  }

  override async chat(request: ChatRequest): Promise<ChatResponse> {
    const { signals } = await searchWithSignals(this.#db, questionOf(request), {
      limit: 5,
      forAgent: true,
    });
    // Read by the script as the reply is written, with no await in between,
    // so two conversations answered at once cannot swap their matches.
    this.#last.match = signals;
    return super.chat(request);
  }
}

function render(turn: ScriptedTurn | undefined): string {
  let text = turn?.text ?? '';
  if (turn?.cites?.length) text += ` ${turn.cites.map((n) => `[${n}]`).join('')}`;
  if (turn?.certainty) {
    const { level, reason } =
      typeof turn.certainty === 'string'
        ? { level: turn.certainty, reason: undefined }
        : turn.certainty;
    text += `\n<certainty>${level}${reason ? `: ${reason}` : ''}</certainty>`;
  }
  return text;
}
