/**
 * The pre-chat form (WG-07).
 *
 * Only shown when the host app could not tell us who this is. If the product
 * calls `HelpWell.identify()` the visitor never sees this, which is the point:
 * it is a catch-all, not the front door.
 *
 * Validation messages animate in. An error that appears instantly reads as
 * though it was always there, and people miss it.
 */

import type { WidgetConfig } from '../api.js';
import { h } from '../dom.js';

export interface PreChatDetails {
  email?: string;
  name?: string;
  firstMessage?: string;
}

export function preChatForm(
  settings: WidgetConfig['widget']['preChat'],
  onDone: (details: PreChatDetails) => void,
): HTMLElement {
  const fields = new Map<string, { wrap: HTMLElement; input: HTMLInputElement }>();

  const form = h('form', { novalidate: true });
  form.appendChild(
    h('h2', {
      text: 'Before we start',
      style: { fontSize: '17px', margin: '4px 0 4px', letterSpacing: '-.01em' },
    }),
  );
  form.appendChild(
    h('p', {
      text: 'So we can pick this up if the conversation carries on.',
      style: { margin: '0 0 16px', color: 'var(--hw-muted)', fontSize: '13px' },
    }),
  );

  if (settings.fields.includes('name')) {
    fields.set('name', field(form, 'name', 'Your name', 'text', 'name'));
  }
  if (settings.fields.includes('email')) {
    fields.set('email', field(form, 'email', 'Email', 'email', 'email'));
  }

  const message = h('textarea', {
    class: 'field__input',
    rows: '3',
    placeholder: 'What can we help with?',
    'aria-label': 'Your question',
  });
  form.appendChild(
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field__label', text: 'Your question' }),
      message,
    ),
  );

  if (settings.consentLine) {
    form.appendChild(h('p', { class: 'consent', text: settings.consentLine }));
  }

  const submit = h('button', { class: 'primary', type: 'submit', text: 'Start the conversation' });
  form.appendChild(submit);

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    let valid = true;
    const email = fields.get('email');
    if (email) {
      const value = email.input.value.trim();
      if (settings.requireEmail && !value) {
        setError(email.wrap, 'We need an email to reply to.');
        valid = false;
      } else if (value && !isEmail(value)) {
        setError(email.wrap, 'That does not look like an email address.');
        valid = false;
      } else {
        setError(email.wrap, null);
      }
    }

    if (!message.value.trim()) {
      message.closest('.field')?.setAttribute('data-invalid', 'true');
      valid = false;
    }

    if (!valid) return;

    onDone({
      email: fields.get('email')?.input.value.trim() || undefined,
      name: fields.get('name')?.input.value.trim() || undefined,
      firstMessage: message.value.trim(),
    });
  });

  return form;
}

function field(
  form: HTMLElement,
  name: string,
  label: string,
  type: string,
  autocomplete: string,
): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = h('input', {
    class: 'field__input',
    type,
    name,
    autocomplete,
    'aria-label': label,
  });
  const wrap = h(
    'label',
    { class: 'field' },
    h('span', { class: 'field__label', text: label }),
    input,
  );
  // Clear the error as soon as they start fixing it.
  input.addEventListener('input', () => setError(wrap, null));
  form.appendChild(wrap);
  return { wrap, input };
}

/** Add or remove a validation message. Adding it re-triggers the animation. */
export function setError(wrap: HTMLElement, message: string | null): void {
  wrap.querySelector('.field__error')?.remove();
  if (!message) {
    wrap.removeAttribute('data-invalid');
    return;
  }
  wrap.setAttribute('data-invalid', 'true');
  wrap.appendChild(h('span', { class: 'field__error', role: 'alert', text: message }));
}

/**
 * Deliberately loose. A widget is not the place to argue with someone about
 * whether their address is RFC-compliant; the server checks what matters.
 */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}
