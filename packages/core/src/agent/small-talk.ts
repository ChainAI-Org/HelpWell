/**
 * Is this message small talk: a greeting, a thank-you, an "ok", with no
 * question in it?
 *
 * Small talk is not a question the docs failed to answer. Scored like one,
 * "hi" finds no article, lands under the confidence threshold, turns the
 * conversation unresolved, records a gap called "hi", and offers the visitor
 * the support email before they have asked anything. A follow-up turn was
 * already judged on the conversation instead (agent.ts, `conversational`);
 * this lets the first turn be judged the same way when it is plainly not a
 * question.
 *
 * Deliberately narrow, and without a model call: every word must be a
 * greeting, a thanks, an acknowledgement or a filler that goes with them,
 * with at least one of the first three. "Hi, how do I export?" is a
 * question; so is "hello, is anyone there?". When in doubt it is a question,
 * which only means the answer is scored the way it always was.
 */

/** Words that make a message small talk on their own. */
const SMALL_TALK = new Set([
  // greetings
  'hi',
  'hii',
  'hiya',
  'hey',
  'heya',
  'hello',
  'helo',
  'yo',
  'howdy',
  'greetings',
  'morning',
  'afternoon',
  'evening',
  'gm',
  'hola',
  'bonjour',
  'salut',
  'hallo',
  'ciao',
  // thanks
  'thanks',
  'thank',
  'thankyou',
  'thx',
  'ty',
  'tysm',
  'cheers',
  'ta',
  'appreciate',
  'appreciated',
  'merci',
  'gracias',
  'danke',
  'grazie',
  'obrigado',
  'obrigada',
  // acknowledgements
  'ok',
  'okay',
  'k',
  'kk',
  'cool',
  'great',
  'awesome',
  'perfect',
  'nice',
  'sweet',
  'brilliant',
  'excellent',
  'lovely',
  'wonderful',
  'amazing',
  'fantastic',
  'super',
  'gotcha',
  'understood',
  'noted',
  'alright',
  'np',
  // goodbyes
  'bye',
  'goodbye',
  'cya',
]);

/** Words that go with small talk but are not small talk alone ("so much", "that works"). */
const FILLERS = new Set([
  'a',
  'again',
  'ah',
  'all',
  'and',
  'day',
  'do',
  'everyone',
  'folks',
  'for',
  'good',
  'got',
  'haha',
  'have',
  'help',
  'helped',
  'helps',
  'i',
  'ill',
  'it',
  'its',
  'just',
  'later',
  'lol',
  'lot',
  'lots',
  'makes',
  'me',
  'much',
  'no',
  'now',
  'oh',
  'problem',
  'really',
  'see',
  'sense',
  'set',
  'so',
  'sounds',
  'sure',
  'team',
  'that',
  'thats',
  'the',
  'then',
  'there',
  'this',
  'time',
  'too',
  'very',
  'wow',
  'will',
  'works',
  'worked',
  'worries',
  'ya',
  'yeah',
  'yep',
  'yes',
  'you',
  'your',
  'yup',
]);

const MAX_WORDS = 8;
const MAX_LENGTH = 80;

export function isSmallTalk(message: string): boolean {
  const text = message.normalize('NFKC').toLowerCase().replace(/['’]/g, '').trim();
  if (!text || text.length > MAX_LENGTH) return false;
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Nothing but an emoji or two: a thumbs up is an "ok".
  if (words.length === 0) return /\p{Extended_Pictographic}/u.test(text);
  if (words.length > MAX_WORDS) return false;
  return (
    words.every((word) => SMALL_TALK.has(word) || FILLERS.has(word)) &&
    words.some((word) => SMALL_TALK.has(word))
  );
}
