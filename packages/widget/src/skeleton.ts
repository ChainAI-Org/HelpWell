/**
 * The transitions.dev skeleton loader, taken from the tokens package with its
 * custom properties declared on `:host` rather than `:root`, because `:root`
 * does not exist inside a Shadow DOM. The shapes below are HelpWell's own.
 *
 * Used only where something genuinely waits on the network: an article body,
 * the first page of the changelog, the roadmap board. A view that already has
 * its data renders immediately and never flashes a skeleton.
 */

import { skeletonCss } from '@helpwell/tokens';

export const SKELETON_CSS = `
${skeletonCss(':host')}
/* HelpWell's own skeleton shapes, drawn with the widget's tokens. */
.sk-bar {
  height: 11px;
  border-radius: 999px;
  background: var(--hw-hairline);
  margin-bottom: 9px;
}
.sk-bar--title { height: 17px; width: 62%; margin-bottom: 14px; }
.sk-bar--short { width: 45%; }
.sk-bar--mid { width: 78%; }
.sk-card {
  height: 62px;
  border-radius: 14px;
  background: var(--hw-hairline);
  margin-bottom: 8px;
}
`;

/**
 * Wire a skeleton to the thing it is standing in for.
 *
 * The two layers are absolutely positioned on top of each other, so the
 * wrapper needs a height while the skeleton is showing and must let the real
 * content size it afterwards. Returns a `reveal()` to call when data lands.
 */
export function skeletonSwap(
  wrap: HTMLElement,
  skeleton: HTMLElement,
  content: HTMLElement,
): () => void {
  wrap.classList.add('t-skel');
  skeleton.classList.add('t-skel-skeleton', 'is-pulsing');
  content.classList.add('t-skel-content');
  wrap.append(skeleton, content);
  wrap.style.minHeight = `${skeleton.offsetHeight || 160}px`;

  return () => {
    wrap.classList.add('is-revealed');
    // Once the cross-fade has run, let the real content drive layout again.
    setTimeout(() => {
      if (!wrap.isConnected) return;
      skeleton.remove();
      content.classList.remove('t-skel-content');
      content.style.position = 'static';
      wrap.classList.remove('t-skel', 'is-revealed');
      wrap.style.minHeight = '';
    }, 420);
  };
}
