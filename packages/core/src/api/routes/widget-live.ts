/**
 * Live human conversations: typing, presence and attachments.
 *
 * Each of these only exists when a support extension implements it. Open
 * source has no people answering and stores no customer files, so without an
 * extension every route here is a 404 and the widget shows none of it. What
 * HelpWell does itself is the part that must not be left to an extension:
 * proving the caller owns the conversation, rate limits, and for a file, the
 * size and the real type read from its bytes, before the extension sees it.
 */

import { HelpWellError } from '../../errors.js';
import type { RequestContext } from '../context.js';
import { json, noContent, type Router, readJson } from '../router.js';
import type { SupportAttachment, SupportPresence } from '../support-extension.js';
import { enforce, ownConversation, typeAllowed, uploadPolicy } from './widget-shared.js';

export function widgetLiveRoutes(router: Router<RequestContext>): Router<RequestContext> {
  /** The visitor started or stopped typing. The widget throttles this to one call per 3 seconds. */
  router.post('/conversations/:id/typing', async ({ params, context }) => {
    const support = context.config.support;
    if (!support?.typing) throw new HelpWellError('not_found', 'Typing is not enabled');
    const body = await readJson<{ typing?: unknown }>(context.request);
    const contactId = await ownConversation(context, params.id!);
    await enforce(context, `typing:${context.visitorKey()}`, 40, 60);
    await support.typing(params.id!, contactId, body.typing === true);
    return noContent();
  });

  /** Who is typing, what has been read, and any line the team wants the visitor to see. */
  router.get('/conversations/:id/presence', async ({ params, context }) => {
    const support = context.config.support;
    if (!support?.presence) throw new HelpWellError('not_found', 'Presence is not enabled');
    await ownConversation(context, params.id!);
    await enforce(context, `presence:${context.visitorKey()}`, 120, 60);
    return json(cleanPresence(await support.presence(params.id!)));
  });

  /**
   * One file, as the raw request body.
   *
   * `application/octet-stream` rather than a multipart form on purpose: a
   * hostile page can post a multipart form to this URL with the visitor's
   * cookie attached, but it cannot send octet-stream without a CORS preflight,
   * which this API only answers for origins the host listed. The file name
   * travels in `x-helpwell-filename`, URI-encoded.
   */
  router.post('/conversations/:id/attachments', async ({ params, context }) => {
    const support = context.config.support;
    const policy = uploadPolicy(support);
    if (!policy || !support?.upload) {
      throw new HelpWellError('not_found', 'Attachments are not enabled');
    }
    const contactId = await ownConversation(context, params.id!);

    const request = context.request;
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.startsWith('application/octet-stream')) {
      throw new HelpWellError('bad_request', 'Send the file as application/octet-stream');
    }
    await enforce(context, `upload:${context.visitorKey()}`, 20, 3600);

    const tooLarge = () =>
      new HelpWellError('bad_request', `File is over ${policy.maxBytes} bytes`, {
        publicMessage: `That file is too large. The limit is ${formatBytes(policy.maxBytes)}.`,
        details: { maxBytes: policy.maxBytes },
      });
    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (declaredLength > policy.maxBytes) throw tooLarge();

    const bytes = await readCapped(request, policy.maxBytes, tooLarge);
    if (bytes.length === 0) {
      throw new HelpWellError('bad_request', 'Empty file', {
        publicMessage: 'That file is empty.',
      });
    }

    const claimed = (request.headers.get('x-helpwell-type') ?? '').toLowerCase().trim();
    const type = sniffType(bytes, claimed);
    if (!type || !typeAllowed(type, policy)) {
      throw new HelpWellError('bad_request', `Refused upload of type ${type ?? 'unknown'}`, {
        publicMessage: 'That type of file cannot be attached here.',
        details: { types: policy.types },
      });
    }

    const name = cleanFileName(request.headers.get('x-helpwell-filename'), type);
    const stored = await support.upload(params.id!, contactId, { name, type, bytes });
    return json(cleanAttachment(stored), { status: 201 });
  });

  return router;
}

/* ------------------------------------------------------------- presence */

/** Only the fields the widget draws, trimmed: this text comes from somewhere else. */
export function cleanPresence(presence: SupportPresence | null | undefined): SupportPresence {
  const name = presence?.typing?.name;
  const notice = presence?.notice;
  return {
    typing: typeof name === 'string' && name.trim() ? { name: name.trim().slice(0, 60) } : null,
    ...(typeof presence?.seenUpTo === 'string' && presence.seenUpTo
      ? { seenUpTo: presence.seenUpTo.slice(0, 120) }
      : {}),
    ...(notice && typeof notice.text === 'string' && notice.text.trim()
      ? { notice: { text: notice.text.trim().slice(0, 300), askEmail: notice.askEmail === true } }
      : {}),
  };
}

/* ----------------------------------------------------------- attachments */

/** The body, refusing as soon as it passes `limit` rather than after reading it all. */
async function readCapped(
  request: Request,
  limit: number,
  tooLarge: () => Error,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const OFFICE_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
]);

const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'application/json', 'text/markdown']);

/**
 * The file's type, read from its first bytes. The type the browser sent is
 * only used to tell apart formats that share a container (a .docx is a zip,
 * a .csv is text), never to decide what a file is. Text that looks like
 * markup is reported as HTML, SVG or XML, which no policy may allow, so a
 * page with a script in it cannot come back from an attachment URL.
 */
export function sniffType(bytes: Uint8Array, claimed = ''): string | null {
  const at = (offset: number, ...values: number[]) =>
    values.every((value, index) => bytes[offset + index] === value);
  const ascii = (offset: number, text: string) =>
    at(offset, ...Array.from(text, (char) => char.charCodeAt(0)));

  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(0, '%PDF-')) return 'application/pdf';
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (brand === 'qt  ') return 'video/quicktime';
    if (/^(heic|heix|mif1|msf1)$/.test(brand)) return 'image/heic';
    return 'video/mp4';
  }
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) return OFFICE_TYPES.has(claimed) ? claimed : 'application/zip';

  const head = bytes.slice(0, 8192);
  if (head.includes(0)) return null;
  let textHead: string;
  try {
    textHead = new TextDecoder('utf-8', { fatal: true }).decode(head);
  } catch {
    // A multi-byte character cut at 8 KB is still text; anything else is not.
    if (bytes.length <= 8192) return null;
    textHead = new TextDecoder('utf-8').decode(head);
  }
  const start = textHead.replace(/^﻿/, '').trimStart().slice(0, 512).toLowerCase();
  if (start.startsWith('<')) {
    if (start.includes('<svg')) return 'image/svg+xml';
    if (start.startsWith('<?xml')) return 'application/xml';
    return 'text/html';
  }
  if (/<(script|html|iframe|svg)\b/i.test(textHead)) return 'text/html';
  return TEXT_TYPES.has(claimed) ? claimed : 'text/plain';
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/json': 'json',
  'text/markdown': 'md',
};

/** A file name with no path, no control characters and a sane length. */
export function cleanFileName(raw: string | null, type: string): string {
  let name = '';
  try {
    name = raw ? decodeURIComponent(raw) : '';
  } catch {
    name = '';
  }
  name = (name.split(/[\\/]/).pop() ?? '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  return name || `attachment.${EXTENSIONS[type] ?? 'bin'}`;
}

/** What the widget gets back: the extension's record, with a URL it can load. */
function cleanAttachment(stored: SupportAttachment): SupportAttachment {
  const url = String(stored?.url ?? '');
  const safe = /^https:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'));
  if (!stored || !safe) {
    throw new HelpWellError(
      'upstream_failed',
      'Support extension returned an unusable attachment',
      {
        publicMessage: 'The file could not be stored. Try again.',
      },
    );
  }
  return {
    id: String(stored.id),
    url,
    name: String(stored.name ?? '').slice(0, 120),
    type: String(stored.type ?? ''),
    size: Number(stored.size) || 0,
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
