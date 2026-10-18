/**
 * Identify: telling HelpWell who the signed-in Ridgeline user is.
 *
 * The token is a JWT signed with a secret only the two servers know, which is
 * the whole reason it is worth anything — a browser cannot mint one, so it
 * cannot claim to be somebody else. Sign it on the server, hand it to the
 * widget as `data-token`, and never let the secret near the client bundle.
 */

import { signIdentity } from '@helpwell/core';
import { cookies } from 'next/headers';
import { ADA, identitySecret } from './config';
import { ADMIN_COOKIE, USER_COOKIE } from './paths';

export interface DemoSession {
  /** Signed in to Ridgeline as Ada. */
  signedIn: boolean;
  /** Holding the demo admin cookie, so /admin/helpwell opens. */
  isAdmin: boolean;
  name: string | null;
  email: string | null;
  /** The signed identify token, or null for an anonymous visitor. */
  token: string | null;
}

/**
 * Ridgeline's "session", such as it is: two cookies and no password. A real app
 * would read its own session here and mint the token from that.
 */
export async function demoSession(): Promise<DemoSession> {
  const jar = await cookies();
  const signedIn = jar.get(USER_COOKIE)?.value === 'ada';
  const isAdmin = jar.get(ADMIN_COOKIE)?.value === 'yes';

  if (!signedIn) {
    return { signedIn: false, isAdmin, name: null, email: null, token: null };
  }

  return {
    signedIn: true,
    isAdmin,
    name: ADA.name,
    email: ADA.email,
    // Everything that is not a reserved claim (id, email, name, avatarUrl,
    // consent, locale, timezone, createdAt) lands in the contact's
    // `attributes`, which is what the dashboard shows next to their name.
    token: await signIdentity({ ...ADA }, identitySecret, { expiresIn: '1h' }),
  };
}
