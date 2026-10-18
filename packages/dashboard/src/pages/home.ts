/**
 * "Get set up": the first-run page.
 *
 * Eight steps, each with its status worked out from the install
 * (checklist.ts), what to do in a sentence, and the same instructions as a
 * prompt for ChatGPT, Claude or a coding agent, because many people will hand
 * setup to one. Every prompt is filled in with what this install knows (the
 * API's path, the product's name, the docs folder) and carries no secret.
 *
 * The page is the dashboard's front door until every required step is done.
 * After that it can be put away, and the rail stops showing it.
 */

import {
  docsPromptSpec,
  firstAnswerPromptSpec,
  identitySigningPromptSpec,
  loaderUrls,
  mcpSetupPromptSpec,
  modelKeyPromptSpec,
  searchIndexPromptSpec,
  WIDGET_FRAMEWORKS,
  type WidgetFramework,
  webhookReceiverPromptSpec,
  widgetInstallPromptSpec,
} from '@helpwell/core';
import type { Db } from '@helpwell/core/db';
import { checklistState, updateChecklistState } from '@helpwell/core/repos';
import type { Settings } from '@helpwell/core/settings';
import { html, icon, join, type RawHtml, raw } from '@helpwell/ui';
import {
  type ChecklistStep,
  checklistComplete,
  checklistSteps,
  gatherFacts,
  OPTIONAL_STEPS,
  type SetupFacts,
  type StepKey,
} from '../checklist.js';
import { button, formatDate, notice, pill, relativeTime, segment } from '../components.js';
import { managedContent } from '../content-mode.js';
import type { DashboardContext } from '../layout.js';
import { hasModelKey, secretStatus } from '../model.js';
import { htmlPage, redirect } from '../respond.js';
import type { DashboardConfig } from '../server.js';
import { setupPromptPanel } from '../setup-prompt.js';

export function isWidgetFramework(value: string | null): value is WidgetFramework {
  return WIDGET_FRAMEWORKS.some((framework) => framework.key === value);
}

export interface HomeView {
  steps: ChecklistStep[];
  facts: SetupFacts;
  /** The origin the dashboard was reached on, for absolute URLs in the prompts. */
  origin: string | null;
  framework: WidgetFramework;
}

export function homePage(context: DashboardContext, settings: Settings, view: HomeView): RawHtml {
  const required = view.steps.filter((step) => !step.optional);
  const done = required.filter((step) => step.status === 'done').length;
  const complete = checklistComplete(view.steps);
  const base = `${context.basePath}/home`;

  return html`
${
  view.facts.dismissedAt
    ? notice(
        'info',
        html`Put away ${formatDate(view.facts.dismissedAt, context)}, so the rail no longer shows it.`,
        html`<form method="post" action="${base}"><input type="hidden" name="action" value="restore">${button('Bring it back')}</form>`,
      )
    : complete
      ? notice(
          'good',
          'Everything HelpWell needs is done. The optional steps are there whenever you want them.',
          html`<form method="post" action="${base}"><input type="hidden" name="action" value="dismiss">${button('Put the checklist away', { glyph: 'check' })}</form>`,
        )
      : null
}

<section class="db-card db-setup__progress">
  <div class="db-setup__count">
    <strong class="db-nums">${String(done)} of ${String(required.length)}</strong>
    <span class="db-muted">required steps done</span>
  </div>
  <progress max="${String(required.length)}" value="${String(done)}" aria-label="Setup progress"></progress>
  <p class="db-card__hint" style="margin:10px 0 0">Each step checks itself: do it, then reload this page. Every step also has instructions to hand to an AI assistant. They contain no keys or passwords.</p>
</section>

<ol class="db-setup">
  ${join(view.steps.map((step, index) => stepBlock(context, settings, view, step, index + 1)))}
</ol>`;
}

function stepBlock(
  context: DashboardContext,
  settings: Settings,
  view: HomeView,
  step: ChecklistStep,
  number: number,
): RawHtml {
  const status =
    step.status === 'done'
      ? pill('good', html`${raw(icon('check', 12))} Done`)
      : step.status === 'partial'
        ? pill('warn', 'Nearly')
        : step.optional
          ? pill('neutral', 'Optional')
          : pill('info', 'To do');
  return html`<li class="db-step" data-step="${step.key}" data-status="${step.status}">
  <div class="db-step__head">
    <span class="db-step__number db-nums" aria-hidden="true">${step.status === 'done' ? raw(icon('check', 14)) : String(number)}</span>
    <div class="db-step__text">
      <h2 class="db-step__title">${step.title}</h2>
      <p class="db-step__detail">${step.detail}</p>
    </div>
    ${status}
  </div>
  ${step.status === 'done' && !step.optional ? null : stepBody(context, settings, view, step)}
  ${step.status === 'done' && !step.optional ? html`<details class="db-step__again"><summary>Instructions</summary>${stepBody(context, settings, view, step)}</details>` : null}
  ${OPTIONAL_STEPS.includes(step.key) ? markForm(context, step) : null}
</li>`;
}

function markForm(context: DashboardContext, step: ChecklistStep): RawHtml | null {
  if (step.status === 'done' && !step.manual) return null;
  return html`<form method="post" action="${context.basePath}/home" class="db-step__mark">
  <input type="hidden" name="action" value="${step.manual ? 'undo' : 'mark'}">
  <input type="hidden" name="step" value="${step.key}">
  ${button(step.manual ? 'Not done after all' : step.key === 'mcp' ? 'Mark done' : 'Skip, or mark done', {})}
</form>`;
}

function stepBody(
  context: DashboardContext,
  settings: Settings,
  view: HomeView,
  step: ChecklistStep,
): RawHtml {
  const options = {
    apiPath: context.apiPath,
    origin: view.origin,
    productName: settings.product.name,
    // What the site's CSP has to allow depends on what is switched on.
    inlineVideo: settings.widget.media.inlineVideo,
    botCheck: settings.agent.abuse.botCheck === 'turnstile',
  };
  const docsDir = view.facts.docsDir;

  switch (step.key) {
    case 'model-key':
      return html`<div class="db-step__body">
  <p>Create a key at <a href="https://openrouter.ai/keys" rel="noopener" target="_blank">openrouter.ai/keys</a>, set it as an environment variable where the app runs, and restart. Set a credit limit on the key while you are there.</p>
  <pre class="db-code">OPENROUTER_API_KEY=sk-or-...</pre>
  ${setupPromptPanel('model-key', modelKeyPromptSpec(options))}
</div>`;

    case 'content':
      if (managedContent(context)) {
        return html`<div class="db-step__body">
  <p>Write articles in the ${link(context, '/knowledge/new', 'knowledge base')}, one collection per topic. Each is saved there, and goes live in the help center and the agent once it is indexed.</p>
</div>`;
      }
      return html`<div class="db-step__body">
  <p>Articles are Markdown files in <code>${docsDir}/</code>, one folder per collection. Write one in the ${link(context, '/knowledge/new', 'knowledge base')}, draft a set from your code with <code>npx helpwell docs generate</code>, or bring them over with <code>npx helpwell import</code>.</p>
  ${setupPromptPanel('docs', docsPromptSpec({ ...options, docsDir }))}
</div>`;

    case 'index':
      if (managedContent(context)) {
        return html`<div class="db-step__body">
  <p>There is nothing to run: saving an article indexes it for search and for the agent.</p>
</div>`;
      }
      return html`<div class="db-step__body">
  <p>Run <code>npx helpwell sync</code> from the repo root, and again whenever the docs change, ideally from your deploy.</p>
  ${setupPromptPanel('search-index', searchIndexPromptSpec({ ...options, docsDir }))}
</div>`;

    case 'widget': {
      const urls = loaderUrls(options);
      const base = `${context.basePath}/home`;
      return html`<div class="db-step__body">
  <p>One script tag on every page of your site. It waits for the page to load before it fetches anything.</p>
  <pre class="db-code">&lt;script src="${urls.path}" defer&gt;&lt;/script&gt;</pre>
  ${urls.absolute && urls.absolute !== urls.path ? html`<p class="db-field__hint">From a site on another domain: <code>${urls.absolute}</code></p>` : null}
  <p class="db-field__label" style="margin-top:14px">Your site is built with</p>
  ${segment(
    WIDGET_FRAMEWORKS.map((framework) => ({
      label: framework.label,
      href: `${base}?framework=${framework.key}#step-widget`,
      current: framework.key === view.framework,
    })),
  )}
  <div id="step-widget">${setupPromptPanel(`widget-${view.framework}`, widgetInstallPromptSpec(view.framework, options))}</div>
  ${
    view.facts.widget
      ? html`<p class="db-field__hint">First seen ${relativeTime(view.facts.widget.firstSeenAt, context)}${
          view.facts.widget.firstPage ? html` on <code>${view.facts.widget.firstPage}</code>` : null
        }.</p>`
      : null
  }
</div>`;
    }

    case 'identity':
      return html`<div class="db-step__body">
  <p>Your server signs a short-lived token for the signed-in person with <code>HELPWELL_IDENTITY_SECRET</code>, and the widget passes it on, so the agent knows who it is talking to and nobody can pretend to be someone else.</p>
  ${setupPromptPanel('identity', identitySigningPromptSpec(options))}
</div>`;

    case 'answer':
      return html`<div class="db-step__body">
  <p>Open your site, ask the widget something your docs cover, then read the answer and its citations in ${link(context, '/conversations', 'Conversations')}.</p>
  ${setupPromptPanel('first-answer', firstAnswerPromptSpec(options))}
</div>`;

    case 'webhooks':
      return html`<div class="db-step__body">
  <p>${
    managedContent(context)
      ? html`Add one on the ${link(context, '/webhooks', 'Webhooks')} page, which makes its signing secret, sends a test delivery and shows each attempt.`
      : html`Add a webhook to <code>helpwell.config.json</code> and run <code>npx helpwell sync</code>. ${link(context, '/webhooks', 'Webhooks')} sends a test delivery and shows each attempt.`
  }</p>
  ${setupPromptPanel(
    'webhooks',
    webhookReceiverPromptSpec({
      productName: settings.product.name,
      managed: managedContent(context),
    }),
  )}
</div>`;

    case 'mcp':
      return html`<div class="db-step__body">
  <p>The MCP server lets Claude Code, Claude Desktop or Cursor search your docs, read gaps, write articles and run evals.</p>
  <pre class="db-code">claude mcp add helpwell --scope project -- npx -y @helpwell/mcp</pre>
  ${setupPromptPanel('mcp', mcpSetupPromptSpec())}
</div>`;
  }
}

function link(context: DashboardContext, path: string, label: string): RawHtml {
  return html`<a class="db-link" href="${context.basePath}${path}">${label}</a>`;
}

/* ---------------------------------------------------------------- routes */

/** Whether the checklist has been put away. */
export async function setupDismissed(db: Db): Promise<boolean> {
  return (await checklistState(db)).dismissedAt !== null;
}

/** Where the dashboard's root goes: the checklist until it is put away. */
export function rootLocation(basePath: string, dismissed: boolean): string {
  return `${basePath}/${dismissed ? 'conversations' : 'home'}`;
}

async function facts(config: DashboardConfig, settings: Settings): Promise<SetupFacts> {
  return gatherFacts(config.db, settings, {
    modelKey: hasModelKey(config),
    identitySecret: secretStatus(config).identity,
    docsDir: config.docsDir,
    content: config.content,
    contentMode: config.contentMode,
  });
}

export async function homeScreen(
  config: DashboardConfig,
  context: DashboardContext,
  url: URL,
  settings: Settings,
): Promise<Response> {
  const known = await facts(config, settings);
  const requested = url.searchParams.get('framework');
  return htmlPage(
    context,
    'home',
    {
      title: 'Get set up',
      subtitle: 'What HelpWell still needs, checked against your install.',
    },
    homePage(context, settings, {
      steps: checklistSteps(known),
      facts: known,
      origin: url.origin === 'null' ? null : url.origin,
      framework: isWidgetFramework(requested) ? requested : 'html',
    }),
  );
}

/** Put the checklist away or bring it back, or mark an optional step. */
export async function homePost(
  config: DashboardConfig,
  context: DashboardContext,
  request: Request,
  settings: Settings,
): Promise<Response> {
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const step = String(form.get('step') ?? '') as StepKey;
  const back = `${context.basePath}/home`;

  if (action === 'dismiss') {
    // Only a finished checklist goes away: an unfinished one is the point.
    if (!checklistComplete(checklistSteps(await facts(config, settings)))) return redirect(back);
    await updateChecklistState(config.db, { dismissed: true });
    return redirect(`${context.basePath}/conversations`);
  }
  if (action === 'restore') {
    await updateChecklistState(config.db, { dismissed: false });
    return redirect(back);
  }
  if ((action === 'mark' || action === 'undo') && OPTIONAL_STEPS.includes(step)) {
    await updateChecklistState(config.db, { done: { key: step, value: action === 'mark' } });
  }
  return redirect(back);
}
