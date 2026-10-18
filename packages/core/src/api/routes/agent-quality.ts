/**
 * Admin routes for judging the agent: running evals and drafting the article
 * a gap asks for.
 *
 * Both call the model on the install's own key, so both live behind
 * requireAdmin with everything else under /admin. Neither writes content: an
 * eval run is recorded (that is its point), and a gap draft comes back to the
 * caller to save, review or throw away.
 */

import { draftArticleFromGap } from '../../agent/gap-draft.js';
import { HelpWellError } from '../../errors.js';
import { type EvalCasesError, parseEvalCases } from '../../evals/cases.js';
import { casesFromLastRun, runEvalSuite } from '../../evals/run.js';
import type { RequestContext } from '../context.js';
import { agentModels, requireAdmin } from '../context.js';
import { json, type Router, readJson } from '../router.js';

export function agentQualityRoutes(router: Router<RequestContext>): Router<RequestContext> {
  /**
   * Draft an article for a gap with the writing model. Returns the draft and
   * writes nothing: the gap keeps its status until someone saves the article.
   */
  router.post('/admin/gaps/:id/draft', async ({ params, context }) => {
    requireAdmin(context);
    const model = context.model('docs');
    if (!model) {
      throw new HelpWellError('not_configured', 'No OpenRouter key is set.', {
        publicMessage: 'Drafting an article needs an OpenRouter key.',
      });
    }
    const body = hasJsonBody(context.request)
      ? await readJson<{ docsDir?: unknown }>(context.request)
      : {};
    return json(
      await draftArticleFromGap(context.db, params.id!, {
        model,
        settings: context.settings,
        docsDir: typeof body.docsDir === 'string' ? body.docsDir.slice(0, 200) : undefined,
      }),
    );
  });

  /**
   * Run evals with the configured model and record the run.
   *
   * The body may carry `cases` in the evals.json shape; without them, the
   * cases the most recent run used are run again, which is what a "run again"
   * button wants, since the server cannot read the repo. With no key the run
   * measures retrieval only, and says so in `mode`.
   */
  router.post('/admin/evals/run', async ({ context }) => {
    requireAdmin(context);
    const body = hasJsonBody(context.request)
      ? await readJson<{
          cases?: unknown;
          ref?: unknown;
          dryRun?: unknown;
          threshold?: unknown;
        }>(context.request)
      : {};

    let cases: ReturnType<typeof parseEvalCases>;
    try {
      cases =
        body.cases === undefined
          ? await casesFromLastRun(context.db)
          : parseEvalCases(body.cases, 'the request');
    } catch (error) {
      throw new HelpWellError('bad_request', (error as EvalCasesError).message);
    }
    if (cases.length === 0) {
      throw new HelpWellError('bad_request', 'No eval cases to run', {
        publicMessage:
          'There are no cases to run. Send some, or run `helpwell eval` once so there is a run to repeat.',
      });
    }

    const threshold = body.threshold;
    if (
      threshold !== undefined &&
      (typeof threshold !== 'number' ||
        !Number.isFinite(threshold) ||
        threshold < 0 ||
        threshold > 100)
    ) {
      throw new HelpWellError('bad_request', 'threshold must be a number from 0 to 100');
    }

    // With no model the run measures retrieval only, and says so in `mode`.
    const model = context.model('chat');
    return json(
      await runEvalSuite({
        db: context.db,
        settings: context.settings,
        cases,
        model,
        // Without a host's factory these are the chat port, as they always were.
        grader: context.model('grader') ?? undefined,
        models: context.config.modelFactory ? agentModels(context.model) : undefined,
        instructions: context.config.instructions,
        playbook: context.config.playbook,
        ref: typeof body.ref === 'string' ? body.ref.slice(0, 200) : null,
        dryRun: body.dryRun === true,
        threshold: threshold as number | undefined,
      }),
    );
  });

  return router;
}

function hasJsonBody(request: Request): boolean {
  return (request.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}
