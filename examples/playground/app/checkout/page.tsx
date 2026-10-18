/**
 * The page with no support bubble.
 *
 * The widget's display rules in settings exclude `/checkout`, so the loader
 * still runs here and the bundle still downloads — and then `shouldShow()`
 * returns false and nothing mounts. The engage banner is excluded from this
 * path too.
 *
 * This is the ordinary reason a team reaches for display rules: a page where an
 * interruption costs money.
 */
export default function CheckoutPage() {
  return (
    <>
      <h1>Checkout</h1>
      <p className="lede">
        Ridgeline Team, 14 seats, billed monthly. Nothing on this page is real and nothing is
        submitted anywhere.
      </p>

      <div className="section panel">
        <div className="panel-head">
          <h2>Order summary</h2>
        </div>
        <div className="panel-body">
          <table>
            <tbody>
              <tr>
                <td>Ridgeline Team — 14 seats</td>
                <td className="num">£98.00</td>
              </tr>
              <tr>
                <td>Proration, 11 days remaining</td>
                <td className="num">−£62.07</td>
              </tr>
              <tr>
                <td>
                  <strong>Due today</strong>
                </td>
                <td className="num">
                  <strong>£35.93</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <p style={{ color: 'var(--ink-faint)', fontSize: 13, marginBottom: 0, marginTop: 16 }}>
            This demo does not collect payment details and has no form to fill in.
          </p>
        </div>
      </div>

      <div className="note note-warn">
        <p>
          <strong>What to look at here: nothing in the corner.</strong> No support bubble, no
          banner. The widget bundle downloaded exactly as it did on every other page, read the
          display rules from <code>/api/helpwell/config</code>, found <code>/checkout</code> in the
          exclude list, and declined to mount.
        </p>
        <p>
          The rule lives in <code>widget.displayRules.exclude</code> in HelpWell&rsquo;s settings —
          seeded in <code>lib/seed.ts</code> and editable in the dashboard under Settings &rarr;
          Widget. Exclude always beats include.
        </p>
      </div>
    </>
  );
}
