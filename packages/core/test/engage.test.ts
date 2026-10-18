/**
 * Engage definitions without a database: the path matcher, the upgrade from
 * the first version's title/body/cta, the completeness checks the editor
 * runs, and the place and schedule rules of the targeting engine.
 */

import { describe, expect, it } from 'vitest';
import { checkEngagement } from '../src/engage/check.js';
import { videoProvider } from '../src/engage/media.js';
import { fieldValues, fillPlaceholders, placeholderKeys } from '../src/engage/personalize.js';
import {
  countdownOver,
  type Engagement,
  parseEngagement,
  upgradeEngagement,
} from '../src/engage/schema.js';
import {
  allowedByFrequency,
  inSchedule,
  matchesPlace,
  type VisitContext,
  visitFromQuery,
} from '../src/engage/targeting.js';
import { matchesPaths, pathMatches } from '../src/repos/engage.js';
import { parseSettings } from '../src/settings/schema.js';

describe('pathMatches', () => {
  it('matches an exact path', () => {
    expect(pathMatches('/pricing', '/pricing')).toBe(true);
    expect(pathMatches('/pricing', '/pricing/enterprise')).toBe(false);
  });

  it('tolerates a trailing slash', () => {
    expect(pathMatches('/pricing', '/pricing/')).toBe(true);
  });

  it('matches within one segment with a single star', () => {
    expect(pathMatches('/docs/*', '/docs/intro')).toBe(true);
    expect(pathMatches('/docs/*', '/docs/billing/invoices')).toBe(false);
    expect(pathMatches('/app/*/settings', '/app/team/settings')).toBe(true);
  });

  it('crosses segments with a double star', () => {
    expect(pathMatches('/app/**', '/app')).toBe(false);
    expect(pathMatches('/app/**', '/app/a')).toBe(true);
    expect(pathMatches('/app/**', '/app/a/b/c')).toBe(true);
    expect(pathMatches('**', '/anything/at/all')).toBe(true);
  });

  it('treats regex metacharacters as literal text', () => {
    // A dot must not match any character.
    expect(pathMatches('/a.b', '/axb')).toBe(false);
    expect(pathMatches('/a.b', '/a.b')).toBe(true);

    // A pattern that would be a catastrophic regex is just a literal.
    expect(pathMatches('/(a+)+$', '/aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(pathMatches('/price?', '/price')).toBe(false);
    expect(pathMatches('/price?', '/price?')).toBe(true);
  });

  it('does not corrupt a pattern containing a space', () => {
    expect(pathMatches('/my docs', '/my docs')).toBe(true);
    expect(pathMatches('/my docs', '/my-docs')).toBe(false);
  });

  it('is not confused by a backslash', () => {
    expect(pathMatches('/a\\b', '/a\\b')).toBe(true);
  });
});

describe('matchesPaths', () => {
  it('allows everything when no rules are given', () => {
    expect(matchesPaths(undefined, '/anywhere')).toBe(true);
    expect(matchesPaths({}, '/anywhere')).toBe(true);
    expect(matchesPaths({ include: [] }, '/anywhere')).toBe(true);
  });

  it('lets exclude win over include', () => {
    const rules = { include: ['/app/**'], exclude: ['/app/settings'] };
    expect(matchesPaths(rules, '/app/home')).toBe(true);
    expect(matchesPaths(rules, '/app/settings')).toBe(false);
  });

  it('excludes the checkout and login pages the PRD calls out', () => {
    const rules = { include: ['**'], exclude: ['/checkout/**', '/login', '/signup'] };
    expect(matchesPaths(rules, '/dashboard')).toBe(true);
    expect(matchesPaths(rules, '/checkout/payment')).toBe(false);
    expect(matchesPaths(rules, '/login')).toBe(false);
  });
});

/* ------------------------------------------------------------ the upgrade */

describe('first-version definitions become blocks', () => {
  it('turns a modal title, body and CTA into one slide of blocks', () => {
    const modal = parseEngagement({
      id: 'launch',
      kind: 'modal',
      title: 'Faster exports',
      body: 'Invoices now export in half the time.',
      cta: { label: 'Show me', url: 'helpwell:article/billing/invoices' },
      dismissible: false,
      paths: { include: ['/app/**'], exclude: ['/app/billing'] },
      audience: 'identified',
      delayMs: 3000,
    });
    expect(modal.kind).toBe('modal');
    if (modal.kind !== 'modal') return;
    expect(modal.name).toBe('Faster exports');
    expect(modal.dismissible).toBe(false);
    expect(modal.modal.slides).toEqual([
      {
        blocks: [
          { type: 'text', markdown: '## Faster exports\n\nInvoices now export in half the time.' },
          {
            type: 'buttons',
            buttons: [
              {
                label: 'Show me',
                action: 'article',
                value: 'billing/invoices',
                style: 'primary',
                newTab: false,
              },
            ],
          },
        ],
      },
    ]);
    expect(modal.targeting.pages).toEqual({ include: ['/app/**'], exclude: ['/app/billing'] });
    expect(modal.targeting.audience).toBe('identified');
    expect(modal.triggers).toEqual([{ type: 'delay', seconds: 3 }]);
  });

  it('keeps a banner on one line, and maps the chat link to the chat action', () => {
    const banner = parseEngagement({
      id: 'b',
      kind: 'banner',
      title: 'New',
      body: 'Dark mode is here.',
      cta: { label: 'Ask us', url: 'helpwell:open' },
    });
    if (banner.kind !== 'banner') throw new Error('not a banner');
    expect(banner.banner.blocks[0]).toEqual({
      type: 'text',
      markdown: '**New** Dark mode is here.',
    });
    expect(banner.banner.blocks[1]).toMatchObject({
      type: 'buttons',
      buttons: [{ label: 'Ask us', action: 'chat' }],
    });
  });

  it('moves a hotspot target and each tour step across', () => {
    const hotspot = parseEngagement({ id: 'h', kind: 'hotspot', target: '#nav', title: 'Here' });
    if (hotspot.kind !== 'hotspot') throw new Error('not a hotspot');
    expect(hotspot.hotspot.target).toBe('#nav');
    expect(hotspot.hotspot.blocks).toEqual([{ type: 'text', markdown: '**Here**' }]);

    const tour = parseEngagement({
      id: 't',
      kind: 'tour',
      steps: [
        { target: '#one', title: 'First', body: 'Start here.', placement: 'bottom' },
        { target: '#two', title: 'Second', placement: 'sideways' },
      ],
    });
    if (tour.kind !== 'tour') throw new Error('not a tour');
    expect(tour.tour.steps.map((s) => [s.target, s.placement, s.advance])).toEqual([
      ['#one', 'bottom', 'next'],
      ['#two', 'tour', 'next'],
    ]);
    // A step with no placement of its own follows the tour's, which is auto.
    expect(tour.tour.placement).toBe('auto');
    expect(tour.tour.steps[0]?.blocks).toEqual([
      { type: 'text', markdown: '**First**\n\nStart here.' },
    ]);
  });

  it('gives every kind its look options, and refuses ones it does not know', () => {
    const modal = parseEngagement({ id: 'm', kind: 'modal' });
    const hotspot = parseEngagement({ id: 'h', kind: 'hotspot' });
    const tour = parseEngagement({ id: 't', kind: 'tour', tour: { steps: [{}] } });
    const survey = parseEngagement({ id: 's', kind: 'survey' });
    expect(modal).toMatchObject({ modal: { progress: 'dots', mediaPosition: 'top' } });
    expect(hotspot).toMatchObject({ hotspot: { beacon: 'pulse' } });
    expect(tour).toMatchObject({ tour: { placement: 'auto', steps: [{ placement: 'tour' }] } });
    expect(survey).toMatchObject({ survey: { placement: 'corner', theme: 'brand' } });
    expect(
      parseEngagement({ id: 's', kind: 'survey', survey: { placement: 'bar' } }),
    ).toMatchObject({ survey: { placement: 'bar' } });
    expect(() => parseEngagement({ id: 'm', kind: 'modal', modal: { progress: 'pie' } })).toThrow();
    expect(() => parseEngagement({ id: 't', kind: 'tour', tour: { placement: 'tour' } })).toThrow();
  });

  it('turns the one-question survey into question q1 with its follow-up', () => {
    const survey = parseEngagement({
      id: 'nps',
      kind: 'survey',
      survey: { type: 'csat', question: 'How did we do?', followUp: 'Why?' },
    });
    if (survey.kind !== 'survey') throw new Error('not a survey');
    expect(survey.survey.questions).toHaveLength(1);
    expect(survey.survey.questions[0]).toMatchObject({
      id: 'q1',
      kind: 'csat',
      prompt: 'How did we do?',
      followUp: { enabled: true, prompt: 'Why?', when: 'always' },
    });
  });

  it('drops a link the first version would not have followed', () => {
    const modal = parseEngagement({
      id: 'm',
      kind: 'modal',
      title: 'x',
      cta: { label: 'Go', url: 'javascript:alert(1)' },
    });
    if (modal.kind !== 'modal') throw new Error('not a modal');
    expect(modal.modal.slides[0]?.blocks[1]).toMatchObject({
      buttons: [{ action: 'url', value: '' }],
    });
  });

  it('is idempotent, and leaves a new definition alone', () => {
    const once = parseEngagement({ id: 'm', kind: 'modal', title: 'Hi', body: 'There' });
    expect(parseEngagement(once)).toEqual(once);
    expect(upgradeEngagement(once)).toEqual(once);
  });

  it('upgrades inside a whole settings document, so an old config still boots', () => {
    const settings = parseSettings({
      engage: {
        engagements: [
          { id: 'welcome-tour', kind: 'tour', title: 'Welcome', steps: [{ target: '#nav' }] },
          { id: 'q3', kind: 'survey' },
        ],
      },
    });
    expect(settings.engage.limits).toEqual({ perSession: 0, perDay: 0, minMinutesBetween: 0 });
    const [tour, survey] = settings.engage.engagements;
    expect(tour?.kind === 'tour' && tour.tour.steps[0]?.target).toBe('#nav');
    expect(survey?.kind === 'survey' && survey.survey.questions[0]?.kind).toBe('nps');
  });
});

/* -------------------------------------------------------------- checking */

function modal(patch: Record<string, unknown> = {}): Engagement {
  return parseEngagement({
    id: 'announce',
    kind: 'modal',
    modal: { slides: [{ blocks: [{ type: 'text', markdown: 'Hello' }] }] },
    ...patch,
  });
}

describe('checkEngagement', () => {
  it('passes a complete modal', () => {
    expect(checkEngagement(modal())).toEqual([]);
  });

  it('names the field of each problem, as the editor names its inputs', () => {
    const problems = checkEngagement(
      modal({
        modal: {
          slides: [
            {
              blocks: [
                { type: 'image', url: 'javascript:alert(1)' },
                { type: 'video', url: 'https://example.com/clip' },
                { type: 'buttons', buttons: [{ label: '', action: 'url', value: 'ftp://x' }] },
              ],
            },
            { blocks: [] },
          ],
        },
      }),
    );
    expect(problems.map((p) => p.path)).toEqual([
      'modal.slides.0.blocks.0.url',
      'modal.slides.0.blocks.1.url',
      'modal.slides.0.blocks.2.buttons.0.label',
      'modal.slides.0.blocks.2.buttons.0.value',
      'modal.slides.1.blocks',
    ]);
  });

  it('wants a unique id, and a tour that exists behind a start-tour button', () => {
    const tour = parseEngagement({
      id: 'onboarding',
      kind: 'tour',
      tour: { steps: [{ target: '#a', blocks: [{ type: 'text', markdown: 'A' }] }] },
    });
    const starts = modal({
      modal: {
        slides: [
          {
            blocks: [
              {
                type: 'buttons',
                buttons: [{ label: 'Take the tour', action: 'tour', value: 'nope' }],
              },
            ],
          },
        ],
      },
    });
    expect(checkEngagement(starts, [tour]).map((p) => p.message)).toEqual([
      'Pick a tour that exists.',
    ]);

    const fixed = modal({
      modal: {
        slides: [
          {
            blocks: [
              {
                type: 'buttons',
                buttons: [{ label: 'Take the tour', action: 'tour', value: 'onboarding' }],
              },
            ],
          },
        ],
      },
    });
    expect(checkEngagement(fixed, [tour])).toEqual([]);
    expect(checkEngagement(fixed, [tour, modal()]).map((p) => p.path)).toEqual(['id']);
  });

  it('keeps survey branches moving forward to questions that exist', () => {
    const survey = parseEngagement({
      id: 's',
      kind: 'survey',
      survey: {
        questions: [
          {
            id: 'score',
            kind: 'nps',
            prompt: 'Recommend us?',
            branches: [
              { min: 0, max: 6, goto: 'why' },
              { min: 9, max: 12, goto: 'end' },
              { min: 7, max: 8, goto: 'score' },
            ],
          },
          { id: 'why', kind: 'single', prompt: 'Why?', choices: ['Price'] },
          { id: 'why', kind: 'text', prompt: 'Anything else?' },
        ],
      },
    });
    expect(checkEngagement(survey).map((p) => p.path)).toEqual([
      'survey.questions.2.id',
      'survey.questions.0.branches.1.min',
      'survey.questions.0.branches.2.goto',
      'survey.questions.1.choices',
    ]);
  });

  it('asks for a selector or event name when the trigger needs one', () => {
    expect(checkEngagement(modal({ trigger: { type: 'click' } })).map((p) => p.path)).toEqual([
      'triggers.0.selector',
    ]);
    expect(
      checkEngagement(modal({ triggers: [{ type: 'load' }, { type: 'event', name: '' }] })).map(
        (p) => p.path,
      ),
    ).toEqual(['triggers.1.name']);
  });

  it('refuses the same trigger twice', () => {
    expect(
      checkEngagement(modal({ triggers: [{ type: 'exit' }, { type: 'exit' }] })).map((p) => p.path),
    ).toEqual(['triggers.1.type']);
  });

  it('wants the schedule to end after it starts', () => {
    const problems = checkEngagement(
      modal({ schedule: { start: '2026-10-02T00:00:00Z', end: '2026-10-01T00:00:00Z' } }),
    );
    expect(problems.map((p) => p.path)).toEqual(['schedule.end']);
  });
});

describe('videoProvider', () => {
  it('recognises the hosts the widget can play, and nothing else', () => {
    expect(videoProvider('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
    expect(videoProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
    expect(videoProvider('https://vimeo.com/76979871')).toBe('vimeo');
    expect(videoProvider(`https://www.loom.com/share/${'a'.repeat(32)}`)).toBe('loom');
    expect(videoProvider('https://acme.wistia.com/medias/abcde12345')).toBe('wistia');
    expect(videoProvider('/api/helpwell/media/_engage/clip.mp4')).toBe('file');
    expect(videoProvider('https://example.com/page')).toBeNull();
    expect(videoProvider('javascript:alert(1)')).toBeNull();
  });
});

/* ------------------------------------------------------------- targeting */

function visit(patch: Partial<VisitContext> = {}): VisitContext {
  return {
    path: '/app',
    referrer: '',
    utm: {},
    device: 'desktop',
    language: 'en-GB',
    contactId: null,
    identified: false,
    now: new Date('2026-10-01T12:00:00Z'),
    ...patch,
  };
}

function targeting(patch: Record<string, unknown>) {
  return modal({ targeting: patch }).targeting;
}

describe('matchesPlace', () => {
  it('reads the visit from the widget query string', () => {
    const v = visitFromQuery(
      new URLSearchParams(
        'path=/pricing&referrer=https://www.google.com/&utm_source=Newsletter&device=mobile&lang=fr-CA',
      ),
      { contactId: null, identified: false },
    );
    expect(v).toMatchObject({
      path: '/pricing',
      referrer: 'https://www.google.com/',
      utm: { source: 'newsletter' },
      device: 'mobile',
      language: 'fr-CA',
    });
  });

  it('checks pages, referrer, UTM, device and language together', () => {
    const rules = targeting({
      pages: { include: ['/pricing'] },
      referrer: { include: ['google.'] },
      utm: { campaign: ['spring'] },
      devices: ['desktop'],
      languages: ['en'],
    });
    const good = visit({
      path: '/pricing',
      referrer: 'https://www.google.com/search',
      utm: { campaign: 'spring' },
    });
    expect(matchesPlace(rules, good)).toBe(true);
    expect(matchesPlace(rules, { ...good, path: '/app' })).toBe(false);
    expect(matchesPlace(rules, { ...good, referrer: '' })).toBe(false);
    expect(matchesPlace(rules, { ...good, utm: {} })).toBe(false);
    expect(matchesPlace(rules, { ...good, device: 'mobile' })).toBe(false);
    expect(matchesPlace(rules, { ...good, language: 'de-DE' })).toBe(false);
    // Unknown device and language never fail a rule the browser did not answer.
    expect(matchesPlace(rules, { ...good, device: null, language: '' })).toBe(true);
  });

  it('lets a referrer exclusion win', () => {
    const rules = targeting({ referrer: { exclude: ['partner.example'] } });
    expect(matchesPlace(rules, visit({ referrer: 'https://partner.example/x' }))).toBe(false);
    expect(matchesPlace(rules, visit({ referrer: '' }))).toBe(true);
  });

  it('matches a language by prefix', () => {
    const rules = targeting({ languages: ['pt'] });
    expect(matchesPlace(rules, visit({ language: 'pt-BR' }))).toBe(true);
    expect(matchesPlace(rules, visit({ language: 'pl' }))).toBe(false);
  });
});

describe('schedule and frequency', () => {
  it('shows only between start and end', () => {
    const schedule = { start: '2026-10-01T00:00:00Z', end: '2026-10-08T00:00:00Z' };
    expect(inSchedule(schedule, new Date('2026-09-30T23:59:00Z'))).toBe(false);
    expect(inSchedule(schedule, new Date('2026-10-03T00:00:00Z'))).toBe(true);
    expect(inSchedule(schedule, new Date('2026-10-08T00:00:00Z'))).toBe(false);
    expect(inSchedule({ start: null, end: null }, new Date())).toBe(true);
  });

  it('never nags after a dismissal, and waits the days it says', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const seen = (days: number, ...states: string[]) => ({
      states: new Set(['seen', ...states]),
      last: now.getTime() - days * 86_400_000,
    });
    expect(allowedByFrequency('once', undefined, now)).toBe(true);
    expect(allowedByFrequency('once', seen(1), now)).toBe(false);
    expect(allowedByFrequency('always', seen(0), now)).toBe(true);
    expect(allowedByFrequency('always', seen(0, 'dismissed'), now)).toBe(false);
    expect(allowedByFrequency({ everyDays: 7 }, seen(6), now)).toBe(false);
    expect(allowedByFrequency({ everyDays: 7 }, seen(7), now)).toBe(true);
  });
});

describe('triggers', () => {
  it('reads one trigger as a list of one, and a list as it is', () => {
    expect(modal({ trigger: { type: 'scroll', percent: 40 } }).triggers).toEqual([
      { type: 'scroll', percent: 40 },
    ]);
    expect(
      modal({ triggers: [{ type: 'exit' }, { type: 'time_on_page', seconds: 20 }] }).triggers,
    ).toEqual([{ type: 'exit' }, { type: 'time_on_page', seconds: 20 }]);
    // A list, when there is one, wins over the older single trigger.
    expect(modal({ trigger: { type: 'exit' }, triggers: [{ type: 'load' }] }).triggers).toEqual([
      { type: 'load' },
    ]);
    expect(modal({ triggers: [] }).triggers).toEqual([{ type: 'load' }]);
    expect(modal().triggers).toEqual([{ type: 'load' }]);
    expect('trigger' in modal({ trigger: { type: 'exit' } })).toBe(false);
  });

  it('takes at most five', () => {
    expect(() =>
      modal({ triggers: Array.from({ length: 6 }, (_, i) => ({ type: 'delay', seconds: i })) }),
    ).toThrow();
  });

  it('turns the first version delay into a trigger in the list', () => {
    expect(modal({ delayMs: 4000 }).triggers).toEqual([{ type: 'delay', seconds: 4 }]);
  });
});

describe('banner countdown and sticky', () => {
  const banner = (patch: Record<string, unknown> = {}) =>
    parseEngagement({
      id: 'sale',
      kind: 'banner',
      banner: { blocks: [{ type: 'text', markdown: 'Sale ends soon' }], ...patch },
    });

  it('stays in view by default, and has no countdown', () => {
    const b = banner();
    if (b.kind !== 'banner') throw new Error('not a banner');
    expect(b.banner.sticky).toBe(true);
    expect(b.banner.countdown).toEqual({ until: null, onEnd: 'hide' });
  });

  it('is over once a countdown that hides has run out', () => {
    const b = banner({ countdown: { until: '2026-10-01T12:00:00Z' } });
    expect(countdownOver(b, new Date('2026-10-01T11:59:59Z'))).toBe(false);
    expect(countdownOver(b, new Date('2026-10-01T12:00:00Z'))).toBe(true);
    const kept = banner({ countdown: { until: '2026-10-01T12:00:00Z', onEnd: 'keep' } });
    expect(countdownOver(kept, new Date('2026-10-02T00:00:00Z'))).toBe(false);
    expect(countdownOver(modal(), new Date())).toBe(false);
  });

  it('refuses a countdown that is not a date', () => {
    expect(() => banner({ countdown: { until: 'next friday' } })).toThrow();
  });

  it('notices a banner that stops before its countdown ends', () => {
    const b = banner({ countdown: { until: '2026-10-05T00:00:00Z' } });
    const stopped = { ...b, schedule: { start: null, end: '2026-10-04T00:00:00Z' } } as Engagement;
    expect(checkEngagement(stopped).map((p) => p.path)).toEqual(['banner.countdown.until']);
  });
});

describe('personalisation', () => {
  it('finds the keys anywhere in a definition', () => {
    const keys = placeholderKeys({
      a: 'Hi {{first_name|there}}, on {{ plan }}',
      b: [{ c: '{{company}} and {{first_name}}' }],
      d: 'no {{ bad key }} here {{}}',
    });
    expect([...keys].sort()).toEqual(['company', 'first_name', 'plan']);
  });

  it('reads first and last names from the name, and anything else from attributes', () => {
    const contact = {
      name: 'Ada  Lovelace',
      email: 'ada@example.com',
      attributes: { plan: 'Pro', seatCount: 12, tags: ['a', 'b'], nested: { x: 1 } },
    };
    expect(
      fieldValues(contact, [
        'first_name',
        'last_name',
        'name',
        'email',
        'plan',
        'seat_count',
        'tags',
        'nested',
        'missing',
      ]),
    ).toEqual({
      first_name: 'Ada',
      last_name: 'Lovelace',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      plan: 'Pro',
      seat_count: '12',
      tags: 'a, b',
    });
    expect(
      fieldValues({ ...contact, attributes: { firstName: 'Countess' } }, ['first_name']),
    ).toEqual({ first_name: 'Countess' });
  });

  it('fills stored text with the value or the fallback, never with Markdown', () => {
    expect(fillPlaceholders('Hi {{first_name|there}}!', { first_name: 'Ada' })).toBe('Hi Ada!');
    expect(fillPlaceholders('Hi {{first_name|there}}!', {})).toBe('Hi there!');
    expect(fillPlaceholders('Hi {{first_name}}!', {})).toBe('Hi !');
    expect(fillPlaceholders('Hi {{name}}', { name: '**[x](javascript:alert(1))**' })).toBe(
      'Hi xjavascript:alert1',
    );
  });
});
