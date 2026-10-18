/**
 * Engage against a real database: choosing what a page view shows (who,
 * where, frequency, resuming tours), claiming one under the global cap,
 * storing survey answers per question, and the stats the dashboard reads.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHelpWellHandler } from '../src/api.js';
import { rowsOf } from '../src/db/rows.js';
import type { Db } from '../src/db.js';
import { type Engagement, parseEngagement, type SurveyEngagement } from '../src/engage/schema.js';
import { engagementStats, tourFunnel } from '../src/engage/stats.js';
import {
  recordSurveyResponse,
  surveyResults,
  surveySessions,
  surveySessionsCsv,
} from '../src/engage/surveys.js';
import type { VisitContext } from '../src/engage/targeting.js';
import { createContact } from '../src/repos/contacts.js';
import {
  claimEngagement,
  recordImpression,
  selectEngagements,
  withinLimits,
} from '../src/repos/engage.js';
import { createSegment, deleteSegment } from '../src/segments/repo.js';
import { SettingsStore } from '../src/settings/store.js';
import { freshDb, type TestDb } from './helpers/db.js';
import { client } from './helpers/http.js';

const ADMIN = 'engage-admin-token';
const NOW = new Date('2026-10-01T12:00:00Z');

let t: TestDb;
let db: Db;

beforeAll(async () => {
  t = await freshDb();
  db = t.db;
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM helpwell.engage_impressions`);
  await db.execute(sql`DELETE FROM helpwell.survey_responses`);
});

function text(markdown: string) {
  return [{ type: 'text', markdown }];
}

function def(input: Record<string, unknown>): Engagement {
  return parseEngagement({
    kind: 'modal',
    modal: { slides: [{ blocks: text('Hello') }] },
    ...input,
  });
}

function visit(patch: Partial<VisitContext> = {}): VisitContext {
  return {
    path: '/app',
    referrer: '',
    utm: {},
    device: 'desktop',
    language: 'en',
    contactId: null,
    identified: false,
    now: NOW,
    ...patch,
  };
}

const ids = (items: Engagement[]) => items.map((e) => e.id);

describe('selectEngagements', () => {
  it('leaves out a banner whose countdown has run out, unless it stays at zero', async () => {
    const banner = (id: string, countdown: Record<string, unknown>) =>
      parseEngagement({ id, kind: 'banner', banner: { blocks: text('Sale'), countdown } });
    const items = [
      banner('over', { until: '2026-10-01T11:00:00Z' }),
      banner('stays', { until: '2026-10-01T11:00:00Z', onEnd: 'keep' }),
      banner('soon', { until: '2026-10-02T00:00:00Z' }),
    ];
    expect(ids(await selectEngagements(db, items, visit()))).toEqual(['stays', 'soon']);
  });

  it('shows an anonymous visitor what is for everyone, and nothing that is for the signed in', async () => {
    const items = [
      def({ id: 'everyone' }),
      def({ id: 'members', targeting: { audience: 'identified' } }),
      def({ id: 'strangers', targeting: { audience: 'anonymous' } }),
    ];
    expect(ids(await selectEngagements(db, items, visit()))).toEqual(['everyone', 'strangers']);
  });

  it('checks contact conditions and segments with the conditions module', async () => {
    const pro = await createContact(db, {
      source: 'api',
      identified: true,
      attributes: { plan: 'pro', seats: 12 },
    });
    const free = await createContact(db, {
      source: 'api',
      identified: true,
      attributes: { plan: 'free' },
    });
    const segment = await createSegment(db, {
      name: 'Big teams',
      rules: { all: [{ field: 'seats', op: 'gte', value: 10 }] },
    });
    const items = [
      def({
        id: 'pro-only',
        targeting: { conditions: { all: [{ field: 'plan', op: 'is', value: 'pro' }] } },
      }),
      def({ id: 'big-teams', targeting: { segmentId: segment.id } }),
    ];

    expect(
      ids(await selectEngagements(db, items, visit({ contactId: pro, identified: true }))),
    ).toEqual(['pro-only', 'big-teams']);
    expect(
      ids(await selectEngagements(db, items, visit({ contactId: free, identified: true }))),
    ).toEqual([]);
    // An anonymous visitor has no plan, and is in no segment.
    expect(ids(await selectEngagements(db, items, visit()))).toEqual([]);

    // A segment that no longer exists targets nobody.
    await deleteSegment(db, segment.id);
    expect(
      ids(await selectEngagements(db, items, visit({ contactId: pro, identified: true }))),
    ).toEqual(['pro-only']);
  });

  it('orders by priority and drops what is out of schedule or disabled', async () => {
    const items = [
      def({ id: 'low', priority: 1 }),
      def({ id: 'high', priority: 90 }),
      def({ id: 'later', schedule: { start: '2026-11-01T00:00:00Z' } }),
      def({ id: 'off', enabled: false }),
    ];
    expect(ids(await selectEngagements(db, items, visit()))).toEqual(['high', 'low']);
  });

  it('remembers what a contact has seen, and brings back a tour in progress on any page', async () => {
    const contactId = await createContact(db, { source: 'api' });
    const tour = def({
      id: 'onboarding',
      kind: 'tour',
      targeting: { pages: { include: ['/start'] } },
      tour: {
        steps: [
          { target: '#a', blocks: text('A') },
          { target: '#b', blocks: text('B') },
        ],
      },
    });
    const once = def({ id: 'once' });
    await recordImpression(db, { engagementId: 'once', contactId, state: 'seen' });
    await recordImpression(db, { engagementId: 'onboarding', contactId, state: 'seen', step: 1 });

    const here = visit({ contactId, path: '/elsewhere' });
    expect(ids(await selectEngagements(db, [tour, once], here))).toEqual([]);
    expect(
      ids(await selectEngagements(db, [tour, once], here, { resume: ['onboarding'] })),
    ).toEqual(['onboarding']);

    await recordImpression(db, { engagementId: 'onboarding', contactId, state: 'completed' });
    expect(
      ids(await selectEngagements(db, [tour, once], here, { resume: ['onboarding'] })),
    ).toEqual([]);
  });
});

describe('claimEngagement and the global cap', () => {
  const engage = (limits: Record<string, number>, ...engagements: Engagement[]) => ({
    limits: { perSession: 0, perDay: 0, minMinutesBetween: 0, ...limits },
    engagements,
  });

  it('records seen once, then refuses under the frequency rule', async () => {
    const contactId = await createContact(db, { source: 'api' });
    const settings = engage({}, def({ id: 'hello' }));
    const claim = () =>
      claimEngagement(db, settings, 'hello', visit({ contactId }), { contactId, sessionId: 's1' });

    expect(await claim()).toEqual({ shown: true });
    expect(await claim()).toEqual({ shown: false, reason: 'frequency' });
    // The page asking by id is not held to the frequency rule.
    expect(
      await claimEngagement(db, settings, 'hello', visit({ contactId }), {
        contactId,
        manual: true,
      }),
    ).toEqual({ shown: true });
    expect(
      await claimEngagement(db, settings, 'nope', visit({ contactId }), { contactId }),
    ).toEqual({ shown: false, reason: 'not_found' });
  });

  it('holds a session to its cap, counted on the server, and leaves hotspots out', async () => {
    const contactId = await createContact(db, { source: 'api' });
    const settings = engage(
      { perSession: 1 },
      def({ id: 'first' }),
      def({ id: 'second' }),
      def({ id: 'beacon', kind: 'hotspot', hotspot: { target: '#x', blocks: text('Hi') } }),
    );
    const claim = (id: string, sessionId: string) =>
      claimEngagement(db, settings, id, visit({ contactId }), { contactId, sessionId });

    expect(await claim('first', 'tab-1')).toEqual({ shown: true });
    expect(await claim('second', 'tab-1')).toEqual({ shown: false, reason: 'limit' });
    expect(await claim('beacon', 'tab-1')).toEqual({ shown: true });
    // A new session starts a new count.
    expect(await claim('second', 'tab-2')).toEqual({ shown: true });
  });

  it('counts a day and a gap between interruptions', async () => {
    const contactId = await createContact(db, { source: 'api' });
    const input = { contactId, sessionId: null, engagementIds: ['a', 'b'], now: NOW };
    await db.execute(sql`
      INSERT INTO helpwell.engage_impressions (id, engagement_id, contact_id, state, created_at)
      VALUES ('imp_t1', 'a', ${contactId}, 'seen', ${new Date(NOW.getTime() - 10 * 60_000).toISOString()}::timestamptz)
    `);
    const limits = { perSession: 0, perDay: 0, minMinutesBetween: 0 };
    expect(await withinLimits(db, { ...limits, perDay: 1 }, input)).toBe(false);
    expect(await withinLimits(db, { ...limits, perDay: 2 }, input)).toBe(true);
    expect(await withinLimits(db, { ...limits, minMinutesBetween: 30 }, input)).toBe(false);
    expect(await withinLimits(db, { ...limits, minMinutesBetween: 5 }, input)).toBe(true);
    // Without a session id, the last half hour is the session.
    expect(await withinLimits(db, { ...limits, perSession: 1 }, input)).toBe(false);
    expect(
      await withinLimits(db, { ...limits, perSession: 1 }, { ...input, engagementIds: ['b'] }),
    ).toBe(true);
  });

  it('checks the audience again at claim time', async () => {
    const contactId = await createContact(db, { source: 'api' });
    const settings = engage({}, def({ id: 'members', targeting: { audience: 'identified' } }));
    expect(
      await claimEngagement(db, settings, 'members', visit({ contactId }), { contactId }),
    ).toEqual({ shown: false, reason: 'unavailable' });
  });
});

/* ----------------------------------------------------------------- surveys */

const survey = parseEngagement({
  id: 'pulse',
  kind: 'survey',
  survey: {
    questions: [
      {
        id: 'score',
        kind: 'nps',
        prompt: 'Recommend us?',
        followUp: { enabled: true, when: 'detractors' },
        branches: [{ min: 0, max: 6, goto: 'why' }],
        next: 'end',
      },
      { id: 'why', kind: 'multi', prompt: 'What went wrong?', choices: ['Price', 'Speed', 'Docs'] },
      { id: 'rate', kind: 'csat', prompt: 'Support?' },
      { id: 'more', kind: 'text', prompt: 'Anything else?', required: false },
    ],
  },
}) as SurveyEngagement;

describe('survey answers', () => {
  it('stores each answer against its question and session, and a retry replaces it', async () => {
    const [q0, q1] = survey.survey.questions;
    await recordSurveyResponse(
      db,
      { surveyId: 'pulse', sessionId: 's1', questionId: 'score', kind: 'nps', score: 3 },
      q0,
    );
    await recordSurveyResponse(
      db,
      {
        surveyId: 'pulse',
        sessionId: 's1',
        questionId: 'score',
        kind: 'nps',
        score: 4,
        comment: 'Slow',
      },
      q0,
    );
    await recordSurveyResponse(
      db,
      {
        surveyId: 'pulse',
        sessionId: 's1',
        questionId: 'why',
        kind: 'multi',
        choices: ['Speed', 'Docs'],
      },
      q1,
    );
    const rows = await db.execute(sql`
      SELECT question_id, score, choice, choices, comment FROM helpwell.survey_responses ORDER BY question_id
    `);
    expect(rowsOf(rows)).toMatchObject([
      { question_id: 'score', score: 4, comment: 'Slow' },
      { question_id: 'why', choice: 'Speed, Docs', choices: ['Speed', 'Docs'] },
    ]);
  });

  it('refuses an answer that does not fit its question', async () => {
    const [, q1, q2] = survey.survey.questions;
    await expect(
      recordSurveyResponse(db, { surveyId: 'pulse', kind: 'multi', choices: ['Weather'] }, q1),
    ).rejects.toThrow(/choices/);
    await expect(
      recordSurveyResponse(db, { surveyId: 'pulse', kind: 'csat', score: 6 }, q2),
    ).rejects.toThrow(/out of range/);
    await expect(
      recordSurveyResponse(db, { surveyId: 'pulse', kind: 'nps', score: 5 }, q1),
    ).rejects.toThrow(/is multi/);
  });

  it('adds them up per question: NPS, CSAT average, choices and comments', async () => {
    const answer = (session: string, questionId: string, input: Record<string, unknown>) =>
      recordSurveyResponse(db, {
        surveyId: 'pulse',
        sessionId: session,
        questionId,
        kind: survey.survey.questions.find((q) => q.id === questionId)!.kind,
        ...input,
      });
    await answer('a', 'score', { score: 10 });
    await answer('b', 'score', { score: 9 });
    await answer('c', 'score', { score: 2, comment: 'Too slow' });
    await answer('c', 'why', { choices: ['Speed'] });
    await answer('d', 'score', { score: 7 });
    await answer('a', 'rate', { score: 5 });
    await answer('b', 'rate', { score: 4 });
    await answer('b', 'more', { comment: 'Keep going' });
    // A first-version answer, with no question or session: it reads as q1.
    await db.execute(sql`
      INSERT INTO helpwell.survey_responses (id, survey_id, kind, score)
      VALUES ('srv_old', 'pulse', 'nps', 0)
    `);

    const results = await surveyResults(db, survey);
    expect(results.sessions).toBe(5);
    const [score, why, rate, more] = results.questions;
    expect(score?.answers).toBe(4);
    expect(score?.nps).toMatchObject({
      responses: 4,
      promoters: 2,
      passives: 1,
      detractors: 1,
      score: 25,
    });
    expect(score?.distribution.find((d) => d.value === 9)?.count).toBe(1);
    expect(score?.comments.map((c) => c.text)).toEqual(['Too slow']);
    expect(why?.choices).toEqual([
      { choice: 'Speed', count: 1 },
      { choice: 'Price', count: 0 },
      { choice: 'Docs', count: 0 },
    ]);
    expect(rate?.average).toBe(4.5);
    expect(more?.comments.map((c) => c.text)).toEqual(['Keep going']);

    const sessions = await surveySessions(db, 'pulse');
    expect(sessions).toHaveLength(5);
    const b = sessions.find((s) => s.sessionId === 'b');
    expect(b?.answers).toMatchObject({
      score: { score: 9 },
      rate: { score: 4 },
      more: { comment: 'Keep going' },
    });

    const csv = surveySessionsCsv(survey, sessions).split('\r\n');
    expect(csv[0]).toBe(
      'session,answered_at,contact_id,email,name,score,score_comment,why,rate,more',
    );
    expect(csv.find((line) => line.startsWith('c,'))).toContain(',2,Too slow,Speed,,');
  });
});

/* ------------------------------------------------------------------- stats */

describe('stats', () => {
  it('counts impressions once per showing and converts by kind', async () => {
    const contactId = await createContact(db, { source: 'api' });
    const add = (
      engagementId: string,
      state: 'seen' | 'clicked' | 'dismissed' | 'completed',
      step?: number,
    ) => recordImpression(db, { engagementId, contactId, state, step });
    await add('modal', 'seen');
    await add('modal', 'clicked');
    await add('tour', 'seen', 1);
    await add('tour', 'seen', 2);
    await add('tour', 'clicked', 1);
    await add('tour', 'completed', 2);

    const stats = await engagementStats(db, undefined, [
      { id: 'modal', kind: 'modal' },
      { id: 'tour', kind: 'tour' },
    ]);
    const modal = stats.find((s) => s.engagementId === 'modal');
    const tour = stats.find((s) => s.engagementId === 'tour');
    expect(modal).toMatchObject({ seen: 1, clicked: 1, conversions: 1, conversionRate: 1 });
    expect(tour).toMatchObject({ seen: 1, clicked: 1, completed: 1, conversions: 1, people: 1 });
  });

  it('shows where people drop out of a tour', async () => {
    for (let person = 0; person < 4; person++) {
      const contactId = await createContact(db, { source: 'api' });
      for (let step = 1; step <= 4 - person; step++) {
        await recordImpression(db, { engagementId: 'walk', contactId, state: 'seen', step });
      }
    }
    const funnel = await tourFunnel(db, 'walk', 4);
    expect(funnel.map((s) => s.people)).toEqual([4, 3, 2, 1]);
    expect(funnel.map((s) => s.reached)).toEqual([1, 0.75, 0.5, 0.25]);
    expect(funnel[1]?.dropOff).toBeCloseTo(0.25);
    expect(funnel[0]?.dropOff).toBeNull();
  });
});

/* ------------------------------------------------------------------ routes */

describe('routes', () => {
  let handler: ReturnType<typeof createHelpWellHandler>;

  beforeAll(async () => {
    handler = createHelpWellHandler({
      db,
      basePath: '/api/helpwell',
      adminToken: ADMIN,
      secureCookies: false,
    });
    await new SettingsStore(db).update({
      engage: {
        limits: { perSession: 1 },
        engagements: [
          def({
            id: 'welcome',
            name: 'Internal name',
            priority: 5,
            targeting: { pages: { include: ['/app/**'] }, devices: ['desktop'] },
          }),
          def({ id: 'second', targeting: { pages: { include: ['/app/**'] } } }),
          survey,
        ],
      },
    });
  });

  it('lists what a page could show, without the targeting rules', async () => {
    const browser = client(handler);
    const response = await browser.call('/engage?path=/app/home&device=desktop');
    const { items } = (await response.json()) as { items: Record<string, unknown>[] };
    expect(items.map((i) => i.id)).toEqual(['welcome', 'second', 'pulse']);
    expect(items[0]).not.toHaveProperty('targeting');
    expect(items[0]).not.toHaveProperty('name');
    expect(items[0]).toHaveProperty('triggers', [{ type: 'load' }]);

    const mobile = await browser.call('/engage?path=/app/home&device=mobile');
    expect(((await mobile.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([
      'second',
      'pulse',
    ]);
  });

  it('claims under the cap and says why it will not', async () => {
    const browser = client(handler);
    const first = await browser.call('/engage/welcome/show', { body: { session: 'x' } });
    expect(await first.json()).toEqual({ shown: true });
    expect(browser.jar.some((c) => c.startsWith('hw_visitor='))).toBe(true);
    const second = await browser.call('/engage/second/show', { body: { session: 'x' } });
    expect(await second.json()).toEqual({ shown: false, reason: 'limit' });
    const missing = await browser.call('/engage/nope/show', { body: {} });
    expect(missing.status).toBe(404);
  });

  it('serves one engagement by id for a manual show', async () => {
    const browser = client(handler);
    const response = await browser.call('/engage/second');
    expect(response.status).toBe(200);
    expect(((await response.json()) as { item: { id: string } }).item.id).toBe('second');
    expect((await browser.call('/engage/nope')).status).toBe(404);
  });

  it('takes survey answers per question, and checks them against the survey', async () => {
    const browser = client(handler);
    const ok = await browser.call('/surveys/pulse/response', {
      body: { session: 'r1', questionId: 'why', choices: ['Price'] },
    });
    expect(ok.status).toBe(201);
    const wrong = await browser.call('/surveys/pulse/response', {
      body: { session: 'r1', questionId: 'nope', score: 3 },
    });
    expect(wrong.status).toBe(400);
    // A survey the host runs itself, not in settings, is accepted as before.
    const own = await browser.call('/surveys/nps-q3/response', { body: { kind: 'nps', score: 9 } });
    expect(own.status).toBe(201);
  });

  it('gives admins results and a CSV, and nobody else', async () => {
    const admin = client(handler, { adminToken: ADMIN });
    await client(handler).call('/surveys/pulse/response', {
      body: { session: 'r2', questionId: 'score', score: 10 },
    });
    const results = await admin.call('/admin/engage/pulse/results?range=7d');
    expect(results.status).toBe(200);
    const body = (await results.json()) as {
      survey: { questions: { questionId: string; answers: number }[] };
    };
    expect(body.survey.questions[0]).toMatchObject({ questionId: 'score', answers: 1 });

    const csv = await admin.call('/admin/engage/pulse/responses.csv');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('session,answered_at');

    expect((await client(handler).call('/admin/engage/stats')).status).toBe(401);
  });
});
