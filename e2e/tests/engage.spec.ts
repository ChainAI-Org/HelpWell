/**
 * Engagements, defined in Settings the way the dashboard's editor writes
 * them, then met by a visitor: a carousel, a tour that waits for a click, and
 * a survey whose second question depends on the first answer.
 *
 * Each test replaces the whole list with the one engagement it is about, so
 * nothing else competes for the screen, and the fixtures put the baseline
 * (engagements off) back afterwards.
 */

import { type AdminApi, expect, type SettingsControl, test } from '../fixtures';
import { controlContrast } from '../support/contrast';

const text = (markdown: string) => ({ type: 'text', markdown });

/** On, with no global cap, holding only `engagement`. */
function only(settings: SettingsControl, engagement: Record<string, unknown>) {
  return settings.patch({
    engage: {
      enabled: true,
      limits: { perSession: 0, perDay: 0, minMinutesBetween: 0 },
      engagements: [engagement],
    },
  });
}

/** Shown on every page view, first in line, on one path. */
function onPage(path: string) {
  return {
    enabled: true,
    triggers: [{ type: 'load' }],
    frequency: 'always',
    priority: 100,
    targeting: { audience: 'all', pages: { include: [path], exclude: [] } },
  };
}

async function completions(admin: AdminApi, id: string): Promise<number> {
  const results = await admin.get<{ stats: { completed: number } }>(`/admin/engage/${id}/results`);
  return results.stats.completed;
}

test('a three-slide modal steps forward and back, and records the visitor finishing it', async ({
  admin,
  page,
  settings,
}) => {
  await only(settings, {
    id: 'e2e-carousel',
    kind: 'modal',
    name: "What's new, for the suite",
    ...onPage('/pricing'),
    modal: {
      size: 'medium',
      progress: 'dots',
      slides: [
        { blocks: [text('## Tiered mileage rates\n\nOne rate to the threshold, another after.')] },
        { blocks: [text('## Receipts by email\n\nForward a receipt and it files itself.')] },
        { blocks: [text('## Per-diem allowances\n\nBy destination, on Business.')] },
      ],
    },
  });
  const before = await completions(admin, 'e2e-carousel');

  await page.goto('/pricing');
  const modal = page.locator('helpwell-engage .modal');
  const slide = modal.locator('.modal__slide:not([hidden])');
  const dots = modal.getByRole('button', { name: /^Slide \d of 3$/ });
  const back = modal.getByRole('button', { name: 'Back' });
  const next = modal.getByRole('button', { name: 'Next' });

  await expect(slide).toContainText('Tiered mileage rates');
  await expect(dots).toHaveCount(3);
  await expect(dots.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(back).toBeHidden();

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await next.hover();
    await expect.poll(() => controlContrast(next)).toBeGreaterThanOrEqual(4.5);
  }
  await page.emulateMedia({ colorScheme: 'light' });

  await next.click();
  await expect(slide).toContainText('Receipts by email');
  await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');

  await back.click();
  await expect(slide).toContainText('Tiered mileage rates');

  await next.click();
  await next.click();
  await expect(slide).toContainText('Per-diem allowances');
  const completed = page.waitForRequest(
    (request) =>
      request.url().includes('/engage/e2e-carousel/impression') &&
      request.postDataJSON()?.state === 'completed',
  );
  await modal.getByRole('button', { name: 'Done' }).click();
  await completed;
  await expect(page.locator('helpwell-engage .modal')).toHaveCount(0);

  await expect.poll(() => completions(admin, 'e2e-carousel')).toBe(before + 1);
});

test('a tour step that waits for a click moves on when the visitor clicks the target', async ({
  admin,
  page,
  settings,
}) => {
  await only(settings, {
    id: 'e2e-tour',
    kind: 'tour',
    name: 'First expense, for the suite',
    ...onPage('/'),
    tour: {
      placement: 'auto',
      spotlight: true,
      showProgress: true,
      allowSkip: true,
      steps: [
        {
          target: '[data-tour="new-expense"]',
          placement: 'bottom',
          advance: 'click',
          blocks: [text('**File anything from here.** Press New expense to carry on.')],
        },
        {
          target: '[data-tour="status"]',
          placement: 'bottom',
          advance: 'next',
          blocks: [text('**Status is the whole story.**')],
        },
      ],
    },
  });
  const before = await completions(admin, 'e2e-tour');

  await page.goto('/');
  const step = page.locator('helpwell-engage .tourPop');
  await expect(step).toContainText('File anything from here.');
  await expect(step.locator('.tourPop__count')).toHaveText('1 of 2');
  await expect(step).toContainText('Click the highlighted element to continue.');
  // Waiting for the click means there is nothing to press but the target.
  await expect(step.getByRole('button', { name: /^(Next|Finish)$/ })).toHaveCount(0);

  // The page's own button, under the spotlight.
  await page.locator('[data-tour="new-expense"]').click();
  await expect(step).toContainText('Status is the whole story.');
  await expect(step.locator('.tourPop__count')).toHaveText('2 of 2');

  await step.getByRole('button', { name: 'Finish' }).click();
  await expect(page.locator('helpwell-engage .tourPop')).toHaveCount(0);
  await expect.poll(() => completions(admin, 'e2e-tour')).toBe(before + 1);
});

/** Business customers are asked to score it; everyone else, what would move them. */
const PLAN_SURVEY = {
  id: 'e2e-plan-survey',
  kind: 'survey',
  name: 'Plan survey, for the suite',
  ...onPage('/settings'),
  survey: {
    placement: 'center',
    theme: 'brand',
    questions: [
      {
        id: 'plan',
        kind: 'single',
        prompt: 'Which plan are you on?',
        choices: ['Team', 'Business'],
        branches: [{ choices: ['Business'], goto: 'business_score' }],
      },
      {
        id: 'team_move',
        kind: 'text',
        prompt: 'What would make you move to Business?',
        next: 'end',
      },
      {
        id: 'business_score',
        kind: 'nps',
        prompt: 'How likely are you to recommend Ridgeline Business?',
      },
    ],
    thankYou: [text('Thank you for telling us.')],
  },
};

interface SurveyResponses {
  items: {
    answers: Record<string, { choice?: string | null; score?: number | null; comment?: string }>;
  }[];
}

test('a survey branches on the first answer: Business is asked for a score', async ({
  admin,
  page,
  settings,
}) => {
  await only(settings, PLAN_SURVEY);
  await page.goto('/settings');

  const survey = page.locator('helpwell-engage .survey');
  await expect(survey.locator('.survey__q')).toHaveText('Which plan are you on?');
  await survey.getByRole('button', { name: 'Business' }).click();

  // Straight to the score: the question for Team is skipped.
  await expect(survey.locator('.survey__q')).toHaveText(
    'How likely are you to recommend Ridgeline Business?',
  );
  await survey.getByRole('button', { name: '9 out of 10' }).click();
  await expect(survey).toContainText('Thank you for telling us.');

  const { items } = await admin.get<SurveyResponses>('/admin/engage/e2e-plan-survey/responses');
  const answers = items[0]?.answers ?? {};
  expect(answers.plan?.choice).toBe('Business');
  expect(answers.business_score?.score).toBe(9);
  expect(answers.team_move).toBeUndefined();
});

test('a survey branches on the first answer: Team is asked what would move them', async ({
  admin,
  page,
  settings,
}) => {
  await only(settings, PLAN_SURVEY);
  await page.goto('/settings');

  const survey = page.locator('helpwell-engage .survey');
  await survey.getByRole('button', { name: 'Team' }).click();

  await expect(survey.locator('.survey__q')).toHaveText('What would make you move to Business?');
  await survey.locator('textarea.survey__comment').fill('Approvals from Slack.');
  await survey.getByRole('button', { name: 'Next' }).click();
  // `next: end`: the score question never comes.
  await expect(survey).toContainText('Thank you for telling us.');

  const { items } = await admin.get<SurveyResponses>('/admin/engage/e2e-plan-survey/responses');
  const answers = items[0]?.answers ?? {};
  expect(answers.plan?.choice).toBe('Team');
  expect(answers.team_move?.comment).toBe('Approvals from Slack.');
  expect(answers.business_score).toBeUndefined();
});
