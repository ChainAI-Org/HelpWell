/**
 * Forms on the page: embeds drawn in place, every placement over the page,
 * each layout and the mobile overrides, submitting with the render token,
 * the thank-you for each success action, giveaways, two-step buttons,
 * `helpwell.forms`, the Home tab block, forms-only mode, and the preview.
 *
 * The fake server answers `POST /forms/:id/render` and `/submit` in the
 * shapes core serves; the forms are built with the widget's own guard, so a
 * test only writes the parts it is about.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeForm } from '../src/forms/normalize.js';
import { mountFormsPreview } from '../src/forms/preview.js';
import { drawForm, type FormHost } from '../src/forms/render.js';
import { applyFormStyles, FORM_CSS, setFormsDevice } from '../src/forms/styles.js';
import type { SubmitResult, WidgetForm } from '../src/forms/types.js';
import { boot, dispatch } from '../src/index.js';
import { Widget } from '../src/widget.js';
import { unmount } from './helpers/mount.js';
import { createFakeServer, type FakeServer, flush } from './helpers/server.js';

const text = (markdown: string) => ({ type: 'text', markdown });

function formJson(patch: Record<string, unknown> = {}) {
  return {
    id: 'news',
    version: 1,
    type: 'newsletter',
    fields: [
      {
        id: 'email',
        kind: 'email',
        label: 'Email',
        placeholder: 'you@example.com',
        required: true,
      },
    ],
    content: { blocks: [text('## Get the update')], footer: [] },
    success: { action: 'message', blocks: [text('Thanks, you are in.')], redirectUrl: '' },
    trigger: { type: 'load' },
    ...patch,
  };
}

function rendered(patch: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    shown: true,
    form: formJson(patch),
    variant: 'a',
    placement: 'inline',
    token: 'tok-1',
    state: { submitted: false },
    ...extra,
  };
}

function accepted(
  success: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): SubmitResult {
  return {
    ok: true,
    submissionId: 'fsb_1',
    status: 'accepted',
    success: { action: 'message', blocks: [text('Thanks, you are in.')], ...success },
    ...extra,
  } as SubmitResult;
}

let server: FakeServer;
let widget: Widget | null = null;

async function start(
  routes: Record<string, unknown>,
  options: { config?: Record<string, unknown>; mode?: 'forms'; html?: string } = {},
) {
  document.body.innerHTML = options.html ?? '<main><div data-helpwell-form="news"></div></main>';
  server = createFakeServer({ routes, config: options.config as never });
  widget = new Widget({ apiUrl: '/api/helpwell', fetch: server.fetch, mode: options.mode });
  await widget.mount();
  await flush(20);
  return widget;
}

/** The shadow root of the first embed, or the forms layer. */
function embed(): ShadowRoot {
  const host = document.querySelector('[data-helpwell-form]');
  if (!host?.shadowRoot) throw new Error('no embed root');
  return host.shadowRoot;
}
function layer(): ShadowRoot {
  const host = document.querySelector('helpwell-forms');
  if (!host?.shadowRoot) throw new Error('no forms layer');
  return host.shadowRoot;
}

function type(root: ShadowRoot | HTMLElement, field: string, value: string) {
  const input = root.querySelector<HTMLInputElement>(
    `[data-field="${field}"] input, [data-field="${field}"] textarea`,
  );
  if (!input) throw new Error(`no input for ${field}`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

async function send(root: ShadowRoot | HTMLElement) {
  root
    .querySelector<HTMLFormElement>('.hwf__form')!
    .dispatchEvent(new Event('submit', { cancelable: true }));
  await flush(20);
}

const bodies = (path: string) =>
  // biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary JSON shapes
  server.calls.filter((c) => c.path.startsWith(path)).map((c) => c.body as Record<string, any>);

afterEach(() => {
  widget?.destroy();
  widget = null;
  unmount();
  vi.restoreAllMocks();
  try {
    sessionStorage.clear();
  } catch {
    // Not every environment has storage.
  }
});

/* ----------------------------------------------------------------- embeds */

describe('an embed', () => {
  it('is drawn in place, and posts the answers with its render token', async () => {
    const heard = vi.fn();
    await start({ 'POST /forms/news/render': rendered(), 'POST /forms/news/submit': accepted() });
    widget!.forms.on('submit', heard);
    const onWindow = vi.fn();
    window.addEventListener('helpwell:form-submit', onWindow);

    const [render] = bodies('/forms/news/render');
    expect(render).toMatchObject({ placement: 'inline', manual: false, page: { path: '/' } });
    expect(render!.visitor).toMatch(/^b_/);
    const root = embed();
    expect(root.querySelector('.hwf .eg-text')?.textContent).toContain('Get the update');
    expect(root.querySelector('.hwf__trap')).not.toBeNull();

    type(root, 'email', 'ada@example.com');
    await send(root);
    const [submitted] = bodies('/forms/news/submit');
    expect(submitted).toMatchObject({
      token: 'tok-1',
      answers: { email: 'ada@example.com' },
      honeypot: '',
    });
    expect(root.querySelector('.hwf__done')?.textContent).toContain('Thanks, you are in.');
    expect(heard).toHaveBeenCalledWith(
      expect.objectContaining({
        formId: 'news',
        submissionId: 'fsb_1',
        placement: 'inline',
        email: 'ada@example.com',
      }),
    );
    expect(onWindow).toHaveBeenCalled();
    window.removeEventListener('helpwell:form-submit', onWindow);
  });

  it('checks required fields before sending, and shows the server’s field errors', async () => {
    await start({ 'POST /forms/news/render': rendered() });
    const root = embed();
    await send(root);
    expect(bodies('/forms/news/submit')).toEqual([]);
    expect(root.querySelector('[data-field="email"] .hwf__error')?.textContent).toMatch(/email/i);
    expect(root.querySelector('[data-field="email"] input')?.getAttribute('aria-invalid')).toBe(
      'true',
    );

    server.status('/forms/news/submit', 400, {
      error: {
        code: 'bad_request',
        message: 'Please use an email address you will keep.',
        details: { fields: { email: 'Please use an email address you will keep.' } },
      },
    });
    type(root, 'email', 'x@mailinator.com');
    await send(root);
    expect(root.querySelector('[data-field="email"] .hwf__error')?.textContent).toMatch(/keep/);
  });

  it('draws every kind of field, and posts them typed', async () => {
    await start({
      'POST /forms/news/render': rendered({
        fields: [
          { id: 'email', kind: 'email', label: 'Email', required: true },
          { id: 'first_name', kind: 'first_name', label: 'First name', width: 'half' },
          { id: 'plan', kind: 'dropdown', label: 'Plan', options: ['Free', 'Pro'] },
          { id: 'role', kind: 'radio', label: 'Role', options: ['Dev', 'PM'] },
          { id: 'topics', kind: 'checkbox', label: 'Topics', options: ['API', 'Billing'] },
          {
            id: 'agree',
            kind: 'consent',
            label: 'I agree to the [terms](https://example.com/terms)',
            required: true,
          },
          { id: 'source', kind: 'hidden', capture: 'utm_source' },
          { id: 'session', kind: 'hidden', value: 'live-demo' },
        ],
      }),
      'POST /forms/news/submit': accepted(),
    });
    const root = embed();
    expect(root.querySelector('[data-field="first_name"]')?.getAttribute('data-width')).toBe(
      'half',
    );
    expect(root.querySelector('[data-field="agree"] a')?.getAttribute('href')).toBe(
      'https://example.com/terms',
    );
    type(root, 'email', 'ada@example.com');
    type(root, 'first_name', 'Ada');
    root.querySelector<HTMLSelectElement>('[data-field="plan"] select')!.value = 'Pro';
    root.querySelector<HTMLInputElement>('[data-field="role"] input[value="PM"]')!.checked = true;
    root.querySelector<HTMLInputElement>('[data-field="topics"] input[value="API"]')!.checked =
      true;
    await send(root);
    expect(bodies('/forms/news/submit')).toEqual([]);
    expect(root.querySelector('[data-field="agree"] .hwf__error')?.textContent).toMatch(/Tick/);
    root.querySelector<HTMLInputElement>('[data-field="agree"] input')!.checked = true;
    await send(root);
    expect(bodies('/forms/news/submit')[0]?.answers).toEqual({
      email: 'ada@example.com',
      first_name: 'Ada',
      plan: 'Pro',
      role: 'PM',
      topics: ['API'],
      agree: true,
      session: 'live-demo',
    });
  });

  it('shows the thank-you instead of the form to someone who already signed up', async () => {
    await start({ 'POST /forms/news/render': rendered({}, { state: { submitted: true } }) });
    const root = embed();
    expect(root.querySelector('.hwf__form')).toBeNull();
    expect(root.textContent).toContain('already signed up');
    expect(root.textContent).toContain('Thanks, you are in.');
  });

  it('draws a two-step embed as a button that opens the form', async () => {
    await start({
      'POST /forms/news/render': {
        shown: false,
        reason: 'two_step',
        form: formJson({ placements: { twoStep: { enabled: true, label: 'Get the guide' } } }),
      },
    });
    const button = embed().querySelector<HTMLButtonElement>('.hwf-launch');
    expect(button?.textContent).toBe('Get the guide');
    server.set('POST /forms/news/render', rendered({}, { placement: 'button' }));
    button!.click();
    await flush(20);
    expect(bodies('/forms/news/render').at(-1)).toMatchObject({
      placement: 'button',
      manual: true,
    });
    expect(layer().querySelector('.hwf-scrim[role="dialog"] .hwf')).not.toBeNull();
  });
});

/* ---------------------------------------------------------- success actions */

describe('after submitting', () => {
  async function submitWith(success: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    await start({
      'POST /forms/news/render': rendered(),
      'POST /forms/news/submit': accepted(success, extra),
    });
    const root = embed();
    type(root, 'email', 'ada@example.com');
    await send(root);
    return root;
  }

  it('reveals a coupon code with a copy button', async () => {
    const root = await submitWith({
      action: 'coupon',
      coupon: { code: 'WELCOME15', label: 'Your code' },
    });
    expect(root.querySelector('.hwf__code code')?.textContent).toBe('WELCOME15');
    expect(root.querySelector('.hwf__copy')).not.toBeNull();
  });

  it('links the signed download through the API', async () => {
    const root = await submitWith({
      action: 'download',
      download: {
        path: '/forms/news/download/fsb_1?exp=1&sig=abc',
        label: 'Get the PDF',
        expiresAt: '',
      },
    });
    const link = root.querySelector<HTMLAnchorElement>('.hwf__download');
    expect(link?.textContent).toBe('Get the PDF');
    expect(link?.getAttribute('href')).toBe(
      '/api/helpwell/forms/news/download/fsb_1?exp=1&sig=abc',
    );
  });

  it('opens the chat, or shows the next form in the same place', async () => {
    const open = vi.spyOn(Widget.prototype, 'open');
    await submitWith({ action: 'chat' });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ name: 'chat' }));
    widget?.destroy();
    unmount();

    await start({
      'POST /forms/news/render': rendered(),
      'POST /forms/news/submit': accepted({ action: 'form', formId: 'survey' }),
      'POST /forms/survey/render': rendered({
        id: 'survey',
        content: { blocks: [text('## One more thing')], footer: [] },
      }),
    });
    type(embed(), 'email', 'ada@example.com');
    await send(embed());
    await flush(20);
    expect(embed().querySelector('.hwf')?.getAttribute('data-form')).toBe('survey');
    expect(embed().textContent).toContain('One more thing');
  });

  it('shows a giveaway entrant their entries, link, shares and bonus actions', async () => {
    history.replaceState({}, '', '/win?ref=friend42');
    await start({
      'POST /forms/news/render': rendered({
        type: 'giveaway',
        giveaway: {
          prize: 'A year of Pro',
          rulesUrl: '/rules',
          maxEntries: 5,
          referralEntries: 2,
          share: ['x', 'email', 'copy'],
          shareText: 'Enter!',
          actions: [
            {
              id: 'follow',
              kind: 'follow',
              label: 'Follow us',
              url: 'https://x.com/acme',
              entries: 1,
            },
          ],
        },
      }),
      'POST /forms/news/submit': accepted(
        {},
        {
          giveaway: {
            entryId: 'gve_1',
            entryKey: 'gve_1.sig',
            entries: 1,
            maxEntries: 5,
            referralCode: 'k7qm',
            referrals: 0,
            referralEntries: 2,
            actions: [
              {
                id: 'follow',
                kind: 'follow',
                label: 'Follow us',
                url: 'https://x.com/acme',
                entries: 1,
                done: false,
              },
            ],
          },
        },
      ),
      'POST /forms/news/giveaway/action': { giveaway: { entries: 2 } },
    });
    const root = embed();
    expect(root.querySelector('.hwf__meta a')?.textContent).toBe('Official rules');
    type(root, 'email', 'ada@example.com');
    await send(root);
    expect(bodies('/forms/news/submit')[0]?.ref).toBe('friend42');
    expect(root.querySelector('.hwf__entries strong')?.textContent).toBe('1');
    const link = root.querySelector<HTMLInputElement>('.hwf__link input')?.value ?? '';
    expect(new URL(link).searchParams.get('ref')).toBe('k7qm');
    expect([...root.querySelectorAll('.hwf__share a')].map((a) => a.textContent)).toEqual([
      'X',
      'Email',
    ]);
    expect(root.querySelector('.hwf__action small')?.textContent).toContain('self-reported');
    vi.spyOn(window, 'open').mockReturnValue(null);
    root.querySelector<HTMLButtonElement>('.hwf__action button')!.click();
    await flush(20);
    expect(bodies('/forms/news/giveaway/action')[0]).toEqual({
      entryKey: 'gve_1.sig',
      actionId: 'follow',
    });
    expect(root.querySelector('.hwf__entries strong')?.textContent).toBe('2');
    history.replaceState({}, '', '/');
  });
});

/* -------------------------------------------------------------- over the page */

describe('placements over the page', () => {
  const triggered = (placement: string, patch: Record<string, unknown> = {}) => ({
    'GET /forms/display': {
      items: [
        {
          form: formJson({ placements: { display: placement }, ...patch }),
          variant: 'a',
          placement,
        },
      ],
    },
    'POST /forms/news/render': rendered(
      {
        placements: {
          display: placement,
          slidein: { position: 'bottom-left' },
          bar: { position: 'top' },
        },
        ...patch,
      },
      { placement },
    ),
  });

  it('pops up on its trigger, claimed on the server, and remembers a dismissal', async () => {
    await start(triggered('popup'), {
      config: { forms: { triggered: true } },
      html: '<main></main>',
    });
    expect(server.calls.some((c) => c.path.startsWith('/forms/display?'))).toBe(true);
    expect(bodies('/forms/news/render')[0]).toMatchObject({ placement: 'popup', manual: false });
    const scrim = layer().querySelector<HTMLElement>('.hwf-scrim');
    expect(scrim?.getAttribute('role')).toBe('dialog');
    expect(scrim?.getAttribute('aria-modal')).toBe('true');
    expect(scrim?.dataset.sheet).toBe('');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush(10);
    expect(layer().querySelector('.hwf-scrim')).toBeNull();
    expect(bodies('/forms/news/dismiss')).toHaveLength(1);
  });

  it('draws a slide-in, a bar and a welcome mat where they belong', async () => {
    await start(triggered('slidein'), {
      config: { forms: { triggered: true } },
      html: '<main></main>',
    });
    expect(layer().querySelector<HTMLElement>('.hwf-slidein')?.dataset.side).toBe('bottom-left');
    widget?.destroy();
    unmount();
    await start(triggered('bar'), {
      config: { forms: { triggered: true } },
      html: '<main></main>',
    });
    expect(layer().querySelector<HTMLElement>('.hwf-bar')?.dataset.side).toBe('top');
    widget?.destroy();
    unmount();
    await start(triggered('welcome'), {
      config: { forms: { triggered: true } },
      html: '<main></main>',
    });
    expect(layer().querySelector('.hwf-welcome[aria-modal="true"] .hwf')).not.toBeNull();
  });

  it('waits for an event trigger, through engage’s armTrigger', async () => {
    await start(triggered('popup', { trigger: { type: 'event', name: 'signed_up' } }), {
      config: { forms: { triggered: true } },
      html: '<main></main>',
    });
    expect(bodies('/forms/news/render')).toHaveLength(0);
    widget!.track('signed_up');
    await flush(20);
    expect(bodies('/forms/news/render')).toHaveLength(1);
  });

  it('does not ask for triggered forms when the server says there are none', async () => {
    await start({}, { html: '<main></main>' });
    expect(server.calls.some((c) => c.path.startsWith('/forms/display'))).toBe(false);
  });

  it('opens on a data-helpwell-form-open click, and from helpwell.forms.show', async () => {
    await start(
      { 'POST /forms/news/render': rendered({}, { placement: 'popup' }) },
      {
        html: '<button data-helpwell-form-open="news">Get it</button>',
      },
    );
    document.querySelector<HTMLButtonElement>('[data-helpwell-form-open]')!.click();
    await flush(20);
    expect(bodies('/forms/news/render')[0]).toMatchObject({ placement: 'button', manual: true });
    layer().querySelector<HTMLButtonElement>('.hwf__close')!.click();
    await flush(10);
    // Opened by the page, so closing it is not a dismissal the server keeps.
    expect(bodies('/forms/news/dismiss')).toHaveLength(0);

    dispatch(widget!, 'forms.show', ['news']);
    await flush(20);
    expect(bodies('/forms/news/render').at(-1)).toMatchObject({ placement: 'popup', manual: true });
  });
});

/* ----------------------------------------------------------- widget modes */

describe('with the widget', () => {
  it('works in forms-only mode, with no launcher', async () => {
    await start({ 'POST /forms/news/render': rendered() }, { mode: 'forms' });
    expect(document.querySelector('helpwell-widget')).toBeNull();
    expect(embed().querySelector('.hwf')).not.toBeNull();
  });

  it('draws a form block on the Home tab', async () => {
    await start(
      { 'POST /forms/news/render': rendered({}, { placement: 'home' }) },
      {
        config: { widget: { home: { blocks: [{ type: 'form', formId: 'news' }] } } },
        html: '<main></main>',
      },
    );
    widget!.open();
    await flush(30);
    const panel = widget!.shadowRoot!;
    const holder = [...panel.querySelectorAll<HTMLElement>('.section')].find((el) => el.shadowRoot);
    expect(holder?.shadowRoot?.querySelector('.hwf-home .hwf')).not.toBeNull();
    expect(bodies('/forms/news/render')[0]).toMatchObject({ placement: 'home' });
  });

  it('queues helpwell.forms calls made before the widget loads', async () => {
    document.body.innerHTML = '<main></main>';
    server = createFakeServer({
      routes: { 'POST /forms/news/render': rendered({}, { placement: 'popup' }) },
    });
    const heard = vi.fn();
    const shim = Object.assign(() => {}, {
      q: [
        ['init', { apiUrl: '/api/helpwell', fetch: server.fetch }],
        ['forms.on', 'submit', heard],
        ['forms.show', 'news'],
      ],
    });
    widget = await boot(shim as never);
    await flush(30);
    expect(bodies('/forms/news/render')[0]).toMatchObject({ manual: true });
    expect(typeof window.helpwell?.forms?.show).toBe('function');
  });
});

/* -------------------------------------------------------------- the renderer */

function host(result: SubmitResult = accepted()): FormHost {
  return {
    preview: false,
    apiUrl: '/api/helpwell',
    submit: () => Promise.resolve(result),
    claimAction: () => Promise.reject(new Error('no')),
    act: () => {},
    page: () => ({ url: 'https://acme.test/', path: '/', referrer: '', utm: {} }),
  };
}

describe('layouts and mobile overrides', () => {
  const draw = (patch: Record<string, unknown>) =>
    drawForm(normalizeForm(formJson(patch)) as WidgetForm, host(), { placement: 'inline' }).el;

  it('describes the layout on the element for the stylesheet', () => {
    const el = draw({
      layout: {
        imagePosition: 'left',
        image: { url: 'https://acme.test/a.png', alt: 'A' },
        columns: 2,
        fieldLayout: 'inline',
        align: 'center',
        width: 720,
      },
      style: {
        background: '#101020',
        text: '#FFFFFF',
        accent: '#E0567A',
        radius: 4,
        spacing: 'spacious',
        buttonStyle: 'pill',
        font: 'Inter',
        buttonLabel: 'Join',
      },
      mobile: { imagePosition: 'none', fieldLayout: 'stacked', columns: 'one', compact: true },
    });
    expect(el.dataset).toMatchObject({
      image: 'left',
      cols: '2',
      fields: 'inline',
      align: 'center',
      spacing: 'spacious',
      button: 'pill',
      mImage: 'none',
      mFields: 'stacked',
      mCols: 'one',
    });
    expect(el.style.getPropertyValue('--hwf-bg')).toBe('#101020');
    expect(el.style.getPropertyValue('--hwf-accent')).toBe('#E0567A');
    expect(el.style.getPropertyValue('--hwf-width')).toBe('720px');
    expect(el.style.getPropertyValue('--hwf-font')).toContain('Inter');
    expect(el.querySelector('.hwf__media img')?.getAttribute('src')).toBe(
      'https://acme.test/a.png',
    );
    expect(el.querySelector('.hwf__submit')?.textContent).toBe('Join');
  });

  it('keeps "same" on a phone as no override, and drops an unsafe picture', () => {
    const el = draw({
      layout: { imagePosition: 'top', image: { url: 'javascript:alert(1)' } },
      mobile: { imagePosition: 'same', fieldLayout: 'same', columns: 'same', compact: false },
    });
    expect(el.dataset.image).toBe('none');
    expect(el.dataset.mImage).toBeUndefined();
    expect(el.dataset.mCompact).toBeUndefined();
    expect(el.querySelector('img')).toBeNull();
  });

  it('has phone rules for each override, keyed on the host', () => {
    for (const rule of [
      '[data-m-image="top"]',
      '[data-m-image="none"]',
      '[data-m-fields="stacked"]',
      '[data-m-cols="one"]',
      '[data-m-compact]',
    ]) {
      expect(FORM_CSS).toContain(`:host([data-hw-phone]) .hwf${rule}`);
    }
    expect(FORM_CSS).toContain(':host([data-hw-phone]) .hwf-scrim[data-sheet]');
    expect(FORM_CSS).not.toContain('@media (max-width: 767px)');
  });

  it('marks each form host as on a phone or not, and the preview can say which', () => {
    document.body.innerHTML = '<div id="a"></div>';
    const host = document.getElementById('a')!;
    applyFormStyles(host.attachShadow({ mode: 'open' }));
    // No matchMedia here: a desktop.
    expect(host.hasAttribute('data-hw-phone')).toBe(false);
    setFormsDevice('phone');
    expect(host.hasAttribute('data-hw-phone')).toBe(true);
    setFormsDevice('desktop');
    expect(host.hasAttribute('data-hw-phone')).toBe(false);
    setFormsDevice(null);
  });
});

describe('the preview', () => {
  it('draws a draft in the placement asked for, and its thank-you', async () => {
    document.body.innerHTML = '<div data-form-preview-target="inline"></div>';
    const preview = mountFormsPreview({
      target: () => document.querySelector<HTMLElement>('[data-form-preview-target]'),
    });
    const draft = {
      ...formJson(),
      success: { action: 'coupon', blocks: [text('Here it is.')], coupon: { code: 'SAVE10' } },
    };
    preview.render(draft, { placement: 'inline', state: 'done' });
    await flush(10);
    const root = document.querySelector('[data-form-preview-target]')!.shadowRoot!;
    expect(root.querySelector('.hwf__code code')?.textContent).toBe('SAVE10');
    preview.render(draft, { placement: 'popup' });
    expect(
      document.querySelector('helpwell-forms')?.shadowRoot?.querySelector('.hwf-scrim .hwf'),
    ).not.toBeNull();
    preview.destroy();
  });
});
