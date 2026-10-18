/**
 * Where an install's content lives, and so what the dashboard says about saving it.
 *
 * Most installs keep their knowledge base in a repo: articles are Markdown
 * files the team owns, `helpwell sync` indexes them, the playbook and eval
 * cases are files beside them, and the pages say so, with the command for
 * each job. An install whose content is managed for it has no repo behind
 * the dashboard: articles, the playbook and settings are saved into a content
 * source the host provides, a save is the whole story, and there is no
 * terminal to run anything in. `contentMode: 'managed'` tells every page
 * which, so none of them sends someone to a repo, a config file or a command
 * that is not there.
 */

export type ContentMode = 'repo' | 'managed';

/** True when the dashboard's content has no repo behind it. */
export function managedContent(context: { contentMode?: ContentMode }): boolean {
  return context.contentMode === 'managed';
}

/** One piece of copy in its two versions: for a repo, and for managed content. */
export function byMode<T>(context: { contentMode?: ContentMode }, repo: T, managed: T): T {
  return managedContent(context) ? managed : repo;
}
