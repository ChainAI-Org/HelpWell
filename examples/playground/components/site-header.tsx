'use client';

/**
 * Ridgeline's nav bar, plus the two demo toggles.
 *
 * The toggles are plain links to /api/demo/session — they stand in for a real
 * sign-in, so both the anonymous and the identified widget paths can be seen
 * without building an auth system for a playground.
 *
 * A client component only so `usePathname` can mark the current tab and send
 * you back to the page you were on. Note what is *not* passed in: the signed
 * identify token stays on the server and reaches the browser exactly once, as
 * `data-token` on the widget's script tag.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DASHBOARD_PATH, HELP_PATH } from '../lib/paths';

const NAV = [
  { href: '/', label: 'Expenses' },
  { href: '/settings', label: 'Settings' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/checkout', label: 'Checkout' },
  { href: HELP_PATH, label: 'Help center' },
];

export interface SiteHeaderProps {
  signedIn: boolean;
  isAdmin: boolean;
  name: string | null;
}

export function SiteHeader({ signedIn, isAdmin, name }: SiteHeaderProps) {
  const path = usePathname() || '/';
  const next = encodeURIComponent(path);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          Ridgeline
        </Link>

        <nav className="topnav">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={item.href === path ? 'page' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="who">
          {isAdmin ? (
            <>
              <a href={DASHBOARD_PATH}>HelpWell dashboard</a>
              <a href={`/api/demo/session?admin=off&next=${next}`}>Drop admin</a>
            </>
          ) : (
            <a href={`/api/demo/session?admin=on&next=${next}`}>Sign in as an admin</a>
          )}

          {signedIn ? (
            <>
              <span className="avatar" aria-hidden="true">
                AO
              </span>
              <strong>{name}</strong>
              <a href={`/api/demo/session?user=none&next=${next}`}>Sign out</a>
            </>
          ) : (
            <a href={`/api/demo/session?user=ada&next=${next}`}>Sign in as Ada</a>
          )}
        </div>
      </div>
    </header>
  );
}
