/**
 * Make whatever arrived into an engagement the renderers can trust.
 *
 * The server validates definitions before it serves them, so this is a
 * guard, not a validator: it fills defaults, drops what has the wrong type,
 * and upgrades a first-version definition (title, body, cta) the way core
 * does, so a widget talking to an older server, or the dashboard preview
 * mid-edit, still draws something sensible. It never throws; what it cannot
 * make sense of is null, and is not shown.
 */

import type {
  Block,
  ButtonAction,
  EngageButton,
  Engagement,
  Placement,
  QuestionKind,
  StepPlacement,
  SurveyQuestion,
  TourStep,
  Trigger,
} from './types.js';

type Loose = Record<string, unknown>;

const isRecord = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const PLACEMENTS: readonly Placement[] = ['auto', 'top', 'right', 'bottom', 'left'];
const STEP_PLACEMENTS: readonly StepPlacement[] = ['tour', ...PLACEMENTS];
const ACTIONS: readonly ButtonAction[] = ['url', 'dismiss', 'next', 'tour', 'chat', 'article'];
const QUESTION_KINDS: readonly QuestionKind[] = ['nps', 'csat', 'stars', 'single', 'multi', 'text'];

export function normalizeEngagement(input: unknown): Engagement | null {
  if (!isRecord(input) || typeof input.id !== 'string' || !input.id) return null;
  const base = {
    id: input.id,
    triggers: triggers(input),
    priority: num(input.priority, 0),
    dismissible: bool(input.dismissible, true),
  };

  switch (input.kind) {
    case 'modal': {
      const modal = isRecord(input.modal) ? input.modal : {};
      const slides = list(modal.slides)
        .map((slide) => ({ blocks: blocks(isRecord(slide) ? slide.blocks : []) }))
        .slice(0, 10);
      return {
        ...base,
        kind: 'modal',
        modal: {
          size: oneOf(modal.size, ['small', 'medium', 'large', 'full'] as const, 'medium'),
          mediaPosition: oneOf(modal.mediaPosition, ['top', 'side', 'background'] as const, 'top'),
          progress: oneOf(modal.progress, ['dots', 'bar', 'count'] as const, 'dots'),
          slides: slides.length > 0 ? slides : [{ blocks: legacyBlocks(input, 'heading') }],
        },
      };
    }
    case 'banner': {
      const banner = isRecord(input.banner) ? input.banner : {};
      return {
        ...base,
        kind: 'banner',
        banner: {
          position: oneOf(banner.position, ['top', 'bottom'] as const, 'top'),
          style: oneOf(banner.style, ['inline', 'floating'] as const, 'inline'),
          tone: oneOf(banner.tone, ['accent', 'neutral', 'warning', 'custom'] as const, 'accent'),
          background: str(banner.background, '#7A3BEB'),
          color: str(banner.color, '#FFFFFF'),
          sticky: bool(banner.sticky, true),
          countdown: countdown(banner.countdown),
          blocks: isRecord(input.banner) ? blocks(banner.blocks) : legacyBlocks(input, 'inline'),
        },
      };
    }
    case 'hotspot': {
      const hotspot = isRecord(input.hotspot) ? input.hotspot : null;
      return {
        ...base,
        kind: 'hotspot',
        hotspot: {
          target: str(hotspot ? hotspot.target : input.target),
          placement: oneOf(hotspot?.placement, PLACEMENTS, 'auto'),
          beacon: oneOf(hotspot?.beacon, ['pulse', 'dot', 'question'] as const, 'pulse'),
          blocks: hotspot ? blocks(hotspot.blocks) : legacyBlocks(input, 'bold'),
        },
      };
    }
    case 'tour': {
      const tour = isRecord(input.tour) ? input.tour : {};
      const missing = isRecord(tour.missingTarget) ? tour.missingTarget : {};
      return {
        ...base,
        kind: 'tour',
        tour: {
          steps: list(isRecord(input.tour) ? tour.steps : input.steps)
            .filter(isRecord)
            .map(step)
            .slice(0, 30),
          placement: oneOf(tour.placement, PLACEMENTS, 'auto'),
          spotlight: bool(tour.spotlight, true),
          showProgress: bool(tour.showProgress, true),
          allowSkip: bool(tour.allowSkip, true),
          missingTarget: {
            waitSeconds: Math.min(Math.max(num(missing.waitSeconds, 5), 0), 60),
            action: oneOf(missing.action, ['skip', 'stop'] as const, 'skip'),
          },
        },
      };
    }
    case 'survey': {
      const survey = isRecord(input.survey) ? input.survey : {};
      const questions = Array.isArray(survey.questions)
        ? survey.questions.filter(isRecord).map(question)
        : [legacyQuestion(survey)];
      return {
        ...base,
        kind: 'survey',
        survey: {
          placement: oneOf(survey.placement, ['corner', 'center', 'bar'] as const, 'corner'),
          theme: oneOf(survey.theme, ['brand', 'light', 'dark'] as const, 'brand'),
          intro: blocks(survey.intro),
          questions: questions.filter((q): q is SurveyQuestion => q !== null).slice(0, 20),
          thankYou: Array.isArray(survey.thankYou)
            ? blocks(survey.thankYou)
            : [{ type: 'text', markdown: 'Thank you.' }],
        },
      };
    }
    default:
      return null;
  }
}

/**
 * The list of triggers, from `triggers`, or the single `trigger` an older
 * server sends, or the first version's `delayMs`. Never empty.
 */
function triggers(input: Loose): Trigger[] {
  if (Array.isArray(input.triggers)) {
    const list = input.triggers.filter(isRecord).slice(0, 5).map(trigger);
    if (list.length > 0) return list;
  }
  if (isRecord(input.trigger)) return [trigger(input.trigger)];
  const delay = num(input.delayMs, 0);
  return [delay > 0 ? { type: 'delay', seconds: delay / 1000 } : { type: 'load' }];
}

/** One trigger. What it does not recognise shows on page load. */
export function trigger(raw: Loose): Trigger {
  const seconds = Math.min(Math.max(num(raw.seconds, 0), 0), 3600);
  switch (raw.type) {
    case 'delay':
    case 'time_on_page':
    case 'inactivity':
      return { type: raw.type, seconds };
    case 'scroll':
      return { type: 'scroll', percent: Math.min(Math.max(num(raw.percent, 50), 1), 100) };
    case 'exit':
    case 'manual':
      return { type: raw.type };
    case 'click':
      return { type: 'click', selector: str(raw.selector) };
    case 'event':
      return { type: 'event', name: str(raw.name) };
    default:
      return { type: 'load' };
  }
}

export function blocks(value: unknown): Block[] {
  const out: Block[] = [];
  for (const raw of list(value).slice(0, 20)) {
    if (!isRecord(raw)) continue;
    switch (raw.type) {
      case 'text':
        out.push({ type: 'text', markdown: str(raw.markdown) });
        break;
      case 'image':
        out.push({ type: 'image', url: str(raw.url), alt: str(raw.alt), link: str(raw.link) });
        break;
      case 'gif':
        out.push({ type: 'gif', url: str(raw.url), alt: str(raw.alt) });
        break;
      case 'video':
        out.push({ type: 'video', url: str(raw.url), title: str(raw.title) });
        break;
      case 'buttons':
        out.push({
          type: 'buttons',
          buttons: list(raw.buttons).filter(isRecord).slice(0, 2).map(button),
        });
        break;
      case 'divider':
        out.push({ type: 'divider' });
        break;
    }
  }
  return out;
}

/** A countdown's end, when it is a date; with none, there is no countdown. */
function countdown(value: unknown): { until: string | null; onEnd: 'hide' | 'keep' } {
  const raw = isRecord(value) ? value : {};
  const until =
    typeof raw.until === 'string' && !Number.isNaN(Date.parse(raw.until)) ? raw.until : null;
  return { until, onEnd: oneOf(raw.onEnd, ['hide', 'keep'] as const, 'hide') };
}

function button(raw: Loose): EngageButton {
  return {
    label: str(raw.label),
    // A quick reply belongs to chat messages; in an engagement it opens the chat.
    action: raw.action === 'reply' ? 'chat' : oneOf(raw.action, ACTIONS, 'url'),
    value: str(raw.value),
    style: oneOf(raw.style, ['primary', 'secondary'] as const, 'primary'),
    newTab: bool(raw.newTab, false),
  };
}

function step(raw: Loose): TourStep {
  return {
    target: str(raw.target),
    placement: oneOf(raw.placement, STEP_PLACEMENTS, 'tour'),
    page: str(raw.page),
    advance: oneOf(raw.advance, ['next', 'click', 'url'] as const, 'next'),
    url: str(raw.url),
    blocks: Array.isArray(raw.blocks) ? blocks(raw.blocks) : legacyBlocks(raw, 'bold'),
  };
}

function question(raw: Loose): SurveyQuestion | null {
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const followUp = isRecord(raw.followUp) ? raw.followUp : {};
  return {
    id: raw.id,
    kind: oneOf(raw.kind, QUESTION_KINDS, 'nps'),
    prompt: str(raw.prompt),
    choices: list(raw.choices).filter((c): c is string => typeof c === 'string'),
    required: bool(raw.required, true),
    placeholder: str(raw.placeholder),
    lowLabel: str(raw.lowLabel),
    highLabel: str(raw.highLabel),
    followUp: {
      enabled: bool(followUp.enabled, false),
      prompt: str(followUp.prompt, 'What made you choose that?'),
      when: oneOf(followUp.when, ['detractors', 'always'] as const, 'detractors'),
    },
    branches: list(raw.branches)
      .filter(isRecord)
      .map((b) => ({
        choices: list(b.choices).filter((c): c is string => typeof c === 'string'),
        min: typeof b.min === 'number' ? b.min : null,
        max: typeof b.max === 'number' ? b.max : null,
        goto: str(b.goto, 'end'),
      })),
    next: str(raw.next),
  };
}

/** The first version's one question. */
function legacyQuestion(survey: Loose): SurveyQuestion {
  const followUp = str(survey.followUp);
  return {
    id: 'q1',
    kind: oneOf(survey.type, ['nps', 'csat', 'single'] as const, 'nps'),
    prompt: str(survey.question, 'How are we doing?'),
    choices: list(survey.choices).filter((c): c is string => typeof c === 'string'),
    required: true,
    placeholder: '',
    lowLabel: '',
    highLabel: '',
    followUp: { enabled: Boolean(followUp), prompt: followUp, when: 'always' },
    branches: [],
    next: '',
  };
}

/** `title`, `body` and `cta`, as core's upgrade turns them into blocks. */
function legacyBlocks(raw: Loose, style: 'heading' | 'inline' | 'bold'): Block[] {
  const title = str(raw.title).trim();
  const body = str(raw.body).trim();
  const out: Block[] = [];
  const parts = [title ? (style === 'heading' ? `## ${title}` : `**${title}**`) : '', body].filter(
    Boolean,
  );
  if (parts.length > 0) {
    out.push({ type: 'text', markdown: parts.join(style === 'inline' ? ' ' : '\n\n') });
  }
  const cta = isRecord(raw.cta) ? raw.cta : null;
  const label = str(cta?.label).trim();
  if (label) {
    const url = str(cta?.url);
    const action: Pick<EngageButton, 'action' | 'value'> = url.startsWith('helpwell:open')
      ? { action: 'chat', value: '' }
      : url.startsWith('helpwell:article/')
        ? { action: 'article', value: url.slice('helpwell:article/'.length) }
        : { action: 'url', value: url };
    out.push({
      type: 'buttons',
      buttons: [{ label, ...action, style: 'primary', newTab: true }],
    });
  }
  return out;
}
