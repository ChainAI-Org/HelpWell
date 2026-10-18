import { EXPENSES, money, SUMMARY } from '../lib/demo-data';

/**
 * Ridgeline's expense dashboard. Entirely fake, and entirely ordinary — the
 * point is that HelpWell is installed on top of an app that knows nothing
 * about it.
 *
 * The `data-tour` attributes are the only nod to HelpWell on this page: they
 * are the anchors the "Your first expense" tour points at, defined in the
 * engage settings in lib/seed.ts.
 */
export default function ExpensesPage() {
  return (
    <>
      <h1>September expenses</h1>
      <p className="lede">
        Everything filed this period, with the two waiting on you at the top. Close the period on
        Friday and approved expenses go to Xero.
      </p>

      <div className="cards">
        {SUMMARY.map((card) => (
          <div className="card" key={card.label}>
            <div className="label">{card.label}</div>
            <div className="value">{card.value}</div>
            <div className="detail">{card.detail}</div>
          </div>
        ))}
      </div>

      <div className="section panel">
        <div className="panel-head">
          <h2>All expenses</h2>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-quiet" type="button" data-tour="export">
              Export period
            </button>
            <button className="btn" type="button" data-tour="new-expense">
              New expense
            </button>
          </span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Merchant</th>
              <th>Category</th>
              <th>Person</th>
              <th>Date</th>
              <th className="num">Amount</th>
              <th data-tour="status">Status</th>
            </tr>
          </thead>
          <tbody>
            {EXPENSES.map((expense) => (
              <tr key={expense.id}>
                <td>
                  <span className="merchant">{expense.merchant}</span>
                  {expense.flag ? <span className="flag">{expense.flag}</span> : null}
                </td>
                <td>{expense.category}</td>
                <td>{expense.person}</td>
                <td>{expense.date}</td>
                <td className="num">{money(expense.amount)}</td>
                <td>
                  <span className={`pill pill-${expense.status.toLowerCase()}`}>
                    {expense.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="note">
        <p>
          <strong>What to look at here.</strong> The support bubble in the corner is the whole
          HelpWell browser install — one script tag in <code>app/layout.tsx</code>. Ask it something
          about receipts, approvals or SSO and the answer is grounded in the Markdown under{' '}
          <code>helpwell/docs/</code>.
        </p>
        <p>
          Sign in as Ada in the header and the same widget starts calling you by name, because the
          page now hands it a signed identify token. Sign in as an admin and every conversation you
          have shows up in the dashboard.
        </p>
      </div>
    </>
  );
}
