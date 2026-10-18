/**
 * The one error the SDK throws.
 *
 * A caller on a server has the same question the widget has — "is it worth
 * trying again?" — so this mirrors `ApiError` in @helpwell/widget rather than
 * inventing a second taxonomy. It is deliberately not `HelpWellError`: that
 * type is the server's view, carrying details a client never receives.
 */

export class HelpWellApiError extends Error {
  /** HTTP status, or 0 when the request never reached a server. */
  readonly status: number;
  /** The `error.code` from the API, or a locally-minted one on transport failure. */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HelpWellApiError';
    this.status = status;
    this.code = code;
  }

  /**
   * True when retrying might work: offline, timed out, throttled, or the
   * server broke. A 501 is not one of those — it is `not_configured`, the
   * server saying a feature has no secret or key behind it, and asking again
   * will not set one.
   */
  get retryable(): boolean {
    if (this.status === 0 || this.status === 429) return true;
    return this.status >= 500 && this.status !== 501;
  }
}
