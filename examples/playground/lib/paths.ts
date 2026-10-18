/**
 * Where everything is mounted, and what the demo cookies are called.
 *
 * Strings only, with no Node imports, so this is safe to pull into a client
 * component. Anything that touches the filesystem or the environment lives in
 * lib/config.ts instead, which is server-only.
 */

/* ------------------------------------------------------------ mount points */

export const API_PATH = '/api/helpwell';
export const HELP_PATH = '/help';
export const DASHBOARD_PATH = '/admin/helpwell';

/** Served by the API handler itself; see `assets` in lib/helpwell.ts. */
export const WIDGET_LOADER_URL = `${API_PATH}/assets/loader.js`;

/* ------------------------------------------------------------- demo "auth" */

/** Set by the "Sign in as an admin" link. Checked by `isAdmin`. */
export const ADMIN_COOKIE = 'ridgeline_admin';
/** Set by the "Sign in as Ada" link. Decides whether we mint an identify token. */
export const USER_COOKIE = 'ridgeline_user';
