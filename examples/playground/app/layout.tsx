import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '../components/site-header';
import { offline } from '../lib/config';
import { demoSession } from '../lib/identity';
import { API_PATH, DASHBOARD_PATH, HELP_PATH, WIDGET_LOADER_URL } from '../lib/paths';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ridgeline — expenses without the spreadsheet',
  description: 'A fictional expense-tracking product, used here to show HelpWell installed.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await demoSession();

  return (
    <html lang="en">
      <body>
        <SiteHeader signedIn={session.signedIn} isAdmin={session.isAdmin} name={session.name} />

        <main className="page">{children}</main>

        <footer className="footer">
          {offline ? (
            <div className="footer-badge">No OPENROUTER_API_KEY — the agent is scripted</div>
          ) : (
            <div className="footer-badge">OPENROUTER_API_KEY found — the agent is live</div>
          )}
          <p>
            Ridgeline is not a real company. HelpWell is mounted at <code>{API_PATH}</code>,{' '}
            <code>{HELP_PATH}</code> and <code>{DASHBOARD_PATH}</code>.
          </p>
        </footer>

        {/*
          The entire browser-side install: one script tag.

          The loader finds the API from its own URL, so it needs no `data-api`
          (that is only for an API somewhere other than where the loader is
          served from). `data-token` is a
          JWT this server just signed — present only while you are signed in as
          Ada, which is what turns the anonymous visitor into a named contact in
          the dashboard. It is minted in lib/identity.ts and the secret never
          leaves the server.

          The loader itself does almost nothing up front: it installs a queue so
          `helpwell('identify', …)` works before the bundle lands, waits for the
          page to finish loading, and only then fetches widget.js. Support must
          not be on the critical path of somebody else's product.

          On /checkout the bundle loads and then declines to mount, because the
          display rules in settings exclude that path.
        */}
        <script src={WIDGET_LOADER_URL} data-token={session.token ?? undefined} defer />
      </body>
    </html>
  );
}
