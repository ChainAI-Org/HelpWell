/**
 * Engagements render into their own shadow root, over the host page, so these
 * tests put real elements on the page for them to point at. The fake server
 * answers `GET /engage` with definitions in the shape core serves, and every
 * claim (`POST /engage/:id/show`) with a yes unless a test says otherwise.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Block, Engagement } from '../src/engage/types.js';
import { boot } from '../src/index.js';
import { Widget } from '../src/widget.js';
import { createFakeServer, type FakeServer, flush } from './helpers/server.js';

let server: FakeServer;
let widget: Widget;

const text = (markdown: string): Block => ({ type: 'text', markdown });
const buttons = (...list: { label: string; action: string; value?: string }[]): Block => ({
  type: 'buttons',
  buttons: list.map((b) => ({
    label: b.label,
    action: b.action as 'url',
    value: b.value ?? '',
    style: 'primary',
    newTab: false,
  })),
});

const base = {
  id: 'eng_1',
  triggers: [{ type: 'load' as const }],
  priority: 0,
  dismissible: true,
};

function modal(slides: Block[][], patch: Record<string, unknown> = {}): Engagement {
  return {
    ...base,
    kind: 'modal',
    modal: {
      size: 'medium',
      mediaPosition: 'top',
      progress: 'dots',
      slides: slides.map((blocks) => ({ blocks })),
    },
    ...patch,
  } as Engagement;
}

function banner(blocks: Block[], patch: Record<string, unknown> = {}): Engagement {
  return {
    ...base,
    kind: 'banner',
    banner: {
      position: 'top',
      style: 'inline',
      tone: 'accent',
      background: '#7A3BEB',
      color: '#FFFFFF',
      sticky: true,
      countdown: { until: null, onEnd: 'hide' },
      blocks,
      ...patch,
    },
  } as Engagement;
}

function hotspot(target: string, blocks: Block[] = [text('Try it.')]): Engagement {
  return {
    ...base,
    kind: 'hotspot',
    hotspot: { target, placement: 'auto', beacon: 'pulse', blocks },
  } as Engagement;
}

function tour(
  steps: Partial<{
    target: string;
    placement: string;
    advance: string;
    url: string;
    page: string;
  }>[],
  patch: Record<string, unknown> = {},
): Engagement {
  return {
    ...base,
    id: 'tour_1',
    kind: 'tour',
    tour: {
      steps: steps.map((s, i) => ({
        target: '',
        placement: 'bottom',
        page: '',
        advance: 'next',
        url: '',
        blocks: [text(`Step ${i + 1}`)],
        ...s,
      })),
      placement: 'auto',
      spotlight: true,
      showProgress: true,
      allowSkip: true,
      missingTarget: { waitSeconds: 0, action: 'skip' },
      ...patch,
    },
  } as Engagement;
}

const nps = {
  id: 'score',
  kind: 'nps',
  prompt: 'How likely are you to recommend us?',
  choices: [],
  required: true,
  placeholder: '',
  lowLabel: '',
  highLabel: '',
  followUp: { enabled: true, prompt: 'What went wrong?', when: 'detractors' },
  branches: [{ choices: [], min: 0, max: 6, goto: 'why' }],
  next: 'end',
};
const why = {
  ...nps,
  id: 'why',
  kind: 'multi',
  prompt: 'What should we fix?',
  choices: ['Price', 'Speed', 'Docs'],
  followUp: { enabled: false, prompt: '', when: 'detractors' },
  branches: [],
  next: '',
};

function survey(
  questions: unknown[] = [nps, why],
  patch: Record<string, unknown> = {},
): Engagement {
  return {
    ...base,
    id: 'eng_s',
    kind: 'survey',
    survey: {
      placement: 'corner',
      theme: 'brand',
      intro: [],
      questions,
      thankYou: [text('Thank you.')],
      ...patch,
    },
  } as Engagement;
}

async function mountWith(...items: Engagement[]): Promise<void> {
  server = createFakeServer({ routes: { 'GET /engage': { items } } });
  widget = new Widget({ apiUrl: '/api/helpwell', fetch: server.fetch });
  await widget.mount();
  await flush(20);
}

function layer(): ShadowRoot {
  const host = document.querySelector('helpwell-engage');
  if (!host?.shadowRoot) throw new Error('no engage layer');
  return host.shadowRoot;
}

const $ = (selector: string): HTMLElement | null => layer().querySelector(selector);
const $$ = (selector: string): HTMLElement[] => [
  ...layer().querySelectorAll<HTMLElement>(selector),
];
const byText = (selector: string, label: string): HTMLElement => {
  const el = $$(selector).find((b) => b.textContent?.trim() === label);
  if (!el) throw new Error(`no ${selector} saying ${label}`);
  return el;
};

/** What was recorded for an engagement, in order, claims included as `show`. */
function records(id = 'eng_1'): [string, number | undefined][] {
  return server.calls
    .filter((c) => c.path === `/engage/${id}/impression` || c.path === `/engage/${id}/show`)
    .map((c) => {
      const body = c.body as { state?: string; step?: number };
      return [body.state ?? 'show', body.step];
    });
}

function placeAt(el: HTMLElement, top: number, left: number, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({
      top,
      left,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON() {},
    }) as DOMRect;
}

function target(id: string): HTMLElement {
  const el = document.createElement('button');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

beforeAll(() => {
  // A video player is an iframe; happy-dom would otherwise go and fetch it.
  const settings = (window as unknown as { happyDOM?: { settings: Record<string, unknown> } })
    .happyDOM?.settings;
  if (settings) settings.disableIframePageLoading = true;
});

afterEach(() => {
  widget?.destroy();
  document.body.textContent = '';
  localStorage.clear();
  sessionStorage.clear();
  window.scrollTo(0, 0);
  history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------ the request */

describe('asking what to show', () => {
  it('sends the visit, claims before drawing, and draws nothing the server refuses', async () => {
    server = createFakeServer({
      routes: {
        'GET /engage': { items: [modal([[text('Hello')]])] },
        'POST /engage/eng_1/show': { shown: false, reason: 'limit' },
      },
    });
    widget = new Widget({ apiUrl: '/api/helpwell', fetch: server.fetch });
    await widget.mount();
    await flush(20);

    const ask = server.calls.find((c) => c.path.startsWith('/engage?'));
    const params = new URLSearchParams(ask?.path.split('?')[1]);
    expect(params.get('path')).toBe('/');
    expect(params.get('device')).toBe('desktop');
    expect(server.calls.find((c) => c.path === '/engage/eng_1/show')?.body).toMatchObject({
      manual: false,
      url: '/',
    });
    expect($('.modal')).toBeNull();
  });
});

/* ----------------------------------------------------------------- modals */

describe('modals', () => {
  it('draws blocks: text, an image and a call to action', async () => {
    await mountWith(
      modal([
        [
          {
            type: 'image',
            url: 'https://cdn.example.com/launch.png',
            alt: 'The new editor',
            link: '',
          },
          text('## Faster exports\n\nHalf the time.'),
          buttons({ label: 'Show me', action: 'url', value: '/exports' }),
        ],
      ]),
    );
    expect($('.modal')?.getAttribute('aria-label')).toBe('Faster exports');
    expect($('.modal__media img')?.getAttribute('src')).toBe('https://cdn.example.com/launch.png');
    expect($('.eg-text h2')?.textContent).toContain('Faster exports');

    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    byText('.engage-primary', 'Show me').click();
    expect(assign).toHaveBeenCalledWith('/exports');
    expect(records()).toEqual([
      ['show', undefined],
      ['clicked', undefined],
    ]);
  });

  it('leaves out an image it will not load', async () => {
    await mountWith(
      modal([[{ type: 'image', url: 'javascript:alert(1)', alt: '', link: '' }, text('Hi')]]),
    );
    expect($('img')).toBeNull();
    expect($('.eg-text')?.textContent).toContain('Hi');
  });

  it('is a carousel when it has slides: dots, next, back, arrows, and Done at the end', async () => {
    await mountWith(modal([[text('One')], [text('Two')], [text('Three')]]));
    const visible = () => $$('.modal__slide').findIndex((s) => !s.hidden);
    const dots = $$('.modal__dot');
    expect(dots).toHaveLength(3);
    expect(visible()).toBe(0);
    expect(byText('.engage-ghost', 'Back').hidden).toBe(true);

    byText('.engage-primary', 'Next').click();
    expect(visible()).toBe(1);
    expect(dots[1]?.getAttribute('aria-current')).toBe('true');

    byText('.engage-ghost', 'Back').click();
    expect(visible()).toBe(0);

    dots[2]!.click();
    expect(visible()).toBe(2);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(visible()).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(visible()).toBe(2);

    byText('.engage-primary', 'Done').click();
    expect(records()).toEqual([
      ['show', undefined],
      ['completed', undefined],
    ]);
    expect($('.scrim')?.classList.contains('is-leaving')).toBe(true);
  });

  it('counts slides as "2 of 3", or fills a bar, in place of the dots', async () => {
    const slides = [[text('One')], [text('Two')], [text('Three')]];
    const counted = modal(slides) as Extract<Engagement, { kind: 'modal' }>;
    await mountWith({ ...counted, modal: { ...counted.modal, progress: 'count' } });
    expect($('.modal__dot')).toBeNull();
    expect($('.modal__bar')).toBeNull();
    expect($('.modal__count')?.textContent).toBe('1 of 3');
    byText('.engage-primary', 'Next').click();
    expect($('.modal__count')?.textContent).toBe('2 of 3');

    widget.destroy();
    await mountWith({ ...counted, modal: { ...counted.modal, progress: 'bar' } });
    expect($('.modal__dot')).toBeNull();
    expect($('.modal__bar')?.getAttribute('aria-valuenow')).toBe('1');
    byText('.engage-primary', 'Next').click();
    expect($('.modal__bar')?.getAttribute('aria-valuenow')).toBe('2');
    expect($('.modal__fill')?.style.width).toContain('66.6');
  });

  it('uses the last slide’s own buttons as its call to action, and a next button moves on', async () => {
    await mountWith(
      modal([
        [text('One'), buttons({ label: 'Tell me more', action: 'next' })],
        [text('Two'), buttons({ label: 'Open chat', action: 'chat' })],
      ]),
    );
    byText('.engage-primary', 'Tell me more').click();
    expect($$('.modal__slide')[1]?.hidden).toBe(false);
    // Next gives way to the slide's own button on the last slide.
    expect($$('.modal__nav .engage-primary')[0]?.hidden).toBe(true);

    const open = vi.spyOn(widget, 'open');
    byText('.engage-primary', 'Open chat').click();
    expect(open).toHaveBeenCalledWith({ name: 'chat', conversationId: null });
    expect(records()).toEqual([
      ['show', undefined],
      ['clicked', undefined],
    ]);
  });

  it('takes focus, keeps Tab inside, and closes on Escape when dismissible', async () => {
    await mountWith(modal([[text('Hi'), buttons({ label: 'Go', action: 'url', value: '/' })]]));
    const card = $('.modal')!;
    expect(card.getAttribute('aria-modal')).toBe('true');
    const buttonsInside = $$('.modal button');
    expect(layer().activeElement).toBe(buttonsInside[0]);

    buttonsInside[buttonsInside.length - 1]!.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(layer().activeElement).toBe(buttonsInside[0]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(records()).toEqual([
      ['show', undefined],
      ['dismissed', undefined],
    ]);
  });

  it('stays put when it is not dismissible and has a button, and can always close without one', async () => {
    await mountWith(
      modal([[text('Hi'), buttons({ label: 'Continue', action: 'url', value: '' })]], {
        dismissible: false,
      }),
    );
    expect($('.engage-close')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect($('.scrim')?.classList.contains('is-leaving')).toBe(false);
    widget.destroy();
    document.body.textContent = '';

    await mountWith(modal([[text('Nothing to press')]], { dismissible: false }));
    expect($('.engage-close')).toBeTruthy();
  });
});

/* ---------------------------------------------------------------- banners */

describe('banners', () => {
  it('pushes the page with a spacer when inline, and takes it away on dismissal', async () => {
    await mountWith(
      banner([
        text('**New** Dark mode.'),
        buttons({ label: 'See it', action: 'url', value: '/new' }),
      ]),
    );
    expect($('.banner')?.className).toContain('banner--top banner--inline banner--accent');
    expect(document.querySelector('[data-helpwell-banner-spacer]')).toBeTruthy();

    $('.banner__close')!.click();
    expect(document.querySelector('[data-helpwell-banner-spacer]')).toBeNull();
    expect(records()).toEqual([
      ['show', undefined],
      ['dismissed', undefined],
    ]);
  });

  it('floats at the bottom in custom colours, but only hex ones', async () => {
    await mountWith(
      banner([text('Maintenance tonight')], {
        position: 'bottom',
        style: 'floating',
        tone: 'custom',
        background: '#102030',
        color: 'red;}',
      }),
    );
    const bar = $('.banner')!;
    expect(bar.className).toContain('banner--bottom banner--floating banner--custom');
    expect(bar.style.getPropertyValue('--banner-bg')).toBe('#102030');
    expect(bar.style.getPropertyValue('--banner-ink')).toBe('#FFFFFF');
    expect(document.querySelector('[data-helpwell-banner-spacer]')).toBeNull();
  });

  it('opens a video over the page rather than squeezing a player into the strip', async () => {
    await mountWith(
      banner([
        text('Watch the launch'),
        { type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Launch' },
      ]),
    );
    expect($('iframe')).toBeNull();
    $('.eg-watch')!.click();
    expect($('.lightbox--video iframe')?.getAttribute('src')).toContain(
      'youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
  });
});

/* --------------------------------------------------------------- hotspots */

describe('hotspots', () => {
  it('sits on its target in viewport coordinates, however far the page is scrolled', async () => {
    placeAt(target('feature'), 100, 50, 100, 40);
    window.scrollTo(0, 500);
    await mountWith(hotspot('#feature'));
    const dot = $('.hotspot')!;
    expect(dot.style.top).toBe('93px');
    expect(dot.style.left).toBe('143px');
    expect(records()).toEqual([['show', undefined]]);
  });

  it('waits for a target that renders late', async () => {
    await mountWith(hotspot('#late'));
    expect($('.hotspot')).toBeNull();
    target('late');
    await flush(450);
    expect($('.hotspot')).toBeTruthy();
    expect(records()).toEqual([['show', undefined]]);
  });

  it('draws the beacon asked for: a still dot, or a question mark', async () => {
    target('feature');
    const plain = hotspot('#feature') as Extract<Engagement, { kind: 'hotspot' }>;
    await mountWith({ ...plain, hotspot: { ...plain.hotspot, beacon: 'question' } });
    expect($('.hotspot')?.classList.contains('hotspot--question')).toBe(true);
    expect($('.hotspot')?.textContent).toBe('?');

    widget.destroy();
    await mountWith({ ...plain, hotspot: { ...plain.hotspot, beacon: 'dot' } });
    expect($('.hotspot')?.classList.contains('hotspot--dot')).toBe(true);
    expect($('.hotspot')?.textContent).toBe('');
  });

  it('is a disclosure, and counts the first opening as a click', async () => {
    target('feature');
    await mountWith(hotspot('#feature'));
    const dot = $('.hotspot')!;
    const bubble = $('.hotspot__bubble')!;
    expect(dot.getAttribute('aria-expanded')).toBe('false');
    expect(bubble.hidden).toBe(true);

    dot.click();
    expect(bubble.hidden).toBe(false);
    dot.click();
    dot.click();
    expect(records()).toEqual([
      ['show', undefined],
      ['clicked', undefined],
    ]);
  });
});

/* ------------------------------------------------------------------ tours */

describe('tours', () => {
  it('records each step it draws, and completion against the last', async () => {
    target('one');
    target('two');
    await mountWith(tour([{ target: '#one' }, { target: '#two' }]));
    expect($('.tourPop__count')?.textContent).toBe('1 of 2');
    expect(layer().activeElement).toBe($('.tourPop'));

    byText('.engage-primary', 'Next').click();
    await flush(10);
    expect($('.tourPop__count')?.textContent).toBe('2 of 2');
    byText('.engage-primary', 'Finish').click();
    await flush(250);

    expect(records('tour_1')).toEqual([
      ['show', 1],
      ['seen', 2],
      ['completed', 2],
    ]);
    expect($('.tourPop')).toBeNull();
    expect(localStorage.getItem('hw:engage:tour:tour_1')).toBeNull();
  });

  it('puts a step that says "same as tour" where the tour says, and one of its own where it says', async () => {
    placeAt(target('one'), 400, 300, 100, 40);
    placeAt(target('two'), 400, 300, 100, 40);
    await mountWith(
      tour(
        [
          { target: '#one', placement: 'tour' },
          { target: '#two', placement: 'bottom' },
        ],
        {
          placement: 'top',
        },
      ),
    );
    // The pop is placed on the next frame, which a loaded machine can push past a fixed wait.
    await vi.waitFor(() => expect($('.tourPop')?.dataset.side).toBe('top'));
    byText('.engage-primary', 'Next').click();
    await vi.waitFor(() => expect($('.tourPop')?.dataset.side).toBe('bottom'));
  });

  it('waits for a click on the target when the step says so', async () => {
    const one = target('one');
    target('two');
    await mountWith(tour([{ target: '#one', advance: 'click' }, { target: '#two' }]));
    // Waits for the step to be drawn, not a fixed time: a busy machine draws it later.
    await vi.waitFor(() =>
      expect($('.tourPop__hint')?.textContent).toContain('Click the highlighted element'),
    );
    expect($$('.tourPop .engage-primary')).toHaveLength(0);

    one.click();
    await vi.waitFor(() => expect($('.tourPop__count')?.textContent).toBe('2 of 2'));
  });

  it('resumes across pages: progress is kept, and the next page asks for the tour back', async () => {
    target('one');
    await mountWith(
      tour([{ target: '#one', advance: 'url', url: '/projects/*' }, { target: '#two' }]),
    );
    expect(JSON.parse(localStorage.getItem('hw:engage:tour:tour_1') ?? '{}').step).toBe(0);
    widget.destroy();
    document.body.textContent = '';

    // The visitor followed the link: a new page, a new widget.
    history.replaceState({}, '', '/projects/new');
    target('two');
    await mountWith(
      tour([{ target: '#one', advance: 'url', url: '/projects/*' }, { target: '#two' }]),
    );
    const ask = server.calls.find((c) => c.path.startsWith('/engage?'));
    expect(new URLSearchParams(ask?.path.split('?')[1]).get('resume')).toBe('tour_1');
    expect($('.tourPop__count')?.textContent).toBe('2 of 2');
    // Already claimed on the first page: this one records the step it drew.
    expect(records('tour_1')).toEqual([['seen', 2]]);
  });

  it('skips a step whose element does not turn up in time', async () => {
    target('two');
    await mountWith(
      tour([{ target: '#missing' }, { target: '#two' }], {
        missingTarget: { waitSeconds: 1, action: 'skip' },
      }),
    );
    expect($('.tourPop')).toBeNull();
    await flush(1300);
    expect($('.tourPop__count')?.textContent).toBe('2 of 2');
    expect(records('tour_1')).toEqual([['show', 2]]);
  });

  it('stops quietly instead, when told to, and records nothing', async () => {
    target('two');
    await mountWith(
      tour([{ target: '#missing' }, { target: '#two' }], {
        missingTarget: { waitSeconds: 1, action: 'stop' },
      }),
    );
    await flush(1300);
    expect($('.tourPop')).toBeNull();
    expect(records('tour_1')).toEqual([]);
    expect(localStorage.getItem('hw:engage:tour:tour_1')).toBeNull();
  });

  it('records a skip as a dismissal at the step it happened', async () => {
    target('one');
    await mountWith(tour([{ target: '#one' }, { target: '#two' }]));
    byText('.tourPop__skip', 'Skip tour').click();
    expect(records('tour_1')).toEqual([
      ['show', 1],
      ['dismissed', 1],
    ]);
  });
});

/* ---------------------------------------------------------------- surveys */

describe('surveys', () => {
  function answers() {
    return server.calls
      .filter((c) => c.path === '/surveys/eng_s/response')
      .map((c) => c.body as Record<string, unknown>);
  }

  it('branches a detractor to the next question, and stores each answer on its own', async () => {
    await mountWith(survey());
    expect(layer().activeElement).toBe($('.survey'));
    byText('.survey__score', '3').click();
    // A detractor is asked why, before the score is sent.
    ($('.survey__comment') as HTMLTextAreaElement).value = 'Too slow';
    byText('.engage-primary', 'Send').click();
    await flush(10);

    expect($('.survey__q')?.textContent).toBe('What should we fix?');
    byText('.survey__choice', 'Speed').click();
    byText('.survey__choice', 'Docs').click();
    byText('.engage-primary', 'Next').click();
    await flush(10);

    const sent = answers();
    expect(sent).toMatchObject([
      { questionId: 'score', kind: 'nps', score: 3, comment: 'Too slow' },
      { questionId: 'why', kind: 'multi', choices: ['Speed', 'Docs'] },
    ]);
    expect(sent[0]?.session).toBe(sent[1]?.session);
    expect($('.survey__thanks')?.textContent).toBe('Thank you.');
    expect(records('eng_s')).toEqual([
      ['show', undefined],
      ['completed', undefined],
    ]);
  });

  it('ends a promoter straight away, without the follow-up', async () => {
    await mountWith(survey());
    byText('.survey__score', '10').click();
    await flush(10);
    expect(answers()).toMatchObject([{ questionId: 'score', score: 10 }]);
    expect(answers()[0]).not.toHaveProperty('comment');
    expect($('.survey__thanks')).toBeTruthy();
  });

  it('keeps the card up with a retry when an answer does not send', async () => {
    await mountWith(survey([{ ...nps, followUp: { enabled: false } }]));
    server.fail('/surveys/eng_s/response');
    byText('.survey__score', '8').click();
    await flush(10);
    expect($('.survey__error')?.textContent).toContain('did not send');
    expect(records('eng_s')).toEqual([['show', undefined]]);

    server.unfail('/surveys/eng_s/response');
    byText('.survey__score', '8').click();
    await flush(10);
    expect(records('eng_s')).toEqual([
      ['show', undefined],
      ['completed', undefined],
    ]);
  });

  it('asks stars, single choice and free text, and lets an optional one be skipped', async () => {
    await mountWith(
      survey([
        {
          ...nps,
          id: 'stars',
          kind: 'stars',
          prompt: 'Rate the docs',
          followUp: { enabled: false },
          branches: [],
          next: '',
        },
        { ...why, id: 'role', kind: 'single', prompt: 'Your role?', choices: ['Dev', 'PM'] },
        {
          ...why,
          id: 'else',
          kind: 'text',
          prompt: 'Anything else?',
          required: false,
          choices: [],
        },
      ]),
    );
    $$('.survey__star')[3]!.click();
    await flush(10);
    byText('.survey__choice', 'PM').click();
    await flush(10);
    expect($('.survey__q')?.textContent).toBe('Anything else?');
    byText('.survey__skip', 'Skip').click();
    await flush(10);
    expect(answers()).toMatchObject([
      { questionId: 'stars', kind: 'stars', score: 4 },
      { questionId: 'role', kind: 'single', choice: 'PM' },
    ]);
    expect($('.survey__thanks')).toBeTruthy();
  });

  it('runs along the bottom as a bar, in the colours asked for', async () => {
    await mountWith(survey(undefined, { placement: 'bar', theme: 'dark' }));
    expect($('.surveyWrap')?.classList.contains('surveyWrap--bar')).toBe(true);
    expect($('.survey')?.className).toBe('survey survey--bar survey--dark');
    expect($('.scrim')).toBeNull();
  });

  it('counts closing it unanswered as a dismissal', async () => {
    await mountWith(survey());
    $('.engage-close')!.click();
    expect(records('eng_s')).toEqual([
      ['show', undefined],
      ['dismissed', undefined],
    ]);
  });
});

/* ------------------------------------------------------- when, and queuing */

describe('triggers from the page', () => {
  it('shows an engagement when the page tracks its event', async () => {
    await mountWith(
      modal([[text('You made a project')]], {
        triggers: [{ type: 'event', name: 'project_created' }],
      }),
    );
    expect($('.modal')).toBeNull();
    widget.track('something_else');
    await flush(10);
    expect($('.modal')).toBeNull();
    widget.track('project_created');
    await flush(10);
    expect($('.modal')).toBeTruthy();
  });

  it('shows a manual one on helpwell.engage.show, fetching it by id if the page did not list it', async () => {
    server = createFakeServer({
      routes: {
        'GET /engage': { items: [modal([[text('Manual')]], { triggers: [{ type: 'manual' }] })] },
        'GET /engage/tour_1': { item: tour([{ target: '' }]) },
      },
    });
    widget = new Widget({ apiUrl: '/api/helpwell', fetch: server.fetch });
    await widget.mount();
    await flush(20);
    expect($('.modal')).toBeNull();

    widget.engage.show('eng_1');
    await flush(10);
    expect($('.modal')).toBeTruthy();
    expect(server.calls.find((c) => c.path === '/engage/eng_1/show')?.body).toMatchObject({
      manual: true,
    });

    widget.engage.hide();
    await flush(250);
    expect($('.modal')).toBeNull();

    // A tour this page was never given: asked for by id, then drawn.
    widget.engage.show('tour_1');
    await flush(20);
    expect($('.tourPop')).toBeTruthy();
  });

  it('offers helpwell.engage and helpwell.track once booted, and runs a show queued before', async () => {
    const manual = modal([[text('Queued')]], { triggers: [{ type: 'manual' }] });
    server = createFakeServer({
      routes: { 'GET /engage': { items: [manual] }, 'GET /engage/eng_1': { item: manual } },
    });
    const queued = Object.assign(() => {}, {
      q: [
        ['init', { apiUrl: '/api/helpwell', fetch: server.fetch }],
        ['engage.show', 'eng_1'],
      ],
    });
    widget = (await boot(queued as never)) as Widget;
    await flush(30);
    expect($('.modal')).toBeTruthy();

    window.helpwell?.engage?.hide();
    await flush(250);
    expect($('.modal')).toBeNull();
    window.helpwell?.track?.('exported_csv', { rows: 3 });
    await flush(10);
    expect(server.calls.find((c) => c.path === '/track')?.body).toMatchObject({
      name: 'exported_csv',
      props: { rows: 3 },
    });
    delete window.helpwell;
  });

  it('shows one interrupting thing at a time, and the waiting ones by priority', async () => {
    await mountWith(
      modal([[text('First')]], { id: 'first', priority: 5 }),
      modal([[text('Low')]], { id: 'low', priority: 1 }),
      modal([[text('High')]], { id: 'high', priority: 9 }),
    );
    const showing = () =>
      $$('.scrim:not(.is-leaving) .modal').map((m) => m.getAttribute('aria-label'));
    expect(showing()).toEqual(['First']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush(20);
    expect(showing()).toEqual(['High']);
  });
});

/* --------------------------------------------------------------- lifecycle */

describe('teardown', () => {
  it('leaves no listener behind once the widget is destroyed', async () => {
    const live = new Map<string, Set<unknown>>();
    const track = (type: string, listener: unknown, on: boolean) => {
      const set = live.get(type) ?? new Set();
      live.set(type, set);
      if (on) set.add(listener);
      else set.delete(listener);
    };
    vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, l: unknown) =>
      track(type, l, true)) as never);
    vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string, l: unknown) =>
      track(type, l, false)) as never);
    vi.spyOn(document, 'addEventListener').mockImplementation(((type: string, l: unknown) =>
      track(`document:${type}`, l, true)) as never);
    vi.spyOn(document, 'removeEventListener').mockImplementation(((type: string, l: unknown) =>
      track(`document:${type}`, l, false)) as never);

    target('feature');
    target('one');
    await mountWith(
      { ...hotspot('#feature'), id: 'eng_h' },
      { ...tour([{ target: '#one' }]), id: 'eng_t' },
      { ...banner([text('Hi')]), id: 'eng_b' },
      modal([[text('Hi'), buttons({ label: 'Go', action: 'url', value: '/' })]], {
        id: 'eng_m',
        triggers: [{ type: 'scroll', percent: 90 }],
      }),
    );
    expect($('.hotspot')).toBeTruthy();
    expect($('.tourPop')).toBeTruthy();
    expect(live.get('scroll')?.size).toBeGreaterThan(0);

    widget.destroy();
    for (const [type, set] of live) expect(set.size, type).toBe(0);
    expect(document.querySelector('[data-helpwell-banner-spacer]')).toBeNull();
  });
});

describe('the page moving on', () => {
  it('clears what pointed at the old page and asks again for the new one', async () => {
    target('feature');
    await mountWith(hotspot('#feature'));
    expect($('.hotspot')).toBeTruthy();

    // The next page has nothing for this visitor.
    server.set('GET /engage', { items: [] });
    history.pushState({}, '', '/elsewhere');
    await flush(200);

    expect($('.hotspot')).toBeNull();
    const asks = server.calls
      .filter((c) => c.path.startsWith('/engage?'))
      .map((c) => new URLSearchParams(c.path.split('?')[1]).get('path'));
    expect(asks).toEqual(['/', '/elsewhere']);
  });
});

/* ------------------------------------------------------------- WP10a */

describe('several triggers', () => {
  it('shows on whichever fires first, once', async () => {
    await mountWith(
      modal([[text('## Either way')]], {
        triggers: [
          { type: 'event', name: 'first_thing' },
          { type: 'event', name: 'second_thing' },
        ],
      }),
    );
    expect($('.modal')).toBeNull();
    widget.track('second_thing');
    await flush(10);
    expect($('.modal')?.getAttribute('aria-label')).toBe('Either way');
    $('.engage-close')?.click();
    await flush(250);
    // The other trigger was taken down with it.
    widget.track('first_thing');
    await flush(10);
    expect($('.modal')).toBeNull();
    expect(records().filter(([state]) => state === 'show')).toHaveLength(1);
  });

  it('still reads the single trigger an older server sends', async () => {
    const { triggers: _t, ...older } = modal([[text('## Older')]]) as Engagement & {
      triggers?: unknown;
    };
    await mountWith({ ...older, trigger: { type: 'event', name: 'go' } } as unknown as Engagement);
    widget.track('go');
    await flush(10);
    expect($('.modal')?.getAttribute('aria-label')).toBe('Older');
  });
});

describe('personalisation', () => {
  it('fills a visitor’s details from the fields the server sent, as text', async () => {
    server = createFakeServer({
      routes: {
        'GET /engage': {
          items: [
            modal([
              [
                text('## Hi {{first_name|there}}'),
                text('Your plan: **{{plan|free}}**. Team: {{company}}.'),
                buttons({ label: 'Thanks, {{first_name}}', action: 'dismiss' }),
              ],
            ]),
          ],
          fields: { first_name: 'Ada <b>', plan: '[Pro](javascript:alert(1))' },
        },
      },
    });
    widget = new Widget({ apiUrl: '/api/helpwell', fetch: server.fetch });
    await widget.mount();
    await flush(20);
    expect($('.modal')?.getAttribute('aria-label')).toBe('Hi Ada <b>');
    expect($('.modal h2')?.textContent).toContain('Hi Ada <b>');
    expect($('.modal b')).toBeNull();
    const plan = $$('.modal strong').find((s) => s.textContent?.includes('javascript'));
    expect(plan?.textContent).toBe('[Pro](javascript:alert(1))');
    expect($('.modal a[href*="javascript"]')).toBeNull();
    expect($('.modal')?.textContent).toContain('Team: .');
    expect(byText('.engage-primary', 'Thanks, Ada <b>')).toBeTruthy();
  });
});

describe('banner countdown and scrolling', () => {
  afterEach(() => vi.useRealTimers());

  it('counts down to its date after the text', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
    await mountWith(
      banner([text('Sale ends soon'), buttons({ label: 'Shop', action: 'url', value: '/sale' })], {
        countdown: { until: '2026-10-02T12:03:04Z', onEnd: 'hide' },
      }),
    );
    const timer = $('.banner__countdown');
    expect(timer?.getAttribute('role')).toBe('timer');
    expect(timer?.textContent).toBe('1d02h03m04s');
    expect(timer?.getAttribute('aria-label')).toBe('Ends in 1 day 2 hours 3 minutes');
    // After the words, before the call to action.
    const order = [...($('.banner .eg-blocks')?.children ?? [])].map((c) => c.className);
    expect(order).toEqual(['eg-text', 'banner__countdown', 'eg-buttons']);
    vi.advanceTimersByTime(2_000);
    expect($('.banner__countdown')?.textContent).toBe('1d02h03m02s');
  });

  it('goes when its countdown reaches zero, recording nothing', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
    await mountWith(
      banner([text('Last call')], { countdown: { until: '2026-10-01T10:00:03Z', onEnd: 'hide' } }),
    );
    expect($('.banner__countdown')?.textContent).toBe('00h00m03s');
    vi.advanceTimersByTime(4_000);
    vi.useRealTimers();
    await flush(250);
    expect($('.banner')).toBeNull();
    // Its time ran out; the visitor did not close it.
    expect(records().map(([state]) => state)).toEqual(['show']);
  });

  it('is not shown at all once a countdown that hides has ended', async () => {
    await mountWith(
      banner([text('Over')], { countdown: { until: '2020-01-01T00:00:00Z', onEnd: 'hide' } }),
    );
    expect($('.banner')).toBeNull();
    expect(records()).toEqual([]);
  });

  it('stays at zero when told to', async () => {
    await mountWith(
      banner([text('Doors open')], { countdown: { until: '2020-01-01T00:00:00Z', onEnd: 'keep' } }),
    );
    expect($('.banner__countdown')?.textContent).toBe('00h00m00s');
  });

  it('scrolls away with the page when it is not sticky', async () => {
    await mountWith(banner([text('News')], { sticky: false }));
    const bar = $('.banner');
    expect(bar?.classList.contains('banner--scrolls')).toBe(true);
    bar!.getBoundingClientRect = () => ({ height: 40 }) as DOMRect;
    Object.defineProperty(window, 'scrollY', { value: 30, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    await flush(30);
    expect(bar?.style.getPropertyValue('--banner-shift')).toBe('-30px');
    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    await flush(30);
    expect(bar?.style.getPropertyValue('--banner-shift')).toBe('-64px');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('stays in view by default', async () => {
    await mountWith(banner([text('News')]));
    expect($('.banner')?.classList.contains('banner--scrolls')).toBe(false);
  });
});
