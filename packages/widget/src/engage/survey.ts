/**
 * Surveys: up to twenty questions, with branching.
 *
 * NPS (0-10), CSAT (1-5), a star rating, single and multiple choice, and free
 * text. Each answer is sent the moment it is given, so a visitor who stops
 * half way still counts for what they answered; all of one pass share a
 * session id. A score question can ask a follow-up comment, of detractors or
 * of everyone, after the score rather than beside it, so the first thing
 * asked is always a single tap. The thank-you is blocks, like everything else.
 *
 * A card in the corner by default, or a dialog in the middle of the page.
 */

import { h, replace, svg } from '../dom.js';
import { focusFirst, focusSelf, trapTab } from '../focus.js';
import { icons } from '../icons.js';
import { renderBlocks } from './blocks.js';
import { type EngageHost, leave, type ShowOptions, type Surface } from './shared.js';
import { type Answer, nextQuestion, scaleOf, wantsFollowUp } from './survey-flow.js';
import type { EngageButton, SurveyEngagement, SurveyQuestion } from './types.js';

const STAR =
  '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="m12 3.2 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/></svg>';

const LEGENDS: Record<string, [string, string]> = {
  nps: ['Not likely', 'Very likely'],
  csat: ['Poor', 'Great'],
};

/** How long the thank-you stays before the card goes on its own. */
export const THANKS_MS = 4000;

export async function showSurvey(
  host: EngageHost,
  engagement: SurveyEngagement,
  options: ShowOptions,
): Promise<Surface | null> {
  const { questions, placement, theme } = engagement.survey;
  if (questions.length === 0 || !(await options.claim())) {
    options.done();
    return null;
  }

  const session = newSession();
  const center = placement === 'center';
  const outer = h('div', {
    class: center ? 'scrim' : placement === 'bar' ? 'surveyWrap surveyWrap--bar' : 'surveyWrap',
  });
  const card = h('div', {
    class: `survey survey--${placement} survey--${theme}`,
    role: 'dialog',
    'aria-label': questions[0]?.prompt || 'Survey',
    ...(center ? { 'aria-modal': 'true' } : {}),
  });
  const body = h('div', { class: 'survey__body' });
  const progress = h('div', { class: 'survey__progress', 'aria-hidden': 'true' }, h('i'));
  card.append(questions.length > 1 ? progress : '', body);

  /** No more questions, and nothing more recorded. */
  let finished = false;
  /** The orchestrator has been told it is gone, so the next one may show. */
  let released = false;
  let answered = false;
  let asked = 0;
  const before = document.activeElement as HTMLElement | null;

  const release = () => {
    if (released) return;
    released = true;
    options.done();
  };
  const finish = () => {
    if (finished) return false;
    finished = true;
    document.removeEventListener('keydown', onKey);
    if (center && before?.isConnected) before.focus();
    return true;
  };
  const dismiss = () => {
    if (finish()) host.dismiss(engagement.id, outer);
    release();
  };
  /** Gone without a record: after the thanks, or taken away by code. */
  const goAway = () => {
    finish();
    leave(outer);
    release();
  };

  const onKey = (event: KeyboardEvent) => {
    if (
      event.key === 'Escape' &&
      engagement.dismissible &&
      card.contains(host.root.activeElement)
    ) {
      dismiss();
    } else if (center && event.key === 'Tab') {
      trapTab(event, card, host.root.activeElement);
    }
  };

  if (engagement.dismissible) {
    const close = h('button', { class: 'engage-close', type: 'button', 'aria-label': 'Dismiss' });
    close.appendChild(svg(icons.close));
    close.addEventListener('click', () => {
      // After the thanks it simply goes; before, closing it is a dismissal.
      if (finished) goAway();
      else dismiss();
    });
    card.appendChild(close);
  }

  const onButton = (button: EngageButton) => {
    if (button.action === 'dismiss') {
      if (finished) goAway();
      else dismiss();
      return;
    }
    if (button.action === 'next') return;
    host.record(engagement.id, 'clicked');
    host.act(button.action, button.value, button.newTab);
  };

  /* ------------------------------------------------------------- asking */

  const ask = (index: number) => {
    const question = questions[index];
    if (!question) {
      thanks();
      return;
    }
    asked++;
    const bar = progress.firstElementChild as HTMLElement | null;
    if (bar) bar.style.width = `${Math.round((index / questions.length) * 100)}%`;
    card.setAttribute('aria-label', question.prompt || 'Survey');

    const problem = h('p', { class: 'survey__error', role: 'alert' });
    const controls: HTMLButtonElement[] = [];
    const busy = (on: boolean) => {
      for (const control of controls) {
        if (on) control.setAttribute('disabled', '');
        else control.removeAttribute('disabled');
      }
    };

    const send = async (answer: Answer | null) => {
      if (answer) {
        busy(true);
        problem.textContent = '';
        try {
          await host.answer(engagement.id, {
            session,
            questionId: question.id,
            kind: question.kind,
            ...answer,
          });
          answered = true;
        } catch {
          // The answer is still there; the buttons come back so they can try
          // again, and nothing is recorded as though they gave up.
          problem.textContent = 'That did not send. Try again?';
          busy(false);
          return;
        }
      }
      const next = nextQuestion(questions, index, answer);
      if (next === 'end') thanks();
      else ask(next);
    };

    const answer = (value: Answer) => {
      if (wantsFollowUp(question, value)) followUp(question, value, send);
      else void send(value);
    };

    const parts: (HTMLElement | null)[] = [];
    if (asked === 1 && engagement.survey.intro.length > 0) {
      parts.push(renderBlocks(engagement.survey.intro, { onButton }));
    }
    parts.push(h('p', { class: 'survey__q', text: question.prompt }));
    parts.push(questionInput(question, answer, controls));
    parts.push(problem);
    if (!question.required) {
      const skip = h('button', {
        class: 'engage-ghost survey__skip',
        type: 'button',
        text: 'Skip',
      });
      skip.addEventListener('click', () => void send(null));
      controls.push(skip);
      parts.push(h('div', { class: 'survey__actions' }, skip));
    }
    replace(body, ...parts);
    focusFirst(body);
  };

  /** The comment box after a score. Sent together with the score, as one answer. */
  const followUp = (
    question: SurveyQuestion,
    value: Answer,
    send: (answer: Answer | null) => Promise<void>,
  ) => {
    const comment = h('textarea', {
      class: 'survey__comment',
      rows: '3',
      placeholder: question.followUp.prompt,
      'aria-label': question.followUp.prompt || 'Your comment',
      maxlength: '2000',
    });
    const sendButton = h('button', { class: 'engage-primary', type: 'button', text: 'Send' });
    const skip = h('button', { class: 'engage-ghost', type: 'button', text: 'Skip' });
    const problem = h('p', { class: 'survey__error', role: 'alert' });
    const submit = async (withComment: boolean) => {
      sendButton.setAttribute('disabled', '');
      skip.setAttribute('disabled', '');
      problem.textContent = '';
      const text = comment.value.trim();
      await send({ ...value, ...(withComment && text ? { comment: text } : {}) });
      // Still here means it failed: send() has shown nothing, so say so.
      if (!finished && body.contains(comment)) {
        problem.textContent = 'That did not send. Try again?';
        sendButton.removeAttribute('disabled');
        skip.removeAttribute('disabled');
      }
    };
    sendButton.addEventListener('click', () => void submit(true));
    skip.addEventListener('click', () => void submit(false));
    replace(
      body,
      h('p', { class: 'survey__q', text: question.followUp.prompt }),
      comment,
      problem,
      h('div', { class: 'survey__actions' }, skip, sendButton),
    );
    comment.focus();
  };

  const thanks = () => {
    if (!finish()) return;
    const bar = progress.firstElementChild as HTMLElement | null;
    if (bar) bar.style.width = '100%';
    if (answered) host.record(engagement.id, 'completed');
    replace(
      body,
      h('div', { class: 'survey__thanks' }, renderBlocks(engagement.survey.thankYou, { onButton })),
    );
    focusSelf(card);
    const timer = setTimeout(goAway, THANKS_MS);
    host.onCleanup(() => clearTimeout(timer));
  };

  document.addEventListener('keydown', onKey);
  host.onCleanup(() => {
    finish();
    release();
  });

  outer.appendChild(card);
  host.layer.appendChild(outer);
  ask(0);
  if (!center) focusSelf(card);

  return { close: goAway };
}

/* ---------------------------------------------------------------- inputs */

function questionInput(
  question: SurveyQuestion,
  answer: (value: Answer) => void,
  controls: HTMLButtonElement[],
): HTMLElement {
  const scale = scaleOf(question.kind);
  if (question.kind === 'stars') {
    const row = h('div', { class: 'survey__stars', role: 'group', 'aria-label': question.prompt });
    for (let value = 1; value <= 5; value++) {
      const star = h('button', {
        class: 'survey__star',
        type: 'button',
        'aria-label': `${value} ${value === 1 ? 'star' : 'stars'}`,
        on: { click: () => answer({ score: value }) },
      });
      star.appendChild(svg(STAR));
      controls.push(star);
      row.appendChild(star);
    }
    return row;
  }

  if (scale) {
    const [from, to] = scale;
    const row = h('div', { class: 'survey__scale', role: 'group', 'aria-label': question.prompt });
    for (let value = from; value <= to; value++) {
      const button = h('button', {
        class: 'survey__score',
        type: 'button',
        text: String(value),
        'aria-label': `${value} out of ${to}`,
        on: { click: () => answer({ score: value }) },
      });
      controls.push(button);
      row.appendChild(button);
    }
    const [low, high] = LEGENDS[question.kind] ?? ['', ''];
    return h(
      'div',
      {},
      row,
      h(
        'div',
        { class: 'survey__legend' },
        h('span', { text: question.lowLabel || low }),
        h('span', { text: question.highLabel || high }),
      ),
    );
  }

  if (question.kind === 'single') {
    return h(
      'div',
      { class: 'survey__choices' },
      ...question.choices.map((choice) => {
        const button = h('button', {
          class: 'survey__choice',
          type: 'button',
          text: choice,
          on: { click: () => answer({ choice }) },
        });
        controls.push(button);
        return button;
      }),
    );
  }

  const next = h('button', { class: 'engage-primary', type: 'button', text: 'Next' });
  controls.push(next);

  if (question.kind === 'multi') {
    const picked = new Set<string>();
    const sync = () => {
      if (question.required && picked.size === 0) next.setAttribute('disabled', '');
      else next.removeAttribute('disabled');
    };
    const choices = h(
      'div',
      { class: 'survey__choices', role: 'group', 'aria-label': question.prompt },
      ...question.choices.map((choice) => {
        const button = h('button', {
          class: 'survey__choice',
          type: 'button',
          text: choice,
          'aria-pressed': 'false',
        });
        button.addEventListener('click', () => {
          if (picked.has(choice)) picked.delete(choice);
          else picked.add(choice);
          button.setAttribute('aria-pressed', String(picked.has(choice)));
          sync();
        });
        return button;
      }),
    );
    next.addEventListener('click', () => {
      if (picked.size > 0) answer({ choices: question.choices.filter((c) => picked.has(c)) });
    });
    sync();
    return h('div', {}, choices, h('div', { class: 'survey__actions' }, next));
  }

  // Free text.
  const text = h('textarea', {
    class: 'survey__comment',
    rows: '3',
    placeholder: question.placeholder,
    'aria-label': question.prompt || 'Your answer',
    maxlength: '2000',
  });
  const sync = () => {
    if (!text.value.trim()) next.setAttribute('disabled', '');
    else next.removeAttribute('disabled');
  };
  text.addEventListener('input', sync);
  next.addEventListener('click', () => {
    const value = text.value.trim();
    if (value) answer({ comment: value });
  });
  sync();
  return h('div', {}, text, h('div', { class: 'survey__actions' }, next));
}

function newSession(): string {
  try {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Some embedded browsers have crypto without randomUUID.
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
