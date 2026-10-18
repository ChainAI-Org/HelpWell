/**
 * What counts as small talk (agent/small-talk.ts): a greeting, a thanks or an
 * "ok" with no question in it. Anything else is a question, and is scored as
 * one.
 */

import { describe, expect, it } from 'vitest';
import { isSmallTalk } from '../src/agent/small-talk.js';

describe('small talk', () => {
  it('is a greeting, a thanks, an acknowledgement or a goodbye', () => {
    for (const message of [
      'hi',
      'Hi!',
      'hello there',
      'Hey team 👋',
      'Good morning',
      'thanks!',
      'Thank you so much, that helps',
      'thx',
      'ok',
      'Okay, got it.',
      'Great, thanks again!',
      "That's perfect, thank you",
      'bye',
      '👍',
      'merci',
    ]) {
      expect(isSmallTalk(message), message).toBe(true);
    }
  });

  it('is never a message that asks or says something', () => {
    for (const message of [
      'Hi, how do I export invoices?',
      'hello, is anyone there?',
      'Thanks, but it still does not work',
      'ok so where is billing',
      'I need help',
      'yes',
      'no',
      'refund',
      '?',
      '',
      'thanks '.repeat(12),
    ]) {
      expect(isSmallTalk(message), message).toBe(false);
    }
  });
});
