/**
 * Survey answers: storing them, and reading them back as results.
 *
 * A survey is up to twenty questions with branching, so an answer is stored
 * the moment it is given, one row per question, tied together by the
 * widget's survey session id. A visitor who stops half way still counts for
 * the questions they answered. Answering the same question again in one
 * session (a retry after a network error) replaces the earlier answer.
 *
 * Rows written before multi-question surveys have no question or session id.
 * They read as question `q1`, which is the id the upgrade in schema.ts gives
 * a first-version survey's only question, each in a session of its own.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rowsOf } from '../db/rows.js';
import { HelpWellError } from '../errors.js';
import { idPrefix, newId } from '../ids.js';
import {
  QUESTION_KINDS,
  type QuestionKind,
  SCALES,
  type SurveyEngagement,
  type SurveyQuestion,
} from './schema.js';

export { QUESTION_KINDS as SURVEY_ANSWER_KINDS };

/** The question id first-version answers are read as. */
export const LEGACY_QUESTION_ID = 'q1';

export interface SurveyAnswer {
  surveyId: string;
  kind: QuestionKind;
  /** One visitor's pass through the survey. Absent from first-version clients. */
  sessionId?: string | null;
  questionId?: string | null;
  /** NPS 0-10, CSAT 1-5, stars 1-5. */
  score?: number | null;
  /** Single choice. */
  choice?: string | null;
  /** Multiple choice. */
  choices?: string[] | null;
  /** A written answer, or the follow-up comment after a score. */
  comment?: string | null;
  contactId?: string | null;
}

const MAX_COMMENT = 2000;

function bad(message: string, publicMessage: string): HelpWellError {
  return new HelpWellError('bad_request', message, { publicMessage });
}

/**
 * Check an answer against its kind and, when the survey is defined in
 * settings, against the question it claims to answer. Returns the answer
 * with its values trimmed to what is stored.
 */
export function validateSurveyAnswer(
  answer: SurveyAnswer,
  question?: SurveyQuestion | null,
): SurveyAnswer {
  if (!QUESTION_KINDS.includes(answer.kind)) {
    throw bad(`Unknown survey kind ${String(answer.kind)}`, 'That is not a kind of question.');
  }
  if (question && question.kind !== answer.kind) {
    throw bad(
      `Question ${question.id} is ${question.kind}`,
      'That answer does not fit the question.',
    );
  }

  const scale = SCALES[answer.kind];
  const out: SurveyAnswer = {
    ...answer,
    comment: answer.comment?.trim().slice(0, MAX_COMMENT) || null,
  };

  if (scale) {
    const [low, high] = scale;
    const score = answer.score;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < low || score > high) {
      const name = answer.kind === 'nps' ? 'NPS score' : `${answer.kind.toUpperCase()} score`;
      throw bad(
        `${name} out of range: ${String(score)}`,
        answer.kind === 'nps' ? 'Pick a score from 0 to 10.' : 'Pick a rating from 1 to 5.',
      );
    }
    out.choice = null;
    out.choices = null;
  } else if (answer.kind === 'single') {
    const choice = answer.choice?.trim().slice(0, 200);
    if (!choice) throw bad('A single-choice answer needs a choice', 'Pick one of the options.');
    if (question && !question.choices.includes(choice)) {
      throw bad(`Not a choice: ${choice}`, 'Pick one of the options.');
    }
    out.score = null;
    out.choice = choice;
    out.choices = null;
  } else if (answer.kind === 'multi') {
    const choices = [...new Set((answer.choices ?? []).map((c) => String(c).trim().slice(0, 200)))]
      .filter(Boolean)
      .slice(0, 20);
    if (choices.length === 0) throw bad('No choices picked', 'Pick at least one option.');
    if (question && choices.some((c) => !question.choices.includes(c))) {
      throw bad('Not one of the choices', 'Pick from the options given.');
    }
    out.score = null;
    out.choices = choices;
    out.choice = choices.join(', ').slice(0, 2000);
  } else {
    if (!out.comment) throw bad('An empty written answer', 'Write an answer first.');
    out.score = null;
    out.choice = null;
    out.choices = null;
  }
  return out;
}

/** Store one answer and return its id. Validates it first (`validateSurveyAnswer`). */
export async function recordSurveyResponse(
  db: Db,
  answer: SurveyAnswer,
  question?: SurveyQuestion | null,
): Promise<string> {
  const clean = validateSurveyAnswer(answer, question);
  const id = newId(idPrefix.survey);
  const sessionId = clean.sessionId?.slice(0, 80) || null;
  const questionId = clean.questionId?.slice(0, 40) || null;
  const choices = clean.choices ? JSON.stringify(clean.choices) : null;

  const result = await db.execute(sql`
    INSERT INTO helpwell.survey_responses
      (id, survey_id, kind, score, choice, choices, comment, contact_id, session_id, question_id)
    VALUES (${id}, ${clean.surveyId}, ${clean.kind}, ${clean.score ?? null}, ${clean.choice ?? null},
            ${choices}::jsonb, ${clean.comment ?? null}, ${clean.contactId ?? null},
            ${sessionId}, ${questionId})
    ON CONFLICT (survey_id, session_id, question_id)
      WHERE session_id IS NOT NULL AND question_id IS NOT NULL
    DO UPDATE SET kind = excluded.kind, score = excluded.score, choice = excluded.choice,
                  choices = excluded.choices, comment = excluded.comment,
                  created_at = now()
    RETURNING id
  `);
  return rowsOf<{ id: string }>(result)[0]?.id ?? id;
}

/* ---------------------------------------------------------------- results */

export interface NpsBreakdown {
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** %promoters - %detractors, rounded, or null with no answers. */
  score: number | null;
}

export interface QuestionResult {
  questionId: string;
  kind: QuestionKind;
  prompt: string;
  /** How many sessions answered it. */
  answers: number;
  /** Scales: how many picked each value, low to high, zeros included. */
  distribution: { value: number; count: number }[];
  /** CSAT and stars: the mean, to one decimal place. */
  average: number | null;
  /** NPS only. */
  nps: NpsBreakdown | null;
  /** Choice questions: every option, most picked first. */
  choices: { choice: string; count: number }[];
  /** Written answers and follow-up comments, newest first (up to 25). */
  comments: { text: string; score: number | null; at: string }[];
}

export interface SurveyResults {
  /** Sessions with at least one answer. */
  sessions: number;
  questions: QuestionResult[];
}

function since(from: Date | undefined) {
  return from ? sql`AND created_at >= ${from.toISOString()}::timestamptz` : sql``;
}

const QUESTION = sql`coalesce(question_id, ${LEGACY_QUESTION_ID})`;
const SESSION = sql`coalesce(session_id, id)`;

/** Per-question results for one survey, in the order its questions are asked. */
export async function surveyResults(
  db: Db,
  survey: Pick<SurveyEngagement, 'id' | 'survey'>,
  from?: Date,
): Promise<SurveyResults> {
  const window = since(from);
  const [totals, scores, singles, multis, comments] = await Promise.all([
    db.execute(sql`
      SELECT ${QUESTION} AS question, count(DISTINCT ${SESSION}) AS answers
      FROM helpwell.survey_responses
      WHERE survey_id = ${survey.id} ${window}
      GROUP BY 1
    `),
    db.execute(sql`
      SELECT ${QUESTION} AS question, score, count(*) AS n
      FROM helpwell.survey_responses
      WHERE survey_id = ${survey.id} AND score IS NOT NULL ${window}
      GROUP BY 1, 2
    `),
    db.execute(sql`
      SELECT ${QUESTION} AS question, choice, count(*) AS n
      FROM helpwell.survey_responses
      WHERE survey_id = ${survey.id} AND choices IS NULL AND choice IS NOT NULL ${window}
      GROUP BY 1, 2
    `),
    db.execute(sql`
      SELECT ${QUESTION} AS question, picked.value AS choice, count(*) AS n
      FROM helpwell.survey_responses
      CROSS JOIN LATERAL jsonb_array_elements_text(choices) AS picked(value)
      WHERE survey_id = ${survey.id} AND choices IS NOT NULL ${window}
      GROUP BY 1, 2
    `),
    db.execute(sql`
      SELECT question, comment, score, created_at FROM (
        SELECT ${QUESTION} AS question, comment, score, created_at,
               row_number() OVER (PARTITION BY ${QUESTION} ORDER BY created_at DESC) AS rank
        FROM helpwell.survey_responses
        WHERE survey_id = ${survey.id} AND comment IS NOT NULL AND comment <> '' ${window}
      ) AS recent
      WHERE rank <= 25
      ORDER BY created_at DESC
    `),
  ]);

  const answered = new Map(
    rowsOf<{ question: string; answers: number | string }>(totals).map((r) => [
      r.question,
      Number(r.answers),
    ]),
  );
  const sessionsResult = await db.execute(sql`
    SELECT count(DISTINCT ${SESSION}) AS n FROM helpwell.survey_responses
    WHERE survey_id = ${survey.id} ${window}
  `);

  const questions = survey.survey.questions.map((question): QuestionResult => {
    const scale = SCALES[question.kind];
    const scoreRows = rowsOf<{ question: string; score: number; n: number | string }>(
      scores,
    ).filter((r) => r.question === question.id);
    const distribution = scale
      ? Array.from({ length: scale[1] - scale[0] + 1 }, (_, i) => {
          const value = scale[0] + i;
          const row = scoreRows.find((r) => Number(r.score) === value);
          return { value, count: Number(row?.n ?? 0) };
        })
      : [];
    const total = distribution.reduce((sum, d) => sum + d.count, 0);
    const sum = distribution.reduce((acc, d) => acc + d.value * d.count, 0);

    const picked = new Map<string, number>(question.choices.map((c) => [c, 0]));
    const choiceRows = [
      ...rowsOf<{ question: string; choice: string; n: number | string }>(singles),
      ...rowsOf<{ question: string; choice: string; n: number | string }>(multis),
    ].filter((r) => r.question === question.id);
    for (const row of choiceRows)
      picked.set(row.choice, (picked.get(row.choice) ?? 0) + Number(row.n));

    return {
      questionId: question.id,
      kind: question.kind,
      prompt: question.prompt,
      answers: answered.get(question.id) ?? 0,
      distribution,
      average:
        (question.kind === 'csat' || question.kind === 'stars') && total > 0
          ? Math.round((sum / total) * 10) / 10
          : null,
      nps: question.kind === 'nps' ? npsFrom(distribution) : null,
      choices:
        question.kind === 'single' || question.kind === 'multi'
          ? [...picked]
              .map(([choice, count]) => ({ choice, count }))
              .sort((a, b) => b.count - a.count)
          : [],
      comments: rowsOf<{
        question: string;
        comment: string;
        score: number | null;
        created_at: string | Date;
      }>(comments)
        .filter((r) => r.question === question.id)
        .map((r) => ({
          text: r.comment,
          score: r.score === null ? null : Number(r.score),
          at: new Date(r.created_at).toISOString(),
        })),
    };
  });

  return {
    sessions: Number(rowsOf<{ n: number | string }>(sessionsResult)[0]?.n ?? 0),
    questions,
  };
}

function npsFrom(distribution: { value: number; count: number }[]): NpsBreakdown {
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const { value, count } of distribution) {
    if (value >= 9) promoters += count;
    else if (value >= 7) passives += count;
    else detractors += count;
  }
  const responses = promoters + passives + detractors;
  return {
    responses,
    promoters,
    passives,
    detractors,
    score:
      responses > 0
        ? Math.round((promoters / responses) * 100 - (detractors / responses) * 100)
        : null,
  };
}

/* --------------------------------------------------------------- sessions */

export interface SurveySessionAnswer {
  score: number | null;
  choice: string | null;
  choices: string[] | null;
  comment: string | null;
}

export interface SurveySession {
  sessionId: string;
  contactId: string | null;
  email: string | null;
  name: string | null;
  /** When the first answer in the session was given. */
  at: string;
  answers: Record<string, SurveySessionAnswer>;
}

/** The most recent sessions, newest first, each with every answer it gave. */
export async function surveySessions(
  db: Db,
  surveyId: string,
  options: { from?: Date; limit?: number } = {},
): Promise<SurveySession[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 5000);
  const window = options.from
    ? sql`AND r.created_at >= ${options.from.toISOString()}::timestamptz`
    : sql``;
  const result = await db.execute(sql`
    WITH recent AS (
      SELECT coalesce(r.session_id, r.id) AS session, min(r.created_at) AS at
      FROM helpwell.survey_responses r
      WHERE r.survey_id = ${surveyId} ${window}
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT ${limit}
    )
    SELECT recent.session, recent.at, coalesce(r.question_id, ${LEGACY_QUESTION_ID}) AS question,
           r.score, r.choice, r.choices, r.comment, r.contact_id, c.email, c.name
    FROM recent
    JOIN helpwell.survey_responses r
      ON r.survey_id = ${surveyId} AND coalesce(r.session_id, r.id) = recent.session
    LEFT JOIN helpwell.contacts c ON c.id = r.contact_id
    ORDER BY recent.at DESC, r.created_at ASC
  `);

  const sessions = new Map<string, SurveySession>();
  for (const row of rowsOf<{
    session: string;
    at: string | Date;
    question: string;
    score: number | null;
    choice: string | null;
    choices: string[] | string | null;
    comment: string | null;
    contact_id: string | null;
    email: string | null;
    name: string | null;
  }>(result)) {
    const session = sessions.get(row.session) ?? {
      sessionId: row.session,
      contactId: row.contact_id,
      email: row.email,
      name: row.name,
      at: new Date(row.at).toISOString(),
      answers: {},
    };
    session.answers[row.question] = {
      score: row.score === null ? null : Number(row.score),
      choice: row.choice,
      choices: typeof row.choices === 'string' ? JSON.parse(row.choices) : row.choices,
      comment: row.comment,
    };
    sessions.set(row.session, session);
  }
  return [...sessions.values()];
}

/**
 * Sessions as CSV: one row per session, a column per question and one per
 * follow-up comment. Cells that a spreadsheet would run as a formula are
 * quoted with a leading apostrophe.
 */
export function surveySessionsCsv(
  survey: Pick<SurveyEngagement, 'survey'>,
  sessions: readonly SurveySession[],
): string {
  const questions = survey.survey.questions;
  const header = ['session', 'answered_at', 'contact_id', 'email', 'name'];
  for (const q of questions) {
    header.push(q.id);
    if (q.kind !== 'text' && q.followUp.enabled) header.push(`${q.id}_comment`);
  }
  const lines = [header.map(csvCell).join(',')];
  for (const session of sessions) {
    const row: (string | number | null)[] = [
      session.sessionId,
      session.at,
      session.contactId,
      session.email,
      session.name,
    ];
    for (const q of questions) {
      const answer = session.answers[q.id];
      const value =
        answer === undefined
          ? null
          : SCALES[q.kind]
            ? answer.score
            : q.kind === 'text'
              ? answer.comment
              : q.kind === 'multi'
                ? (answer.choices ?? []).join('; ')
                : answer.choice;
      row.push(value);
      if (q.kind !== 'text' && q.followUp.enabled) row.push(answer?.comment ?? null);
    }
    lines.push(row.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/* ------------------------------------------------------------ legacy view */

export interface NpsSummary extends NpsBreakdown {
  comments: Array<{ score: number | null; comment: string; at: Date }>;
}

/**
 * Every NPS answer given to one survey id, whichever question it was, with
 * the most recent comments. What `/admin/reports/engage` has always served.
 */
export async function npsSummary(db: Db, surveyId: string, from?: Date): Promise<NpsSummary> {
  const window = since(from);
  const result = await db.execute(sql`
    SELECT score, count(*) AS n
    FROM helpwell.survey_responses
    WHERE survey_id = ${surveyId} AND kind = 'nps' AND score IS NOT NULL ${window}
    GROUP BY score
  `);
  const distribution = rowsOf<{ score: number; n: number | string }>(result).map((r) => ({
    value: Number(r.score),
    count: Number(r.n),
  }));

  const commentResult = await db.execute(sql`
    SELECT score, comment, created_at
    FROM helpwell.survey_responses
    WHERE survey_id = ${surveyId} AND comment IS NOT NULL AND comment <> '' ${window}
    ORDER BY created_at DESC
    LIMIT 50
  `);

  return {
    ...npsFrom(distribution),
    comments: rowsOf<{ score: number | null; comment: string; created_at: string | Date }>(
      commentResult,
    ).map((c) => ({ score: c.score, comment: c.comment, at: new Date(c.created_at) })),
  };
}
