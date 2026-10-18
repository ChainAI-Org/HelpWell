/**
 * Is a form ready to go live? The checks the schema does not make.
 *
 * The same split as engagements (engage/check.ts): the schema only promises
 * a definition has the right shape, so a stored one can always be read. This
 * asks whether it is complete and makes sense (one email field, a coupon
 * action with a code, a giveaway with rules), and the dashboard and the admin
 * API run it before they save. Each problem carries the dotted path of the
 * field it is about, which is also that field's name in the editor.
 */

import { checkBlocks } from '../engage/check.js';
import { isSafeLink, isSafeMediaUrl } from '../engage/media.js';
import { FORM_FILE_REF } from './files.js';
import { FORM_ID, type FormDefinition } from './schema.js';

export interface FormProblem {
  /** Dotted path, e.g. `fields.2.options`. Empty: the form as a whole. */
  path: string;
  message: string;
}

const CHOICE_KINDS = new Set(['dropdown', 'radio']);

/**
 * Everything wrong with a form, or an empty list. `tours` are the engage
 * tours a "start a tour" button in its content may name.
 */
export function checkForm(
  definition: FormDefinition,
  options: { id?: string; tours?: readonly string[]; otherIds?: readonly string[] } = {},
): FormProblem[] {
  const problems: FormProblem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });

  if (options.id !== undefined) {
    if (!FORM_ID.test(options.id)) {
      add('id', 'Use lower-case letters, numbers and dashes, starting with a letter or number.');
    } else if (options.otherIds?.includes(options.id)) {
      add('id', 'Another form already uses this id.');
    }
  }

  /* ---------------------------------------------------------------- fields */

  const emails = definition.fields.filter((f) => f.kind === 'email');
  if (emails.length === 0) add('fields', 'A form needs an email field.');
  if (emails.length > 1) add('fields', 'Keep to one email field.');
  const seen = new Map<string, number>();
  definition.fields.forEach((field, i) => {
    const at = `fields.${i}`;
    if (seen.has(field.id)) add(`${at}.id`, 'Two fields share this id.');
    else seen.set(field.id, i);
    if (field.kind === 'email' && !field.required) {
      add(`${at}.required`, 'The email field is always required.');
    }
    if (CHOICE_KINDS.has(field.kind) && field.options.length < 2) {
      add(`${at}.options`, 'Give at least two choices, one per line.');
    }
    if (field.options.length !== new Set(field.options).size) {
      add(`${at}.options`, 'Each choice has to be different.');
    }
    if (field.kind === 'hidden') {
      if (!field.value && !field.capture) {
        add(`${at}.value`, 'A hidden field needs a value, or something to fill it from.');
      }
      if (field.capture === 'param' && !field.param) {
        add(`${at}.param`, 'Name the query parameter to read, e.g. plan.');
      }
    }
    if (field.kind === 'consent' && !field.label) {
      add(`${at}.label`, 'Write what they are agreeing to.');
    }
    if (field.kind !== 'hidden' && field.kind !== 'consent' && !field.label && !field.placeholder) {
      add(
        `${at}.label`,
        'Give the field a label or a placeholder, so people know what goes in it.',
      );
    }
  });

  /* --------------------------------------------------------------- content */

  const tours = new Set(options.tours ?? []);
  const blocks = (list: FormDefinition['content']['blocks'], path: string) =>
    checkBlocks(list, path, add, { tours, kind: 'banner' });
  blocks(definition.content.blocks, 'content.blocks');
  blocks(definition.content.footer, 'content.footer');
  blocks(definition.success.blocks, 'success.blocks');

  const image = definition.layout.image.url;
  if (definition.layout.imagePosition !== 'none') {
    if (!image) add('layout.image.url', 'Add the picture, or set its position to none.');
    else if (!isSafeMediaUrl(image)) {
      add('layout.image.url', 'Use an https:// address, or a path on your site.');
    }
  }
  if (!definition.style.buttonLabel) add('style.buttonLabel', 'The button needs a label.');

  /* --------------------------------------------------------------- trigger */

  const trigger = definition.trigger;
  if (definition.placements.display !== 'none') {
    if (trigger.type === 'click' && !trigger.selector) {
      add('trigger.selector', 'Say which element a click on should show it, as a CSS selector.');
    }
    if (trigger.type === 'event' && !trigger.name) {
      add('trigger.name', 'Name the event, as your code sends it to track.');
    }
  }
  const { start, end } = definition.schedule;
  if (start && end && Date.parse(end) <= Date.parse(start)) {
    add('schedule.end', 'The end has to come after the start.');
  }

  /* --------------------------------------------------------------- success */

  const success = definition.success;
  switch (success.action) {
    case 'redirect':
      if (!isSafeLink(success.redirectUrl)) {
        add('success.redirectUrl', 'Use an https:// address, or a path on your site.');
      }
      break;
    case 'coupon':
      if (!success.coupon.code) add('success.coupon.code', 'Give the code to reveal.');
      break;
    case 'download':
      if (!FORM_FILE_REF.test(success.download.url) && !isSafeLink(success.download.url)) {
        add(
          'success.download.url',
          'Upload the file, or use an https:// address or a path on your site.',
        );
      }
      break;
    case 'form':
      if (!success.formId) add('success.formId', 'Pick the form to show next.');
      else if (success.formId === options.id) {
        add('success.formId', 'Pick a different form from this one.');
      }
      break;
    default:
      break;
  }

  /* -------------------------------------------------------------- variants */

  const variants = definition.variants;
  if (variants.length === 1) {
    add('variants', 'A test needs at least two variants. Add another, or remove this one.');
  }
  if (variants.length > 0 && variants.every((v) => v.weight === 0)) {
    add('variants', 'Give at least one variant some of the traffic.');
  }
  const variantIds = new Set<string>();
  variants.forEach((variant, i) => {
    if (variantIds.has(variant.id)) add(`variants.${i}.id`, 'Two variants share this id.');
    variantIds.add(variant.id);
    if (variant.content.blocks) blocks(variant.content.blocks, `variants.${i}.content.blocks`);
  });

  /* -------------------------------------------------------------- giveaway */

  if (definition.type === 'giveaway') {
    const g = definition.giveaway;
    if (!g.prize) add('giveaway.prize', 'Say what the prize is.');
    if (!g.rulesUrl) add('giveaway.rulesUrl', 'A giveaway needs a link to its official rules.');
    else if (!isSafeLink(g.rulesUrl)) {
      add('giveaway.rulesUrl', 'Use an https:// address, or a path on your site.');
    }
    if (g.startsAt && g.endsAt && Date.parse(g.endsAt) <= Date.parse(g.startsAt)) {
      add('giveaway.endsAt', 'The end has to come after the start.');
    }
    const actionIds = new Set<string>();
    g.actions.forEach((action, i) => {
      const at = `giveaway.actions.${i}`;
      if (actionIds.has(action.id)) add(`${at}.id`, 'Two actions share this id.');
      actionIds.add(action.id);
      if (!action.label) add(`${at}.label`, 'Say what to do, e.g. Follow us on X.');
      if (!isSafeLink(action.url)) add(`${at}.url`, 'Use an https:// address.');
    });
  }

  return problems;
}
