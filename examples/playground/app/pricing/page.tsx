import { HELP_PATH } from '../../lib/paths';

const PLANS = [
  {
    name: 'Free',
    price: '£0',
    per: 'up to 3 people',
    featured: false,
    features: ['Expenses and receipts', 'One approval rule', 'CSV export', '30 days of audit log'],
  },
  {
    name: 'Team',
    price: '£7',
    per: 'per person / month',
    featured: true,
    features: [
      'Everything in Free',
      'Card feeds and receipt matching',
      'Unlimited approval policies',
      'Xero and QuickBooks export',
      '1 year of audit log',
    ],
  },
  {
    name: 'Business',
    price: '£12',
    per: 'per person / month',
    featured: false,
    features: [
      'Everything in Team',
      'SAML SSO and SCIM',
      'NetSuite export',
      'Per-diem allowances',
      '7 years of audit log',
    ],
  },
];

export default function PricingPage() {
  return (
    <>
      <h1>Pricing</h1>
      <p className="lede">
        Per active person per month. Deactivated people do not count, and adding somebody mid-period
        is prorated.
      </p>

      <div className="plans">
        {PLANS.map((plan) => (
          <div className={plan.featured ? 'plan featured' : 'plan'} key={plan.name}>
            <h2>{plan.name}</h2>
            <div className="price">{plan.price}</div>
            <div className="per">{plan.per}</div>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <a className={plan.featured ? 'btn' : 'btn btn-quiet'} href="/checkout">
              Choose {plan.name}
            </a>
          </div>
        ))}
      </div>

      {/*
        A HelpWell form, embedded. The widget's loader finds this element and
        draws the giveaway into it, in its own shadow root, with a one-time
        token so a submission can be told from a bot's. The same form is on
        the widget's Home tab. It is seeded in lib/seed.ts.
      */}
      <div className="section" data-helpwell-form="business-giveaway" />

      <div className="note">
        <p>
          <strong>What to look at here.</strong> The exact questions this page provokes — seat
          proration, annual commitments, what happens when a card fails — are answered in{' '}
          <a href={`${HELP_PATH}/admin-and-billing/plans-and-invoices`}>
            Plans, seats and invoices
          </a>
          . Ask the widget about any of them and watch it cite that article.
        </p>
        <p>
          The banner across the top of these pages is a HelpWell engagement, not part of Ridgeline.
          It is defined in settings and excluded from <code>/checkout</code>, same as the widget. So
          is the three-slide &ldquo;what&rsquo;s new&rdquo; carousel that opens here once.
        </p>
        <p>
          The giveaway above is a HelpWell form. Entries land in the dashboard under Forms, where
          the draw is run.
        </p>
      </div>
    </>
  );
}
