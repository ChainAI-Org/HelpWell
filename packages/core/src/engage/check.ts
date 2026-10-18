/**
 * Is an engagement ready to show? The checks the schema does not make.
 *
 * The schema (schema.ts) only guarantees a definition has the right shape,
 * because it runs every time settings are read and must never reject what is
 * already stored. Whether it is complete and makes sense is asked here, by
 * the dashboard editor before it saves and by anything else that writes one:
 * a button with a label and somewhere to go, media the widget can load, a
 * survey whose branches lead somewhere real.
 *
 * Each problem carries the dotted path of the field it is about
 * (`modal.slides.0.blocks.1.url`), which is also the name of that field in
 * the editor, so the message lands next to the input it concerns.
 */

import { isSafeLink, isSafeMediaUrl, videoProvider } from './media.js';
import { type Block, type Engagement, SCALES, type SurveyQuestion } from './schema.js';

export interface EngagementProblem {
  /** Dotted path of the field, e.g. `survey.questions.1.choices`. Empty: the whole thing. */
  path: string;
  message: string;
}

/** Ids appear in URLs and storage keys, so they stay plain. */
const ID = /^[\w.:-]{1,80}$/;

/**
 * Everything wrong with one engagement, or an empty list. Pass the other
 * engagements to check that its id is unique and that "start tour" buttons
 * name a tour that exists.
 */
export function checkEngagement(
  engagement: Engagement,
  others: readonly Engagement[] = [],
): EngagementProblem[] {
  const problems: EngagementProblem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  const tours = new Set(others.filter((e) => e.kind === 'tour').map((e) => e.id));
  if (engagement.kind === 'tour') tours.add(engagement.id);

  if (!ID.test(engagement.id)) {
    add('id', 'Use letters, numbers, dashes, dots and underscores only.');
  } else if (others.some((other) => other !== engagement && other.id === engagement.id)) {
    add('id', 'Another engagement already uses this id.');
  }

  engagement.triggers.forEach((trigger, i) => {
    if (trigger.type === 'click' && !trigger.selector) {
      add(
        `triggers.${i}.selector`,
        'Say which element a click on should show it, as a CSS selector.',
      );
    }
    if (trigger.type === 'event' && !trigger.name) {
      add(`triggers.${i}.name`, 'Name the event, as your code sends it to track.');
    }
  });
  const kinds = engagement.triggers.map((t) => JSON.stringify(t));
  kinds.forEach((kind, i) => {
    if (kinds.indexOf(kind) !== i)
      add(`triggers.${i}.type`, 'This trigger is already in the list.');
  });

  if (engagement.kind === 'banner') {
    const { until } = engagement.banner.countdown;
    if (
      until &&
      engagement.schedule.end &&
      Date.parse(until) > Date.parse(engagement.schedule.end)
    ) {
      add('banner.countdown.until', 'The banner stops showing before the countdown ends.');
    }
  }

  const { start, end } = engagement.schedule;
  if (start && end && Date.parse(end) <= Date.parse(start)) {
    add('schedule.end', 'The end has to come after the start.');
  }

  const blocks = (list: readonly Block[], path: string) =>
    checkBlocks(list, path, add, { tours, kind: engagement.kind });

  switch (engagement.kind) {
    case 'modal': {
      engagement.modal.slides.forEach((slide, i) => {
        const path = `modal.slides.${i}.blocks`;
        if (slide.blocks.length === 0) add(path, 'This slide is empty. Add a block, or remove it.');
        blocks(slide.blocks, path);
      });
      break;
    }
    case 'banner':
      if (engagement.banner.blocks.length === 0) {
        add('banner.blocks', 'A banner needs something to say.');
      }
      blocks(engagement.banner.blocks, 'banner.blocks');
      break;
    case 'hotspot':
      if (!engagement.hotspot.target) {
        add('hotspot.target', 'Say which element the beacon sits on, as a CSS selector.');
      }
      blocks(engagement.hotspot.blocks, 'hotspot.blocks');
      break;
    case 'tour': {
      const steps = engagement.tour.steps;
      if (steps.length === 0) add('tour.steps', 'A tour needs at least one step.');
      steps.forEach((step, i) => {
        const path = `tour.steps.${i}`;
        if (step.advance === 'click' && !step.target) {
          add(`${path}.target`, 'Waiting for a click needs an element to click.');
        }
        if (step.advance === 'url' && !step.url) {
          add(`${path}.url`, 'Say which page moves the tour on, e.g. /projects/**.');
        }
        if (step.blocks.length === 0) add(`${path}.blocks`, 'This step is empty.');
        blocks(step.blocks, `${path}.blocks`);
      });
      break;
    }
    case 'survey': {
      const questions = engagement.survey.questions;
      if (questions.length === 0) add('survey.questions', 'A survey needs at least one question.');
      blocks(engagement.survey.intro, 'survey.intro');
      blocks(engagement.survey.thankYou, 'survey.thankYou');
      const ids = new Map<string, number>();
      questions.forEach((question, i) => {
        if (ids.has(question.id)) {
          add(`survey.questions.${i}.id`, 'Two questions share this id.');
        } else {
          ids.set(question.id, i);
        }
      });
      questions.forEach((question, i) => {
        checkQuestion(question, `survey.questions.${i}`, i, ids, add);
      });
      break;
    }
  }
  return problems;
}

function checkQuestion(
  question: SurveyQuestion,
  path: string,
  index: number,
  ids: Map<string, number>,
  add: (path: string, message: string) => void,
): void {
  if (!question.prompt) add(`${path}.prompt`, 'Write the question.');
  const choiceKind = question.kind === 'single' || question.kind === 'multi';
  if (choiceKind && question.choices.length < 2) {
    add(`${path}.choices`, 'Give at least two choices, one per line.');
  }
  if (choiceKind && new Set(question.choices).size !== question.choices.length) {
    add(`${path}.choices`, 'Each choice has to be different.');
  }

  // A survey only ever moves forward, so it always ends.
  const reachable = (goto: string) => goto === 'end' || (ids.get(goto) ?? -1) > index;
  if (question.next && !reachable(question.next)) {
    add(`${path}.next`, 'Go to a later question, or to the end.');
  }

  const scale = SCALES[question.kind];
  question.branches.forEach((branch, b) => {
    const at = `${path}.branches.${b}`;
    if (!reachable(branch.goto)) add(`${at}.goto`, 'Go to a later question, or to the end.');
    if (choiceKind) {
      if (branch.choices.length === 0) add(`${at}.choices`, 'Pick the answers this applies to.');
      const unknown = branch.choices.filter((c) => !question.choices.includes(c));
      if (unknown.length > 0) add(`${at}.choices`, `Not one of the choices: ${unknown.join(', ')}`);
    } else if (scale) {
      const [low, high] = scale;
      const min = branch.min ?? low;
      const max = branch.max ?? high;
      if (min < low || max > high || min > max) {
        add(`${at}.min`, `Use a range between ${low} and ${high}.`);
      }
    } else {
      add(at, 'Free-text answers cannot branch. Use "then go to" instead.');
    }
  });

  if (question.followUp.enabled && !question.followUp.prompt) {
    add(`${path}.followUp.prompt`, 'Write the follow-up question.');
  }
  if (question.followUp.enabled && question.kind === 'text') {
    add(`${path}.followUp.enabled`, 'A written answer needs no follow-up.');
  } else if (question.followUp.enabled && question.followUp.when === 'detractors' && !scale) {
    // Only a score has detractors; a choice question asks everyone or no one.
    add(`${path}.followUp.when`, 'Only a score has detractors. Ask everyone instead.');
  }
}

/** Every problem in a list of blocks. Exported for forms, whose content is the same blocks. */
export function checkBlocks(
  blocks: readonly Block[],
  path: string,
  add: (path: string, message: string) => void,
  context: { tours: Set<string>; kind: Engagement['kind'] },
): void {
  blocks.forEach((block, i) => {
    const at = `${path}.${i}`;
    switch (block.type) {
      case 'text':
        if (!block.markdown.trim()) add(`${at}.markdown`, 'Write something, or remove the block.');
        break;
      case 'image':
      case 'gif':
        if (!block.url) add(`${at}.url`, 'Add the image address, or upload one.');
        else if (!isSafeMediaUrl(block.url)) {
          add(`${at}.url`, 'Use an https:// address, or a path on your site.');
        }
        if (block.type === 'image' && block.link && !isSafeLink(block.link)) {
          add(`${at}.link`, 'Use an https:// address, or a path on your site.');
        }
        break;
      case 'video':
        if (!block.url) add(`${at}.url`, 'Add the video address.');
        else if (!videoProvider(block.url)) {
          add(`${at}.url`, 'Use a YouTube, Vimeo, Loom or Wistia link, or an .mp4 or .webm file.');
        }
        break;
      case 'buttons':
        if (block.buttons.length === 0) add(at, 'Add a button, or remove the block.');
        block.buttons.forEach((button, b) => {
          const where = `${at}.buttons.${b}`;
          if (!button.label) add(`${where}.label`, 'A button needs a label.');
          if (button.action === 'url' && !isSafeLink(button.value)) {
            add(`${where}.value`, 'Use an https:// address, or a path on your site.');
          }
          if (button.action === 'tour' && !context.tours.has(button.value)) {
            add(`${where}.value`, 'Pick a tour that exists.');
          }
          if (button.action === 'article' && !button.value) {
            add(`${where}.value`, 'Give the article slug, e.g. billing/invoices.');
          }
          if (button.action === 'next' && context.kind !== 'modal' && context.kind !== 'tour') {
            add(`${where}.action`, 'Only modals and tours have a next step.');
          }
        });
        break;
      case 'divider':
        break;
    }
  });
}
