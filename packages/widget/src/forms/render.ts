/**
 * Drawing one form: its content, its fields, and what it shows once it is
 * submitted. The same renderer runs in every placement and in the
 * dashboard's preview, which is what makes the preview the real thing.
 *
 * It never talks to the API itself. It asks its host (`FormHost`): the live
 * runtime on a customer's page, or the preview's stand-in, which records
 * nothing and sends nothing. The host also decides what "open the chat" and
 * "show another form" mean where it is.
 *
 * Every value from the form definition that reaches the DOM goes through the
 * same doors as everywhere else in the widget: text as text, Markdown through
 * the shared safe renderer, links and images through their checks, colours
 * already checked as hex (normalize.ts).
 */

import { h, svg } from '../dom.js';
import { renderBlocks, safeLink } from '../engage/blocks.js';
import type { EngageButton } from '../engage/types.js';
import { icons } from '../icons.js';
import { renderRich, safeMediaUrl } from '../media.js';
import { safeAccent } from '../sanitize.js';
import type {
  EntryState,
  FormField,
  FormPlacement,
  SubmitBody,
  SubmitResult,
  WidgetForm,
} from './types.js';

/** What a submit call can fail with: the widget's ApiError, or anything with its shape. */
export interface SubmitFailure {
  status: number;
  message: string;
  details?: Record<string, unknown>;
}

export interface FormHost {
  /** The dashboard's preview: nothing is sent, followed or remembered. */
  preview: boolean;
  /** Where the API is, for the download link a submission returns. */
  apiUrl: string;
  submit(body: Omit<SubmitBody, 'token'>): Promise<SubmitResult>;
  /** A fresh bot-check token, when the check is on; null when it is off. */
  humanToken?(container: HTMLElement): Promise<string | null>;
  /** Claim a self-reported giveaway bonus. */
  claimAction(entryKey: string, actionId: string): Promise<EntryState>;
  /** Open the chat, or show another form in this one's place. */
  act(action: 'chat' | 'form' | 'redirect', value?: string): void;
  /** The form was submitted, for `helpwell.forms.on('submit')`. */
  submitted?(result: SubmitResult, answers: Record<string, unknown>, email: string): void;
  /** A giveaway referral code the visit arrived with. */
  referral?(): string | null;
  /** The page the form is on, for share links and the submission. */
  page(): SubmitBody['page'];
}

export interface DrawOptions {
  placement: FormPlacement;
  /** The widget's accent, for a form that does not set its own. */
  accent?: string;
  /** Draw a close button, and what it does. */
  onClose?: () => void;
  /** Start on the thank-you, e.g. for someone who already subscribed. */
  done?: { giveaway?: EntryState | null } | null;
}

export interface DrawnForm {
  el: HTMLElement;
  /** Put focus on the first field. */
  focus(): void;
  /** Show what an accepted submission shows (the preview uses it). */
  showDone(result: SubmitResult): void;
}

const FONT_STACK = 'system-ui, "Segoe UI", sans-serif';

export function drawForm(form: WidgetForm, host: FormHost, options: DrawOptions): DrawnForm {
  const { layout, style, mobile } = form;
  const image = safeMediaUrl(layout.image.url);
  const root = h('div', {
    class: 'hwf',
    'data-form': form.id,
    'data-placement': options.placement,
    'data-image': image ? layout.imagePosition : 'none',
    'data-fields': layout.fieldLayout,
    'data-cols': String(layout.columns),
    'data-align': layout.align,
    'data-spacing': style.spacing,
    'data-button': style.buttonStyle,
    'data-button-width': style.buttonWidth,
    'data-m-image': mobile.imagePosition === 'same' ? null : mobile.imagePosition,
    'data-m-fields': mobile.fieldLayout === 'same' ? null : mobile.fieldLayout,
    'data-m-cols': mobile.columns === 'same' ? null : mobile.columns,
    'data-m-compact': mobile.compact,
    'data-shadow': style.shadow,
    'data-closable': Boolean(options.onClose && layout.closeButton),
  });
  const set = (name: string, value: string | null) => {
    if (value) root.style.setProperty(name, value);
  };
  set('--hwf-bg', style.background);
  set('--hwf-text', style.text);
  set('--hwf-accent', style.accent || safeAccent(options.accent));
  set('--hwf-btn-text', style.buttonText);
  set('--hwf-field-bg', style.fieldBackground);
  set('--hwf-field-border', style.fieldBorder);
  set('--hwf-radius', `${style.radius}px`);
  set('--hwf-width', `${layout.width}px`);
  set('--hwf-overlay', String(style.overlay / 100));
  if (style.font && style.font !== 'inherit') set('--hwf-font', `"${style.font}", ${FONT_STACK}`);

  const inner = h('div', { class: 'hwf__inner' });
  if (image) {
    inner.appendChild(
      h(
        'div',
        { class: 'hwf__media' },
        h('img', { src: image, alt: layout.image.alt, loading: 'lazy', decoding: 'async' }),
      ),
    );
  }
  const body = h('div', { class: 'hwf__body' });
  inner.appendChild(body);
  root.appendChild(inner);

  if (options.onClose && layout.closeButton) {
    const close = h('button', { class: 'hwf__close', type: 'button', 'aria-label': 'Close' });
    close.appendChild(svg(icons.close));
    close.addEventListener('click', () => options.onClose?.());
    root.appendChild(close);
  }

  const onButton = (button: EngageButton) => {
    if (button.action === 'chat') host.act('chat');
    else if (button.action === 'url' && !host.preview) {
      const href = safeLink(button.value);
      if (href) {
        if (button.newTab) window.open(href, '_blank', 'noopener');
        else location.assign(href);
      }
    } else if (button.action === 'dismiss') options.onClose?.();
  };

  const showDone = (result: SubmitResult) => {
    body.replaceChildren(doneView(form, result, host, onButton));
  };

  if (options.done) {
    showDone({
      ok: true,
      submissionId: '',
      status: 'duplicate',
      success: { action: 'message', blocks: form.success.blocks },
      ...(options.done.giveaway ? { giveaway: options.done.giveaway } : {}),
    });
    const already = h('p', { class: 'hwf__meta', text: 'You are already signed up. Thank you.' });
    body.prepend(already);
    return { el: root, focus: () => {}, showDone };
  }

  if (form.content.blocks.length > 0)
    body.appendChild(renderBlocks(form.content.blocks, { onButton }));
  const formEl = buildForm(form, host, { onDone: showDone });
  body.appendChild(formEl.el);
  if (form.content.footer.length > 0) {
    body.appendChild(renderBlocks(form.content.footer, { onButton }));
  }

  return {
    el: root,
    focus: () => formEl.focus(),
    showDone,
  };
}

/* ------------------------------------------------------------------ fields */

interface BuiltForm {
  el: HTMLFormElement;
  focus(): void;
}

function buildForm(
  form: WidgetForm,
  host: FormHost,
  options: { onDone: (result: SubmitResult) => void },
): BuiltForm {
  const el = h('form', { class: 'hwf__form', novalidate: true });
  const fields = h('div', { class: 'hwf__fields' });
  const errors = new Map<string, HTMLElement>();
  const inputs = new Map<string, () => unknown>();
  let firstInput: HTMLElement | null = null;

  for (const field of form.fields) {
    if (field.kind === 'hidden') {
      inputs.set(field.id, () => hiddenValue(field, host));
      continue;
    }
    const built = fieldRow(form.id, field);
    fields.appendChild(built.row);
    errors.set(field.id, built.error);
    inputs.set(field.id, built.read);
    firstInput ??= built.focusable;
  }
  el.appendChild(fields);

  // Only a script fills this in: it is off screen, unlabelled for people,
  // skipped by Tab, and ignored by password managers.
  const trap = h('input', {
    class: 'hwf__trap',
    type: 'text',
    name: 'website',
    tabindex: '-1',
    autocomplete: 'off',
    'aria-hidden': 'true',
  });
  el.appendChild(trap);

  const challenge = h('div', { class: 'hwf__challenge' });
  const formError = h('p', { class: 'hwf__error', role: 'alert' });
  const submit = h('button', {
    class: 'hwf__submit',
    type: 'submit',
    text: form.style.buttonLabel,
  });
  el.append(challenge, formError, submit);

  if (form.giveaway) {
    const meta = giveawayMeta(form);
    if (meta) el.appendChild(meta);
  }

  const clear = () => {
    formError.textContent = '';
    for (const [id, error] of errors) {
      error.textContent = '';
      el.querySelector(`[data-field="${id}"] .hwf__input`)?.removeAttribute('aria-invalid');
    }
  };
  const showErrors = (messages: Record<string, unknown>) => {
    let focused = false;
    for (const [id, message] of Object.entries(messages)) {
      const error = errors.get(id);
      if (!error || typeof message !== 'string') continue;
      error.textContent = message;
      const input = el.querySelector<HTMLElement>(`[data-field="${id}"] .hwf__input`);
      input?.setAttribute('aria-invalid', 'true');
      if (!focused) {
        (input ?? el.querySelector<HTMLElement>(`[data-field="${id}"] input`))?.focus();
        focused = true;
      }
    }
    return focused;
  };

  let busy = false;
  el.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    clear();
    const answers: Record<string, unknown> = {};
    for (const [id, read] of inputs) {
      const value = read();
      if (value !== undefined) answers[id] = value;
    }
    const problems = validate(form.fields, answers);
    if (showErrors(problems)) return;
    const email = String(answers[form.fields.find((f) => f.kind === 'email')?.id ?? 'email'] ?? '');

    busy = true;
    submit.disabled = true;
    const send = async (turnstileToken?: string): Promise<SubmitResult> =>
      host.submit({
        answers,
        honeypot: trap.value,
        ...(turnstileToken ? { turnstileToken } : {}),
        page: host.page(),
        ...(host.referral?.() ? { ref: host.referral() ?? undefined } : {}),
      });

    void (async () => {
      try {
        let token: string | undefined;
        if (host.humanToken) token = (await host.humanToken(challenge)) ?? undefined;
        let result: SubmitResult;
        try {
          result = await send(token);
        } catch (error) {
          const failure = error as SubmitFailure;
          // A token that was used up or went stale: one fresh challenge.
          if (failure.details?.humanCheck && host.humanToken) {
            token = (await host.humanToken(challenge)) ?? undefined;
            result = await send(token);
          } else {
            throw error;
          }
        }
        host.submitted?.(result, answers, email);
        options.onDone(result);
      } catch (error) {
        const failure = error as SubmitFailure;
        const fieldErrors = failure.details?.fields;
        if (
          !(
            fieldErrors &&
            typeof fieldErrors === 'object' &&
            showErrors(fieldErrors as Record<string, unknown>)
          )
        ) {
          formError.textContent = failure.message || 'That did not go through. Try again.';
        }
      } finally {
        busy = false;
        submit.disabled = false;
      }
    })();
  });

  return { el, focus: () => firstInput?.focus() };
}

function fieldRow(
  formId: string,
  field: FormField,
): { row: HTMLElement; error: HTMLElement; read: () => unknown; focusable: HTMLElement | null } {
  const id = `hwf-${formId}-${field.id}`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const row = h('div', {
    class: `hwf__field${field.kind === 'checkbox' || field.kind === 'radio' || field.kind === 'consent' ? ' hwf__field--box' : ''}`,
    'data-field': field.id,
    'data-width': field.width,
  });
  const error = h('p', { class: 'hwf__error', id: errorId, 'aria-live': 'polite' });
  const help = field.help ? h('p', { class: 'hwf__help', id: helpId, text: field.help }) : null;
  const described = [help ? helpId : '', errorId].filter(Boolean).join(' ');
  const tail: Node[] = help ? [help, error] : [error];
  const label = (text: string) =>
    h(
      'label',
      { class: 'hwf__label', for: id },
      text || field.placeholder,
      field.required ? h('span', { class: 'hwf__req', 'aria-hidden': 'true', text: '*' }) : null,
    );

  switch (field.kind) {
    case 'consent':
    case 'checkbox': {
      if (field.kind === 'consent' || field.options.length === 0) {
        const box = h('input', {
          type: 'checkbox',
          id,
          name: field.id,
          'aria-describedby': described,
          ...(field.required ? { 'aria-required': 'true' } : {}),
        });
        const text = h('span', { class: field.kind === 'consent' ? 'hwf__consent' : '' });
        // Consent text may carry a link to the privacy policy.
        const words = field.label || field.placeholder;
        if (field.kind === 'consent') {
          text.appendChild(h('span', { class: 'eg-text' }, renderRich(words)));
        } else {
          text.textContent = words;
        }
        if (field.required)
          text.appendChild(h('span', { class: 'hwf__req', 'aria-hidden': 'true', text: '*' }));
        row.append(h('label', { class: 'hwf__choice', for: id }, box, text), ...tail);
        return { row, error, read: () => box.checked, focusable: box };
      }
      const set = h('fieldset', { class: 'hwf__choices', 'aria-describedby': described });
      set.appendChild(h('legend', { class: 'hwf__label', text: field.label }));
      const boxes = field.options.map((option, i) => {
        const box = h('input', {
          type: 'checkbox',
          id: `${id}-${i}`,
          name: field.id,
          value: option,
        });
        set.appendChild(h('label', { class: 'hwf__choice', for: `${id}-${i}` }, box, option));
        return box;
      });
      row.append(set, ...tail);
      return {
        row,
        error,
        read: () => boxes.filter((b) => b.checked).map((b) => b.value),
        focusable: boxes[0] ?? null,
      };
    }
    case 'radio': {
      const set = h('fieldset', {
        class: 'hwf__choices',
        role: 'radiogroup',
        'aria-describedby': described,
      });
      set.appendChild(
        h(
          'legend',
          { class: 'hwf__label' },
          field.label,
          field.required
            ? h('span', { class: 'hwf__req', 'aria-hidden': 'true', text: '*' })
            : null,
        ),
      );
      const radios = field.options.map((option, i) => {
        const radio = h('input', {
          type: 'radio',
          id: `${id}-${i}`,
          name: `${formId}-${field.id}`,
          value: option,
        });
        set.appendChild(h('label', { class: 'hwf__choice', for: `${id}-${i}` }, radio, option));
        return radio;
      });
      row.append(set, ...tail);
      return {
        row,
        error,
        read: () => radios.find((r) => r.checked)?.value,
        focusable: radios[0] ?? null,
      };
    }
    case 'dropdown': {
      const select = h('select', {
        class: 'hwf__input',
        id,
        name: field.id,
        'aria-describedby': described,
        ...(field.required ? { 'aria-required': 'true' } : {}),
      });
      select.appendChild(h('option', { value: '', text: field.placeholder || 'Choose one' }));
      for (const option of field.options)
        select.appendChild(h('option', { value: option, text: option }));
      row.append(label(field.label), select, ...tail);
      return { row, error, read: () => select.value || undefined, focusable: select };
    }
    case 'textarea': {
      const area = h('textarea', {
        class: 'hwf__input',
        id,
        name: field.id,
        rows: '3',
        placeholder: field.placeholder,
        maxlength: '5000',
        'aria-describedby': described,
        ...(field.required ? { 'aria-required': 'true' } : {}),
      });
      row.append(label(field.label), area, ...tail);
      return { row, error, read: () => area.value.trim() || undefined, focusable: area };
    }
    default: {
      const input = h('input', {
        class: 'hwf__input',
        id,
        name: field.id,
        type: INPUT_TYPES[field.kind] ?? 'text',
        placeholder: field.placeholder,
        autocomplete: AUTOCOMPLETE[field.kind] ?? 'off',
        ...(field.kind === 'number' ? { inputmode: 'decimal' } : {}),
        maxlength: field.kind === 'email' ? '254' : '200',
        'aria-describedby': described,
        ...(field.required ? { 'aria-required': 'true' } : {}),
      });
      row.append(label(field.label), input, ...tail);
      return { row, error, read: () => input.value.trim() || undefined, focusable: input };
    }
  }
}

const INPUT_TYPES: Partial<Record<FormField['kind'], string>> = {
  email: 'email',
  phone: 'tel',
  number: 'number',
  date: 'date',
};

const AUTOCOMPLETE: Partial<Record<FormField['kind'], string>> = {
  email: 'email',
  name: 'name',
  first_name: 'given-name',
  last_name: 'family-name',
  phone: 'tel',
  company: 'organization',
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The checks worth making before a round trip; the server makes all of them again. */
export function validate(
  fields: readonly FormField[],
  answers: Record<string, unknown>,
): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const field of fields) {
    if (field.kind === 'hidden') continue;
    const value = answers[field.id];
    const empty =
      value === undefined ||
      value === '' ||
      value === false ||
      (Array.isArray(value) && value.length === 0);
    if (field.required && empty) {
      problems[field.id] =
        field.kind === 'email'
          ? 'Enter your email address.'
          : field.kind === 'consent' || field.kind === 'checkbox'
            ? 'Tick this box to continue.'
            : 'This one is required.';
      continue;
    }
    if (field.kind === 'email' && typeof value === 'string' && value && !EMAIL.test(value)) {
      problems[field.id] = 'Enter an email address, like you@example.com.';
    }
  }
  return problems;
}

function hiddenValue(field: FormField, host: FormHost): string | undefined {
  if (!field.capture) return field.value || undefined;
  const page = host.page();
  switch (field.capture) {
    case 'page':
      return page.url || undefined;
    case 'referrer':
      return page.referrer || undefined;
    case 'param': {
      try {
        return (
          new URL(page.url).searchParams.get(field.param)?.slice(0, 500) || field.value || undefined
        );
      } catch {
        return field.value || undefined;
      }
    }
    default:
      return page.utm[field.capture.slice('utm_'.length)] || field.value || undefined;
  }
}

function giveawayMeta(form: WidgetForm): HTMLElement | null {
  const g = form.giveaway;
  if (!g) return null;
  const parts: (Node | string)[] = [];
  if (g.endsAt) {
    const ends = new Date(g.endsAt);
    if (!Number.isNaN(ends.getTime())) {
      parts.push(
        `Ends ${ends.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}. `,
      );
    }
  }
  const rules = safeLink(g.rulesUrl);
  if (rules) {
    parts.push(
      h('a', { href: rules, target: '_blank', rel: 'noopener noreferrer', text: 'Official rules' }),
    );
  }
  if (parts.length === 0) return null;
  return h('p', { class: 'hwf__meta' }, ...parts);
}

/* -------------------------------------------------------------- afterwards */

function doneView(
  form: WidgetForm,
  result: SubmitResult,
  host: FormHost,
  onButton: (button: EngageButton) => void,
): HTMLElement {
  const done = h('div', { class: 'hwf__done', role: 'status', tabindex: '-1' });
  const success = result.success;
  if (success.blocks.length > 0) done.appendChild(renderBlocks(success.blocks, { onButton }));

  if (success.coupon?.code) {
    const code = success.coupon.code;
    const copy = h('button', { class: 'hwf__copy', type: 'button', text: 'Copy' });
    copy.addEventListener('click', () => {
      void copyText(code).then((ok) => {
        copy.textContent = ok ? 'Copied' : 'Select it to copy';
      });
    });
    done.append(
      h('p', { class: 'hwf__label', text: success.coupon.label || 'Your code' }),
      h('div', { class: 'hwf__code' }, h('code', { text: code }), copy),
    );
  }

  if (success.download?.path) {
    const href = `${host.apiUrl.replace(/\/+$/, '')}${success.download.path}`;
    done.appendChild(
      h('a', {
        class: 'hwf__download',
        href: host.preview ? '#' : href,
        target: '_blank',
        rel: 'noopener',
        text: success.download.label || 'Download',
      }),
    );
  }

  if (result.giveaway && form.giveaway)
    done.appendChild(giveawayPanel(form, result.giveaway, host));

  if (!host.preview) {
    if (success.action === 'redirect' && success.redirectUrl) {
      const href = safeLink(success.redirectUrl);
      if (href) setTimeout(() => location.assign(href), 600);
    } else if (success.action === 'chat') {
      host.act('chat');
    } else if (success.action === 'form' && success.formId) {
      host.act('form', success.formId);
    }
  }
  queueMicrotask(() => {
    if (done.isConnected) done.focus({ preventScroll: true });
  });
  return done;
}

const SHARE_LABELS: Record<string, string> = {
  x: 'X',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  email: 'Email',
  copy: 'Copy link',
};

/** Their entries, their link and how to share it, and the bonus actions. */
function giveawayPanel(form: WidgetForm, state: EntryState, host: FormHost): HTMLElement {
  const g = form.giveaway!;
  const panel = h('div', { class: 'hwf__done' });
  const count = h('strong', { text: String(state.entries) });
  const entries = h(
    'p',
    { class: 'hwf__entries' },
    count,
    h('span', {
      text:
        state.entries === 1
          ? `entry, of up to ${state.maxEntries}`
          : `entries, of up to ${state.maxEntries}`,
    }),
  );
  panel.appendChild(entries);

  const link = referralLink(host.page().url, state.referralCode);
  if (state.referralEntries > 0) {
    panel.appendChild(
      h('p', {
        class: 'hwf__meta',
        text: `Share your link: every friend who enters through it earns you ${state.referralEntries} more ${state.referralEntries === 1 ? 'entry' : 'entries'}.`,
      }),
    );
  }
  const box = h('input', {
    class: 'hwf__input',
    type: 'text',
    readonly: true,
    value: link,
    'aria-label': 'Your referral link',
  });
  const copy = h('button', { class: 'hwf__copy', type: 'button', text: 'Copy' });
  copy.addEventListener('click', () => {
    void copyText(link).then((ok) => {
      copy.textContent = ok ? 'Copied' : 'Select it to copy';
      if (!ok) box.select();
    });
  });
  panel.appendChild(h('div', { class: 'hwf__link' }, box, copy));

  const share = h('div', { class: 'hwf__share', role: 'group', 'aria-label': 'Share' });
  for (const target of g.share) {
    if (target === 'copy') {
      const button = h('button', { type: 'button', text: SHARE_LABELS.copy });
      button.addEventListener('click', () => void copyText(link));
      share.appendChild(button);
      continue;
    }
    const href = shareUrl(target, link, g.shareText);
    if (href) {
      share.appendChild(
        h('a', {
          href: host.preview ? '#' : href,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: SHARE_LABELS[target] ?? target,
        }),
      );
    }
  }
  if (share.childNodes.length > 0) panel.appendChild(share);

  if (state.actions.length > 0) {
    const items = h('ul', { class: 'hwf__actions', 'aria-label': 'Bonus entries' });
    for (const action of state.actions) {
      const item = h('li', { class: 'hwf__action' });
      const words = h(
        'span',
        {},
        action.label,
        h('small', {
          text: `+${action.entries} ${action.entries === 1 ? 'entry' : 'entries'} · self-reported`,
        }),
      );
      const button = h('button', {
        class: 'hwf__ghost',
        type: 'button',
        text: action.done ? 'Done' : action.kind === 'follow' ? 'Follow' : 'Visit',
        ...(action.done ? { disabled: true } : {}),
      });
      button.addEventListener('click', () => {
        const href = safeLink(action.url);
        if (href && !host.preview) window.open(href, '_blank', 'noopener');
        button.disabled = true;
        void host
          .claimAction(state.entryKey, action.id)
          .then((next) => {
            button.textContent = 'Done';
            count.textContent = String(next.entries);
          })
          .catch(() => {
            button.disabled = false;
          });
      });
      item.append(words, button);
      items.appendChild(item);
    }
    panel.appendChild(items);
  }
  return panel;
}

/** This page, with their code as `?ref=`. */
export function referralLink(pageUrl: string, code: string): string {
  try {
    const url = new URL(pageUrl);
    url.searchParams.set('ref', code);
    url.hash = '';
    return url.toString();
  } catch {
    return `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}ref=${encodeURIComponent(code)}`;
  }
}

export function shareUrl(target: string, link: string, text: string): string | null {
  const u = encodeURIComponent(link);
  const t = encodeURIComponent(text);
  switch (target) {
    case 'x':
      return `https://x.com/intent/post?text=${t}&url=${u}`;
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case 'whatsapp':
      return `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`;
    case 'email':
      return `mailto:?subject=${t}&body=${u}`;
    default:
      return null;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The accent for a form: its own, else the widget's. */
export function formAccent(form: WidgetForm, fallback: unknown): string {
  return form.style.accent || safeAccent(fallback);
}
