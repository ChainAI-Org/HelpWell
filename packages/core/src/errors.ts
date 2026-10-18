/**
 * One error type for anything the API can answer with. Every throw site picks a
 * code; the HTTP layer maps codes to statuses, so no route invents its own.
 */

export type HelpWellErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'blocked'
  | 'upstream_failed'
  | 'not_configured'
  | 'internal';

const STATUS: Record<HelpWellErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  blocked: 403,
  upstream_failed: 502,
  not_configured: 501,
  internal: 500,
};

export class HelpWellError extends Error {
  readonly code: HelpWellErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  /** Safe to show a customer in the widget. Internal errors never are. */
  readonly publicMessage: string;

  constructor(
    code: HelpWellErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; publicMessage?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'HelpWellError';
    this.code = code;
    this.status = STATUS[code];
    this.details = options.details;
    this.publicMessage =
      options.publicMessage ??
      (code === 'internal' ? 'Something went wrong on our side.' : message);
  }

  toJSON() {
    return { error: { code: this.code, message: this.publicMessage, details: this.details } };
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new HelpWellError('bad_request', message, { details });
export const notFound = (what: string) => new HelpWellError('not_found', `${what} not found`);
export const unauthorized = (message = 'Not signed in') =>
  new HelpWellError('unauthorized', message);
export const forbidden = (message = 'Not allowed') => new HelpWellError('forbidden', message);
export const notConfigured = (what: string) =>
  new HelpWellError('not_configured', `${what} is not configured`, {
    publicMessage: 'This is not set up yet.',
  });

export function isHelpWellError(e: unknown): e is HelpWellError {
  return e instanceof HelpWellError;
}
