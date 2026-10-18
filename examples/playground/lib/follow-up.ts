/**
 * The one question the scripted model answers with a tool: asking for a
 * person rather than an article.
 *
 * Without an OPENROUTER_API_KEY the playground's model quotes the docs
 * (lib/helpwell.ts), and a model that only quotes never calls a tool, so the
 * widget's email card could only be seen through the pre-chat form. Asking
 * for someone to get back to you ("can someone from your team get back to
 * me?") is scripted the way a real model that follows the playbook behaves:
 * it calls `collect_email` with a short reason, reads what the tool said,
 * then says what happens next. The tool, the email card under the answer,
 * the address saved to the contact, and the conversation left unresolved
 * for the team are all the real code paths. Every other question still goes
 * to the docs.
 */

import {
  type ChatRequest,
  FakeModel,
  type ModelPort,
  questionOf,
  type ScriptedTurn,
} from '@helpwell/core/agent';

/** What the model tells the visitor it wants the address for, shown on the card. */
export const FOLLOW_UP_REASON = 'So someone from the Ridgeline team can get back to you.';

/** Someone asking for a person, however they put it. */
const WANTS_A_PERSON =
  /\b(talk|speak|chat) (to|with) (a |an )?(person|human|real person|someone)\b|\bsomeone from (your|the) team\b|\b(get|come) back to me\b|\b(contact|call) me\b/i;

export function wantsAPerson(question: string): boolean {
  return WANTS_A_PERSON.test(question);
}

/**
 * `model`, except that a request for a person is answered by the script
 * below. Hand it the model the playground would use anyway.
 */
export function withFollowUp(model: ModelPort): ModelPort {
  const script = new FakeModel(followUpTurn);
  return {
    chat: (request) => (wantsAPerson(questionOf(request)) ? script : model).chat(request),
    embed: (request) => model.embed(request),
  };
}

/** What `collect_email` answered this turn, or undefined before it has been called. */
function emailToolResult(request: ChatRequest): { asked?: boolean } | undefined {
  const lastQuestion = request.messages.map((message) => message.role).lastIndexOf('user');
  const answer = request.messages
    .slice(lastQuestion + 1)
    .find((message) => message.role === 'tool' && message.name === 'collect_email');
  if (!answer) return undefined;
  try {
    return JSON.parse(answer.content) as { asked?: boolean };
  } catch {
    return {};
  }
}

const UNRESOLVED = {
  level: 'not_covered',
  reason: 'offline: asked for a person, which no article can answer',
} as const;

function followUpTurn(request: ChatRequest): ScriptedTurn {
  const offered = (request.tools ?? []).some((tool) => tool.name === 'collect_email');
  const result = emailToolResult(request);

  // First the tool, when it is on offer: it is not for someone signed in.
  if (offered && !result) {
    return { toolCalls: [{ name: 'collect_email', arguments: { reason: FOLLOW_UP_REASON } }] };
  }
  if (result?.asked) {
    return {
      text: [
        "I can't put you through to a person from here, but the Ridgeline team can get back to you.",
        '',
        "Leave your email on the card below and they'll follow up there. I've marked this conversation for them.",
      ].join('\n'),
      certainty: UNRESOLVED,
    };
  }
  // The address is on file already, or the app told us who they are.
  return {
    text: "I can't put you through to a person from here. I've marked this conversation for the Ridgeline team, and they'll follow up at the email they already have for you.",
    certainty: UNRESOLVED,
  };
}
