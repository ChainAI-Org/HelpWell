/**
 * The official rules the seeded giveaway links to.
 *
 * HelpWell refuses to save a giveaway without a rules link, and shows it under
 * the form's button, so the playground needs a page for it to point at. The
 * rules are Ridgeline's to write; HelpWell only runs the entries and the draw.
 */
export default function GiveawayRulesPage() {
  return (
    <>
      <h1>Giveaway rules</h1>
      <p className="lede">
        Win a year of Ridgeline Business. Ridgeline is not a real company, so neither is the prize.
      </p>

      <div className="section panel">
        <div className="panel-body">
          <ol>
            <li>No purchase is necessary, and buying Ridgeline does not improve your chances.</li>
            <li>
              Enter once, with your work email. Entries close 30 days after the giveaway opens.
            </li>
            <li>
              Everyone who enters gets a share link. Each person who enters through yours earns you
              three more entries, up to twenty in all.
            </li>
            <li>
              Winners are drawn at random, weighted by entries. The draw records its seed, so anyone
              can check the result.
            </li>
            <li>The prize is a year of Ridgeline Business for one workspace of up to 50 people.</li>
          </ol>
        </div>
      </div>
    </>
  );
}
