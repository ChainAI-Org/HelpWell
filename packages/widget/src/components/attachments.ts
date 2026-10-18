/**
 * Attaching files to a conversation, and showing the ones attached.
 *
 * Only ever switched on by a support extension: open source stores no
 * customer files, so without one there is no paperclip, no drop target and no
 * paste handler at all. With one, a file can come from the paperclip, a drag
 * onto the thread, or a pasted screenshot. Size and type are checked here so
 * a visitor hears about a 40 MB video before it uploads, and checked again,
 * properly, by the server, which reads the file's real type from its bytes.
 */

import type { Attachment, UploadPolicy } from '../api.js';
import { ApiError } from '../api.js';
import { h, replace, svg } from '../dom.js';
import { icons } from '../icons.js';
import { openLightbox, safeMediaUrl } from '../media.js';

const PAPERCLIP =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20 11.5-8.3 8.3a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>';

const FILE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>';

export interface Uploader {
  /** The paperclip, for the composer. Hidden while uploads are off. */
  button: HTMLElement;
  /** Pending and failed uploads, shown above the composer. */
  strip: HTMLElement;
  /** Uploads on or off, and the rules, from the thread or the config. */
  setPolicy(policy: UploadPolicy | null): void;
  /** Files from anywhere: the picker, a drop, a paste. */
  add(files: File[]): void;
  /** Wire drag-and-drop onto `zone` and paste onto `field`. */
  attach(zone: HTMLElement, field: HTMLElement): void;
}

export function uploader(options: {
  upload: (file: File, onProgress: (fraction: number) => void) => Promise<Attachment>;
  onUploaded: (attachment: Attachment) => void;
  signal: AbortSignal;
}): Uploader {
  let policy: UploadPolicy | null = null;
  const strip = h('div', { class: 'uploads', 'aria-live': 'polite' });

  const input = h('input', {
    type: 'file',
    class: 'visuallyHidden',
    tabindex: '-1',
    'aria-hidden': 'true',
    multiple: true,
  });
  input.addEventListener('change', () => {
    add([...(input.files ?? [])]);
    input.value = '';
  });

  const button = h('button', {
    type: 'button',
    class: 'composer__attach',
    'aria-label': 'Attach a file',
    hidden: true,
    on: { click: () => input.click() },
  });
  button.appendChild(svg(PAPERCLIP));
  const wrap = h('span', { class: 'composer__attachWrap' }, button, input);

  function setPolicy(next: UploadPolicy | null): void {
    policy = next;
    button.hidden = !next;
    if (next) input.setAttribute('accept', next.types.join(','));
    else input.removeAttribute('accept');
  }

  function add(files: File[]): void {
    if (!policy) return;
    for (const file of files) queue(file, policy);
  }

  function queue(file: File, rules: UploadPolicy): void {
    const row = h('div', { class: 'upload', role: 'status' });
    strip.appendChild(row);
    const name = file.name || 'Pasted image';

    const problem =
      file.size > rules.maxBytes
        ? `${name} is too large. The limit is ${formatBytes(rules.maxBytes)}.`
        : !typeMatches(file.type, rules.types)
          ? `${name} is not a type of file that can be attached here.`
          : null;
    if (problem) {
      failed(row, problem, null);
      return;
    }

    const bar = h('span', { class: 'upload__bar' });
    const meter = h('span', { class: 'upload__meter' }, bar);
    replace(
      row,
      svg(FILE_ICON),
      h('span', { class: 'upload__name', text: `Uploading ${name}…` }),
      meter,
    );
    row.dataset.state = 'uploading';
    const progress = (fraction: number) => {
      bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
      meter.dataset.known = 'true';
    };

    void options
      .upload(file, progress)
      .then((attachment) => {
        if (options.signal.aborted) return;
        row.remove();
        options.onUploaded(attachment);
      })
      .catch((error) => {
        if (options.signal.aborted) return;
        const message =
          error instanceof ApiError ? error.message : `${name} did not upload. Please try again.`;
        failed(row, message, () => {
          row.remove();
          queue(file, rules);
        });
      });
  }

  function failed(row: HTMLElement, message: string, retry: (() => void) | null): void {
    row.dataset.state = 'failed';
    row.setAttribute('role', 'alert');
    const dismiss = h('button', {
      type: 'button',
      class: 'iconBtn',
      'aria-label': 'Dismiss',
      on: { click: () => row.remove() },
    });
    dismiss.appendChild(svg(icons.close));
    replace(
      row,
      svg(icons.alert),
      h('span', { class: 'upload__name', text: message }),
      retry &&
        h('button', {
          type: 'button',
          class: 'notice__retry',
          text: 'Try again',
          on: { click: retry },
        }),
      dismiss,
    );
  }

  function attach(zone: HTMLElement, field: HTMLElement): void {
    const over = (event: DragEvent) => {
      if (!policy || !event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      zone.dataset.dropping = 'true';
    };
    const leave = () => {
      delete zone.dataset.dropping;
    };
    zone.addEventListener('dragover', over, { signal: options.signal });
    zone.addEventListener('dragenter', over, { signal: options.signal });
    zone.addEventListener('dragleave', leave, { signal: options.signal });
    zone.addEventListener(
      'drop',
      (event: DragEvent) => {
        leave();
        if (!policy || !event.dataTransfer?.files.length) return;
        event.preventDefault();
        add([...event.dataTransfer.files]);
      },
      { signal: options.signal },
    );
    // A pasted screenshot arrives as a file; pasted text is left alone.
    field.addEventListener(
      'paste',
      (event: ClipboardEvent) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!policy || files.length === 0) return;
        event.preventDefault();
        add(files);
      },
      { signal: options.signal },
    );
  }

  return { button: wrap, strip, setPolicy, add, attach };
}

/** Whether a browser-reported type is one the policy takes. An unknown type is left to the server. */
export function typeMatches(type: string, allowed: string[]): boolean {
  if (!type) return true;
  const lower = type.toLowerCase();
  const family = lower.split('/')[0];
  return allowed.some((rule) => rule === lower || rule === `${family}/*`);
}

/** Attachments under a message: images as thumbnails that open large, files as links. */
export function attachmentList(attachments: Attachment[]): HTMLElement | null {
  const items = attachments
    .map((attachment) => attachmentView(attachment))
    .filter((el): el is HTMLElement => el !== null);
  return items.length > 0 ? h('div', { class: 'attachments' }, ...items) : null;
}

function attachmentView(attachment: Attachment): HTMLElement | null {
  const url = safeMediaUrl(attachment.url);
  if (!url) return null;
  const name = attachment.name || 'Attachment';
  if (/^image\/(png|jpeg|gif|webp)$/i.test(attachment.type)) {
    const zoom = h('button', {
      type: 'button',
      class: 'media-zoom attachment attachment--image',
      'aria-label': `Enlarge image: ${name}`,
    });
    zoom.appendChild(h('img', { src: url, alt: name, loading: 'lazy', decoding: 'async' }));
    zoom.addEventListener('click', () => openLightbox(zoom, url, name));
    return zoom;
  }
  return h(
    'a',
    {
      class: 'attachment attachment--file',
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    svg(FILE_ICON),
    h('span', { class: 'attachment__name', text: name }),
    attachment.size > 0 &&
      h('span', { class: 'attachment__size', text: formatBytes(attachment.size) }),
  );
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
