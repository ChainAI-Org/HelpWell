/**
 * The inline email card.
 *
 * One card for every way the widget asks for an address: the agent's
 * `collect_email` tool, the pre-chat form's "after the first answer" timing,
 * and a support extension's notice. It sits in the thread under whatever
 * asked, sends the address with `POST /conversations/:id/contact` (never as
 * a chat message), and then folds down to one line that says which address
 * will be used, with a way to change it. Because the address lives on the
 * contact, the folded state comes back after a reload.
 *
 * It is never shown to a visitor the host app identified: their address is
 * the app's, not something to type.
 */

import { ApiError } from '../api.js';
import type { ViewContext } from '../context.js';
import { h, replace } from '../dom.js';
import { setError } from './prechat.js';

export interface EmailCardOptions {
  context: ViewContext;
  /** Why it is asking, when the agent said. Read each time the card is drawn. */
  reason?: () => string | undefined;
  /** The honeypot's value, shared with the composer. */
  honeypot: () => string;
  /** A bot-check token when this conversation still needs one. */
  humanToken: (force?: boolean) => Promise<string | undefined>;
}

export interface EmailCard {
  el: HTMLElement;
  /** Draw whichever state the store says: asking, or done. */
  sync(): void;
}

export function emailCard(options: EmailCardOptions): EmailCard {
  const { context } = options;
  const el = h('div', { class: 'emailCard', role: 'group', 'aria-label': 'Your email' });
  let editing = false;
  let drawn: 'form' | 'done' | null = null;
  let shownEmail: string | null = null;
  const reasonEl = h('p', { class: 'emailCard__reason' });
  const reason = () =>
    options.reason?.() ||
    "We'll only use it for this conversation. If you stay, the reply shows up right here.";

  function sync(): void {
    const email = context.state.contact.email;
    const want = email && !editing ? 'done' : 'form';
    // The ask can change under a form someone is typing in; only its words move.
    reasonEl.textContent = reason();
    if (want === drawn && (want === 'form' || email === shownEmail)) return;
    drawn = want;
    shownEmail = email;
    if (want === 'done' && email) drawDone(email);
    else drawForm();
  }

  function drawDone(email: string): void {
    const change = h('button', {
      type: 'button',
      class: 'emailCard__change',
      text: 'Change',
      on: {
        click: () => {
          editing = true;
          sync();
          el.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
        },
      },
    });
    replace(
      el,
      h(
        'p',
        { class: 'emailCard__done', role: 'status' },
        h('span', { text: `Thanks, we'll use ${email} for this conversation.` }),
        ' ',
        change,
      ),
    );
    el.dataset.state = 'done';
  }

  function drawForm(): void {
    el.dataset.state = 'form';
    const preChat = context.state.config?.widget.preChat;
    const known = context.state.contact;
    const form = h('form', { class: 'emailCard__form', novalidate: true });

    form.appendChild(
      h('p', { class: 'emailCard__title', text: 'Get the answer by email if you leave?' }),
    );
    form.appendChild(reasonEl);

    let nameInput: HTMLInputElement | null = null;
    if (preChat?.fields.includes('name')) {
      nameInput = h('input', {
        class: 'field__input',
        type: 'text',
        name: 'name',
        autocomplete: 'name',
        'aria-label': 'Your name',
        placeholder: 'Your name',
      });
      if (known.name) nameInput.value = known.name;
      form.appendChild(h('label', { class: 'field' }, nameInput));
    }

    const emailInput = h('input', {
      class: 'field__input',
      type: 'email',
      name: 'email',
      autocomplete: 'email',
      inputmode: 'email',
      required: true,
      'aria-label': 'Email',
      placeholder: 'you@example.com',
    });
    if (known.email) emailInput.value = known.email;
    const emailWrap = h('label', { class: 'field' }, emailInput);
    emailInput.addEventListener('input', () => setError(emailWrap, null));
    const submit = h('button', {
      class: 'primary',
      type: 'submit',
      text: 'Save',
      'aria-label': 'Save email',
    });
    const actions = h('div', { class: 'emailCard__actions' }, submit);
    if (known.email) {
      actions.appendChild(
        h('button', {
          type: 'button',
          class: 'ghost',
          text: 'Cancel',
          on: {
            click: () => {
              editing = false;
              sync();
            },
          },
        }),
      );
    }
    form.appendChild(h('div', { class: 'emailCard__address' }, emailWrap, actions));
    if (preChat?.consentLine) {
      form.appendChild(h('p', { class: 'consent', text: preChat.consentLine }));
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const email = emailInput.value.trim();
      if (!isEmail(email)) {
        setError(emailWrap, 'That does not look like an email address.');
        return;
      }
      void save(email, nameInput?.value.trim() || undefined, submit, emailWrap);
    });

    replace(el, form);
  }

  async function save(
    email: string,
    name: string | undefined,
    submit: HTMLButtonElement,
    wrap: HTMLElement,
  ): Promise<void> {
    const id = context.state.conversationId;
    if (!id) return;
    submit.disabled = true;
    submit.textContent = 'Saving…';
    const attempt = async (force: boolean) =>
      context.api.setContact(id, {
        email,
        name,
        honeypot: options.honeypot(),
        turnstileToken: await options.humanToken(force),
      });
    try {
      let result: Awaited<ReturnType<typeof attempt>>;
      try {
        result = await attempt(false);
      } catch (error) {
        // The server wants a fresh challenge: run one, and try once more.
        if (!(error instanceof ApiError && error.needsHumanCheck)) throw error;
        result = await attempt(true);
      }
      if (context.signal.aborted) return;
      editing = false;
      context.store.set({
        contact: { email: result.contact.email, name: result.contact.name },
        botVerified: true,
      });
      sync();
    } catch (error) {
      if (context.signal.aborted) return;
      submit.disabled = false;
      submit.textContent = 'Save';
      setError(
        wrap,
        error instanceof ApiError ? error.message : 'We could not save that. Please try again.',
      );
    }
  }

  sync();
  return { el, sync };
}

/** The same loose check as the pre-chat form; the server decides what matters. */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}
