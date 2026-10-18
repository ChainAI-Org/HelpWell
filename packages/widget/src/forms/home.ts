/**
 * The Home tab's `form` block (`widget.home.blocks: [{ type: 'form', formId }]`).
 *
 * Registered once, when the widget's code loads, through WP3's
 * `registerHomeBlock` seam, so a host app that registers its own `form`
 * renderer afterwards replaces this one, as the seam promises. It draws with
 * whichever forms runtime the mounted widget started; with none, nothing.
 */

import { registerHomeBlock } from '../components/home-blocks.js';
import type { Forms } from './runtime.js';

let active: Forms | null = null;

/** The runtime Home blocks draw with, or null when the widget goes. */
export function useFormsForHome(forms: Forms | null): void {
  active = forms;
}

export function formsForHome(): Forms | null {
  return active;
}

registerHomeBlock('form', (block, context) => {
  const id = (block as { formId?: unknown }).formId;
  if (!active || typeof id !== 'string' || !id.trim()) return null;
  return active.homeBlock(id.trim(), context.signal);
});
