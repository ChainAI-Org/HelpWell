/**
 * The Home tab.
 *
 * One job: get the visitor to the answer in as few taps as possible. By
 * default that is search first, then the conversation they already have open,
 * then a way to start a new one, then what changed recently, then the
 * product's status. Settings can reorder those and add others
 * (`widget.home.blocks`); see home-blocks.ts.
 *
 * When Settings has a support email and no support extension answers people,
 * a quiet "Email us at …" line sits under the links block, or at the foot of
 * Home when there is none: the way to reach a person, where people look for
 * one.
 */

import type { ViewContext } from '../context.js';
import { h } from '../dom.js';
import { page } from './common.js';
import { DEFAULT_HOME_BLOCKS, renderHomeBlock } from './home-blocks.js';
import { supportEmailLine, supportEmailOf } from './support-email.js';

export { searchBox } from './home-blocks.js';

export function homeView(context: ViewContext): HTMLElement {
  const configured = context.state.config?.widget.home?.blocks;
  // An older server sends no blocks at all: Home as it always was.
  const blocks = Array.isArray(configured) ? configured : DEFAULT_HOME_BLOCKS;
  const drawn = blocks.map((block) => renderHomeBlock(block, context));

  const email = supportEmailOf(context.state.config);
  if (email) {
    // Under the last links block that drew anything, or at the foot.
    let underLinks = -1;
    drawn.forEach((node, index) => {
      if (node && blocks[index]?.type === 'links') underLinks = index;
    });
    const line = supportEmailLine(email, underLinks === -1 ? 'supportEmail--home' : '');
    drawn.splice(
      underLinks === -1 ? drawn.length : underLinks + 1,
      0,
      h('div', { class: 'section section--tight' }, line),
    );
  }

  return page(...drawn);
}
