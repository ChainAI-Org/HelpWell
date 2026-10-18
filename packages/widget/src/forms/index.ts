/**
 * Forms in the widget: the renderer every placement and the dashboard's
 * preview share (render.ts), where each placement sits (surfaces.ts), and
 * the runtime that finds embeds, arms triggers and talks to the API
 * (runtime.ts).
 */

export { normalizeForm } from './normalize.js';
export {
  type DrawnForm,
  drawForm,
  type FormHost,
  referralLink,
  shareUrl,
  validate,
} from './render.js';
export { type Forms, type FormsListener, type FormsOptions, mountForms } from './runtime.js';
export { FORM_CSS } from './styles.js';
export type {
  EntryState,
  FormField,
  FormPlacement,
  FormSubmitEvent,
  SubmitResult,
  WidgetForm,
} from './types.js';
