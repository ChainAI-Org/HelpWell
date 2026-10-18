import { HELP_PATH } from '../../lib/paths';

const WORKSPACE = [
  {
    title: 'Workspace name',
    detail: 'Shown on invitations and exports.',
    control: 'Northwind Labs',
  },
  {
    title: 'Base currency',
    detail: 'Limits and reports are evaluated in this currency.',
    control: 'GBP — Pound sterling',
  },
  {
    title: 'Fiscal year starts',
    detail: 'Used for tiered mileage thresholds.',
    control: '6 April',
  },
];

const APPROVALS = [
  {
    title: 'Auto-approve under',
    detail: 'With a receipt, in Travel, Meals or Supplies.',
    control: '£25.00',
    help: 'approvals/approval-policies',
  },
  {
    title: 'Second approver above',
    detail: 'Adds Finance on top of the line manager.',
    control: '£2,000.00',
    help: 'approvals/approval-policies',
  },
  {
    title: 'Reminders',
    detail: 'Chase the approver daily, then the filer.',
    control: 'After 3 days, then 7',
    help: 'approvals/how-approvals-work',
  },
];

const SECURITY = [
  {
    title: 'Single sign-on',
    detail: 'SAML 2.0, SP-initiated. Business plan.',
    control: 'Okta — connected',
    help: 'admin-and-billing/single-sign-on',
  },
  {
    title: 'Require SSO',
    detail: 'Turns off password sign-in on verified domains.',
    control: 'Off',
    help: 'admin-and-billing/single-sign-on',
  },
  {
    title: 'Break-glass admins',
    detail: 'Keep password sign-in if the IdP breaks.',
    control: 'Ada Okafor',
    help: 'admin-and-billing/single-sign-on',
  },
];

interface SettingRow {
  title: string;
  detail: string;
  control: string;
  help?: string;
}

function Group({ title, rows }: { title: string; rows: SettingRow[] }) {
  return (
    <div className="section panel">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      <div className="rows">
        {rows.map((row) => (
          <div className="row" key={row.title}>
            <div>
              <h3>{row.title}</h3>
              <p>
                {row.detail} {row.help ? <a href={`${HELP_PATH}/${row.help}`}>Read more</a> : null}
              </p>
            </div>
            <div className="control">{row.control}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <h1>Settings</h1>
      <p className="lede">
        Read-only in this demo. Every &ldquo;Read more&rdquo; link goes to a real article in the
        HelpWell help center, which is the point: the docs are part of the product, not a separate
        site somebody forgot about.
      </p>

      <Group title="Workspace" rows={WORKSPACE} />
      <Group title="Approvals" rows={APPROVALS} />
      <Group title="Security" rows={SECURITY} />

      <div className="note">
        <p>
          <strong>What to look at here.</strong> Sign in as Ada and wait about eight seconds: the
          NPS survey defined in the engage settings appears, because this path is in its include
          list and its audience is <code>identified</code>. Answer it and the score shows up under
          Engage &rarr; Results in the dashboard.
        </p>
      </div>
    </>
  );
}
