/**
 * The engage pieces that stand on their own: the definition guard (and its
 * upgrade of first-version definitions), every trigger on fake timers,
 * survey branching, tooltip placement, and the dashboard preview receiving
 * a draft.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeEngagement } from '../src/engage/normalize.js';
import { fillText, tokenize, untoken } from '../src/engage/personalize.js';
import { placePopover } from '../src/engage/position.js';
import { listenForDrafts, mountPreview, PREVIEW_MESSAGE } from '../src/engage/preview.js';
import { nextQuestion, wantsFollowUp } from '../src/engage/survey-flow.js';
import { armTrigger, EventHub } from '../src/engage/triggers.js';
import type { SurveyQuestion, Trigger } from '../src/engage/types.js';
import { flush } from './helpers/server.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.textContent = '';
});

/* ------------------------------------------------------------ conversion */

describe('normalizeEngagement', () => {
  it('upgrades a first-version modal into one slide of blocks', () => {
    const modal = normalizeEngagement({
      id: 'launch',
      kind: 'modal',
      title: 'Faster exports',
      body: 'Half the time.',
      cta: { label: 'Show me', url: 'helpwell:article/billing/invoices' },
      delayMs: 2000,
    });
    expect(modal).toMatchObject({
      kind: 'modal',
      triggers: [{ type: 'delay', seconds: 2 }],
      modal: {
        slides: [
          {
            blocks: [
              { type: 'text', markdown: '## Faster exports\n\nHalf the time.' },
              {
                type: 'buttons',
                buttons: [{ label: 'Show me', action: 'article', value: 'billing/invoices' }],
              },
            ],
          },
        ],
      },
    });
  });

  it('upgrades a first-version tour, hotspot and survey', () => {
    expect(
      normalizeEngagement({ id: 't', kind: 'tour', steps: [{ target: '#a', title: 'A' }] }),
    ).toMatchObject({ tour: { steps: [{ target: '#a', blocks: [{ markdown: '**A**' }] }] } });
    expect(
      normalizeEngagement({ id: 'h', kind: 'hotspot', target: '#x', body: 'Hi' }),
    ).toMatchObject({
      hotspot: { target: '#x', blocks: [{ markdown: 'Hi' }] },
    });
    expect(
      normalizeEngagement({ id: 's', kind: 'survey', survey: { type: 'csat', question: 'OK?' } }),
    ).toMatchObject({ survey: { questions: [{ id: 'q1', kind: 'csat', prompt: 'OK?' }] } });
  });

  it('fills the look options, and lets a tour step follow the tour', () => {
    expect(
      normalizeEngagement({
        id: 't',
        kind: 'tour',
        tour: { steps: [{ target: '#a' }, { placement: 'up' }] },
      }),
    ).toMatchObject({
      tour: { placement: 'auto', steps: [{ placement: 'tour' }, { placement: 'tour' }] },
    });
    expect(
      normalizeEngagement({ id: 'm', kind: 'modal', modal: { progress: 'pie' } }),
    ).toMatchObject({
      modal: { progress: 'dots' },
    });
    expect(
      normalizeEngagement({ id: 'h', kind: 'hotspot', hotspot: { beacon: 'question' } }),
    ).toMatchObject({
      hotspot: { beacon: 'question' },
    });
    expect(
      normalizeEngagement({ id: 's', kind: 'survey', survey: { placement: 'bar', questions: [] } }),
    ).toMatchObject({ survey: { placement: 'bar', theme: 'brand' } });
  });

  it('drops what it cannot make sense of', () => {
    expect(normalizeEngagement(null)).toBeNull();
    expect(normalizeEngagement({ id: 'x', kind: 'popup' })).toBeNull();
    expect(normalizeEngagement({ kind: 'modal' })).toBeNull();
    const banner = normalizeEngagement({
      id: 'b',
      kind: 'banner',
      banner: { blocks: [{ type: 'script' }, { type: 'divider' }], tone: 'loud' },
    });
    expect(banner).toMatchObject({ banner: { tone: 'accent', blocks: [{ type: 'divider' }] } });
  });
});

/* -------------------------------------------------------------- triggers */

describe('armTrigger', () => {
  const arm = (trigger: Trigger, events = new EventHub(), isDesktop = () => true) => {
    const fire = vi.fn();
    const disarm = armTrigger(trigger, fire, { events, isDesktop });
    return { fire, disarm };
  };

  it('fires on load on the next tick, and after a delay', () => {
    vi.useFakeTimers();
    const load = arm({ type: 'load' });
    expect(load.fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(load.fire).toHaveBeenCalledTimes(1);

    const delay = arm({ type: 'delay', seconds: 5 });
    vi.advanceTimersByTime(4999);
    expect(delay.fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(delay.fire).toHaveBeenCalledTimes(1);
  });

  it('fires at a scroll depth', () => {
    vi.useFakeTimers();
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 4000,
    });
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    let y = 0;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
    const { fire } = arm({ type: 'scroll', percent: 80 });
    vi.advanceTimersByTime(0);
    expect(fire).not.toHaveBeenCalled();
    y = 1500;
    window.dispatchEvent(new Event('scroll'));
    expect(fire).not.toHaveBeenCalled();
    y = 2300;
    window.dispatchEvent(new Event('scroll'));
    expect(fire).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(document.documentElement, 'scrollHeight');
  });

  it('fires on exit intent on a desktop, and never on a touch screen', () => {
    const desktop = arm({ type: 'exit' });
    const phone = arm({ type: 'exit' }, new EventHub(), () => false);
    document.dispatchEvent(new MouseEvent('mouseout', { clientY: 200, relatedTarget: null }));
    expect(desktop.fire).not.toHaveBeenCalled();
    document.dispatchEvent(new MouseEvent('mouseout', { clientY: 0, relatedTarget: null }));
    expect(desktop.fire).toHaveBeenCalledTimes(1);
    expect(phone.fire).not.toHaveBeenCalled();
  });

  it('counts only visible time on the page', () => {
    vi.useFakeTimers();
    let state: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    const { fire } = arm({ type: 'time_on_page', seconds: 10 });
    vi.advanceTimersByTime(6000);
    state = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(60_000);
    expect(fire).not.toHaveBeenCalled();
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(3999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('fires after inactivity, and any activity starts the wait again', () => {
    vi.useFakeTimers();
    const { fire } = arm({ type: 'inactivity', seconds: 30 });
    vi.advanceTimersByTime(20_000);
    window.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(20_000);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('fires on a click on a matching element, and survives a bad selector', () => {
    const button = document.createElement('button');
    button.className = 'upgrade';
    document.body.appendChild(button);
    const good = arm({ type: 'click', selector: '.upgrade' });
    const bad = arm({ type: 'click', selector: '::nonsense((' });
    document.body.click();
    expect(good.fire).not.toHaveBeenCalled();
    button.click();
    expect(good.fire).toHaveBeenCalledTimes(1);
    expect(bad.fire).not.toHaveBeenCalled();
  });

  it('fires on a tracked event, once, and never for manual', () => {
    vi.useFakeTimers();
    const events = new EventHub();
    const tracked = arm({ type: 'event', name: 'exported_csv' }, events);
    const manual = arm({ type: 'manual' }, events);
    events.emit('something_else');
    events.emit('exported_csv');
    events.emit('exported_csv');
    vi.advanceTimersByTime(3_600_000);
    expect(tracked.fire).toHaveBeenCalledTimes(1);
    expect(manual.fire).not.toHaveBeenCalled();
  });

  it('takes everything back off when disarmed', () => {
    vi.useFakeTimers();
    const events = new EventHub();
    const armed = [
      arm({ type: 'delay', seconds: 1 }, events),
      arm({ type: 'event', name: 'x' }, events),
      arm({ type: 'inactivity', seconds: 1 }, events),
    ];
    for (const { disarm } of armed) disarm();
    events.emit('x');
    vi.advanceTimersByTime(10_000);
    for (const { fire } of armed) expect(fire).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------- branching */

function question(patch: Partial<SurveyQuestion>): SurveyQuestion {
  return {
    id: 'q',
    kind: 'nps',
    prompt: '?',
    choices: [],
    required: true,
    placeholder: '',
    lowLabel: '',
    highLabel: '',
    followUp: { enabled: false, prompt: '', when: 'detractors' },
    branches: [],
    next: '',
    ...patch,
  };
}

describe('survey branching', () => {
  const questions = [
    question({
      id: 'score',
      branches: [
        { choices: [], min: 0, max: 6, goto: 'why' },
        { choices: [], min: 9, max: null, goto: 'end' },
      ],
    }),
    question({ id: 'passive', kind: 'text' }),
    question({
      id: 'why',
      kind: 'single',
      choices: ['Price', 'Speed'],
      branches: [{ choices: ['Price'], min: null, max: null, goto: 'plans' }],
      next: 'end',
    }),
    question({ id: 'plans', kind: 'text' }),
  ];

  it('goes where the first matching branch says, else next, else in order', () => {
    expect(nextQuestion(questions, 0, { score: 3 })).toBe(2);
    expect(nextQuestion(questions, 0, { score: 10 })).toBe('end');
    expect(nextQuestion(questions, 0, { score: 8 })).toBe(1);
    expect(nextQuestion(questions, 2, { choice: 'Price' })).toBe(3);
    expect(nextQuestion(questions, 2, { choice: 'Speed' })).toBe('end');
    expect(nextQuestion(questions, 3, { comment: 'x' })).toBe('end');
  });

  it('only follows `next` for a skipped question, and never goes backwards', () => {
    expect(nextQuestion(questions, 0, null)).toBe(1);
    const loop = [question({ id: 'a' }), question({ id: 'b', next: 'a' })];
    expect(nextQuestion(loop, 1, { score: 5 })).toBe('end');
  });

  it('asks the follow-up of detractors only, unless told to ask everyone', () => {
    const detractors = question({
      followUp: { enabled: true, prompt: 'Why?', when: 'detractors' },
    });
    expect(wantsFollowUp(detractors, { score: 6 })).toBe(true);
    expect(wantsFollowUp(detractors, { score: 7 })).toBe(false);
    const csat = question({
      kind: 'csat',
      followUp: { enabled: true, prompt: '', when: 'detractors' },
    });
    expect(wantsFollowUp(csat, { score: 2 })).toBe(true);
    expect(wantsFollowUp(csat, { score: 3 })).toBe(false);
    const always = question({ followUp: { enabled: true, prompt: '', when: 'always' } });
    expect(wantsFollowUp(always, { score: 10 })).toBe(true);
  });
});

/* ------------------------------------------------------------- placement */

describe('placePopover', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 300, height: 150 };

  it('prefers below, then above, then the sides', () => {
    expect(
      placePopover({ top: 100, left: 400, width: 100, height: 40 }, size, 'auto', viewport),
    ).toEqual({
      top: 152,
      left: 300,
      side: 'bottom',
    });
    expect(
      placePopover({ top: 700, left: 400, width: 100, height: 40 }, size, 'auto', viewport).side,
    ).toBe('top');
  });

  it('keeps the chosen side, clamped inside the viewport', () => {
    const spot = placePopover(
      { top: 10, left: 950, width: 40, height: 40 },
      size,
      'right',
      viewport,
    );
    expect(spot.side).toBe('right');
    expect(spot.left).toBe(1000 - 300 - 8);
    expect(spot.top).toBe(8);
  });
});

/* --------------------------------------------------------------- preview */

describe('the dashboard preview', () => {
  it('draws a draft it is sent by its parent window, and ignores anyone else', async () => {
    const controller = mountPreview();
    const stop = listenForDrafts(controller);
    const draft = {
      id: 'draft',
      kind: 'modal',
      modal: { slides: [{ blocks: [{ type: 'text', markdown: 'Previewed' }] }] },
    };

    // Another origin: ignored.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: PREVIEW_MESSAGE, definition: draft },
        origin: 'https://evil.example',
        source: window,
      }),
    );
    await flush(10);
    const root = () => document.querySelector('helpwell-engage')?.shadowRoot;
    expect(root()?.querySelector('.modal')).toBeNull();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: PREVIEW_MESSAGE, definition: draft, accent: '#0F9D7A' },
        origin: location.origin,
        source: window,
      }),
    );
    await flush(10);
    expect(root()?.querySelector('.eg-text')?.textContent).toContain('Previewed');

    // The next draft replaces it, and a hotspot with no element on the page
    // points at the stand-in instead.
    const standIn = document.createElement('div');
    standIn.setAttribute('data-helpwell-stand-in', '');
    document.body.appendChild(standIn);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: PREVIEW_MESSAGE,
          definition: { id: 'd', kind: 'hotspot', hotspot: { target: '#nav', blocks: [] } },
        },
        origin: location.origin,
        source: window,
      }),
    );
    await flush(10);
    expect(root()?.querySelector('.modal')).toBeNull();
    expect(root()?.querySelector('.hotspot')).toBeTruthy();
    expect(standIn.dataset.selector).toBe('#nav');

    stop();
    controller.destroy();
  });

  it('reports what a button would do instead of doing it', async () => {
    const actions: string[] = [];
    const controller = mountPreview({ onAction: (text) => actions.push(text) });
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    controller.render({
      id: 'draft',
      kind: 'modal',
      modal: {
        slides: [
          {
            blocks: [
              { type: 'text', markdown: 'Hi' },
              {
                type: 'buttons',
                buttons: [{ label: 'Pricing', action: 'url', value: '/pricing' }],
              },
            ],
          },
        ],
      },
    });
    await flush(10);
    const button = document
      .querySelector('helpwell-engage')
      ?.shadowRoot?.querySelector<HTMLButtonElement>('.engage-primary');
    button?.click();
    expect(actions).toEqual(['Opens /pricing']);
    expect(assign).not.toHaveBeenCalled();
    controller.destroy();
  });
});

describe('the preview, at the slide being edited', () => {
  it('opens a modal on the chosen slide, counting empty ones as the editor does', async () => {
    const controller = mountPreview();
    const slides = [
      { blocks: [{ type: 'text', markdown: 'One' }] },
      { blocks: [] },
      { blocks: [{ type: 'text', markdown: 'Three' }] },
      { blocks: [{ type: 'text', markdown: 'Four' }] },
    ];
    const visible = () =>
      [
        ...(document
          .querySelector('helpwell-engage')
          ?.shadowRoot?.querySelectorAll<HTMLElement>('.modal__slide') ?? []),
      ]
        .filter((s) => !s.hidden)
        .map((s) => s.textContent?.trim());
    controller.render({ id: 'd', kind: 'modal', modal: { slides } }, { startAt: 2 });
    await flush(10);
    expect(visible()).toEqual(['Three']);
    controller.render({ id: 'd', kind: 'modal', modal: { slides } }, { startAt: 99 });
    await flush(10);
    expect(visible()).toEqual(['Four']);
    controller.destroy();
  });

  it('fills placeholders with the sample values it is sent', async () => {
    const controller = mountPreview();
    controller.render(
      {
        id: 'd',
        kind: 'modal',
        modal: { slides: [{ blocks: [{ type: 'text', markdown: 'Hi {{first_name|there}}' }] }] },
      },
      { fields: { first_name: 'Jane' } },
    );
    await flush(10);
    const root = document.querySelector('helpwell-engage')?.shadowRoot;
    expect(root?.querySelector('.eg-text')?.textContent?.trim()).toBe('Hi Jane');
    controller.destroy();
  });
});

describe('placeholders', () => {
  it('fills text with the value, the fallback, or nothing', () => {
    expect(fillText('Hi {{first_name|there}}!', { first_name: 'Ada' })).toBe('Hi Ada!');
    expect(fillText('Hi {{ first_name | there }}!', {})).toBe('Hi there!');
    expect(fillText('Hi {{first_name}}!', {})).toBe('Hi !');
    expect(fillText('No placeholders', { a: 'b' })).toBe('No placeholders');
  });

  it('swaps Markdown placeholders for markers, and markers back for the values', () => {
    const { markdown, values } = tokenize('**{{name|you}}** and {{plan}}', { name: '*x*' });
    expect(markdown).not.toContain('{{');
    expect(markdown).not.toContain('*x*');
    expect(values).toEqual(['*x*', '']);
    expect(untoken(markdown, values)).toBe('***x*** and ');
  });
});
