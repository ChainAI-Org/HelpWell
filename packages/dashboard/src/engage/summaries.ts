/**
 * The "Who sees it, and when" column in words: one plain sentence each for
 * the audience, the trigger, the frequency and the goal, so an engagement's
 * rules can be read without opening a single control.
 *
 * The same sentences come back with every preview draft, so they follow the
 * controls as they change.
 */

import { type Engagement, isEventCondition, isGroup } from '@helpwell/core/repos';
import { formatDate } from '../components.js';

export interface Summaries {
  audience: string;
  trigger: string;
  frequency: string;
  goal: string;
  /** Where and when together, for the line under the preview. */
  moment: string;
}

const AUDIENCE: Record<Engagement['targeting']['audience'], string> = {
  all: 'Everyone',
  identified: 'Signed-in people',
  anonymous: 'Anonymous visitors',
};

export function summaries(
  e: Engagement,
  options: { segmentName?: string | null; locale?: string; timeZone?: string } = {},
): Summaries {
  const where = pagesText(e);
  return {
    audience: audienceText(e, where, options.segmentName ?? null),
    trigger: triggerText(e),
    frequency: frequencyText(e, options),
    goal: goalText(e),
    moment: `${capitalise(triggerText(e))}${where ? `, ${where}` : ''}`,
  };
}

function audienceText(e: Engagement, where: string, segmentName: string | null): string {
  const t = e.targeting;
  const parts = [AUDIENCE[t.audience]];
  if (t.segmentId)
    parts.push(`in ${segmentName ? `“${segmentName}”` : 'a segment that no longer exists'}`);
  if (t.conditions) {
    const leaves = countLeaves(t.conditions);
    parts.push(`matching ${leaves === 1 ? 'one condition' : `${leaves} conditions`}`);
  }
  let text = parts.join(' ');
  if (where) text += ` ${where}`;
  if (t.devices.length === 1) text += `, on ${t.devices[0] === 'mobile' ? 'phones' : 'desktop'}`;
  if (t.devices.length === 0) text += ', on no device';
  if (t.referrer.include.length > 0) text += `, from ${list(t.referrer.include)}`;
  const campaigns = [...t.utm.source, ...t.utm.campaign];
  if (campaigns.length > 0) text += `, from ${list(campaigns)}`;
  if (t.languages.length > 0) text += `, in ${list(t.languages)}`;
  return text;
}

function pagesText(e: Engagement): string {
  const { include, exclude } = e.targeting.pages;
  const everywhere = include.length === 0 || include.includes('**');
  let text = everywhere ? '' : `on ${list(include)}`;
  if (exclude.length > 0) text += `${text ? ' ' : ''}except ${list(exclude)}`;
  return text;
}

/** Each trigger in words, "or" between them: whichever happens first. */
function triggerText(e: Engagement): string {
  const said = e.triggers.map(oneTrigger);
  return said.length > 2 ? `${said.slice(0, -1).join(', ')} or ${said.at(-1)}` : said.join(', or ');
}

function oneTrigger(t: Engagement['triggers'][number]): string {
  switch (t.type) {
    case 'load':
      return 'as the page loads';
    case 'delay':
      return `${seconds(t.seconds)} after the page loads`;
    case 'scroll':
      return `at ${t.percent}% scroll`;
    case 'exit':
      return 'when they go to leave, on desktop';
    case 'time_on_page':
      return `after ${seconds(t.seconds)} on the page`;
    case 'inactivity':
      return `after ${seconds(t.seconds)} with nothing done`;
    case 'click':
      return t.selector
        ? `when ${t.selector} is clicked`
        : 'when an element is clicked (not set yet)';
    case 'event':
      return t.name
        ? `when your app tracks ${t.name}`
        : 'when your app tracks an event (not named yet)';
    case 'manual':
      return 'only when your code shows it';
  }
}

function frequencyText(e: Engagement, options: { locale?: string; timeZone?: string }): string {
  const f = e.frequency;
  let text =
    f === 'once'
      ? 'Once per person'
      : f === 'always'
        ? 'Every time the rules match'
        : `Again every ${f.everyDays} ${f.everyDays === 1 ? 'day' : 'days'}`;
  text += '. Stops once they close or finish it';
  const date = (iso: string) => formatDate(iso, options);
  const { start, end } = e.schedule;
  if (start && end) text += `. ${date(start)} to ${date(end)}`;
  else if (start) text += `. From ${date(start)}`;
  else if (end) text += `. Until ${date(end)}`;
  if (e.priority > 0) text += `. Priority ${e.priority}`;
  return `${text}.`;
}

function goalText(e: Engagement): string {
  switch (e.kind) {
    case 'tour':
      return 'Finished the tour.';
    case 'survey':
      return 'Finished the survey. Partial answers are saved too.';
    case 'hotspot':
      return 'Opened the beacon, or clicked a button in it.';
    default:
      return 'Clicked its button.';
  }
}

function countLeaves(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const group = node as { all?: unknown[]; any?: unknown[] };
  if (isGroup(node as never)) {
    return [...(group.all ?? []), ...(group.any ?? [])].reduce<number>(
      (sum, child) => sum + countLeaves(child),
      0,
    );
  }
  return isEventCondition(node as never) || 'field' in (node as object) ? 1 : 0;
}

function list(items: readonly string[]): string {
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

function seconds(value: number): string {
  if (value % 60 === 0 && value >= 60) {
    const minutes = value / 60;
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  return `${value} ${value === 1 ? 'second' : 'seconds'}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
