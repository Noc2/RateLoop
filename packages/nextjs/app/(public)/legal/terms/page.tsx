import Link from "next/link";

export default function TermsPage() {
  return (
    <article className="prose legal-prose mx-auto max-w-4xl px-4 py-12">
      <Link href="/legal">&larr; Legal</Link>
      <h1>RateLoop terms</h1>
      <p>Last updated: July 2026</p>
      <h2>Service scope</h2>
      <p>
        RateLoop provides software for blinded human assurance, workspace coordination, reviewer access, decision
        evidence, and, where offered, itemized participant compensation and public-chain settlement. The interface
        displays the available reviewer source and economic terms before a run is funded.
      </p>
      <h2>Who may use it</h2>
      <p>
        You must be at least 18 and legally permitted to use the service. Real-money funder flows are intended for
        approved business customers whose workspace trader details have been verified. Paid assignments require an exact
        frozen assignment policy and all applicable capability, tax, sanctions, payout, voucher, settlement, and receipt
        checks.
      </p>
      <h2>Customer material and reviewers</h2>
      <p>
        Customers must have the right to submit evaluation material, minimize and redact personal or confidential data,
        choose appropriate reviewers, and provide any required notices. A one-time invitation proves project access, not
        unique humanity, expertise, legal residence, or paid-work eligibility. Customer-invited, RateLoop-network, and
        hybrid results are labeled separately.
      </p>
      <h2>Funding and accepted work</h2>
      <p>
        The protocol itemizes bounty, platform fee, and maximum attempt reserve before funding. Once the first paid
        commit is accepted, a funder cannot cancel the round. Accepted work must reach the disclosed paid or compensated
        terminal path even when quorum or infrastructure fails.
      </p>
      <h2>Workspace subscriptions</h2>
      <p>
        RateLoop may offer a recurring business-to-business workspace subscription. The displayed price, billing period,
        included review-decision allowance, and applicable tax are confirmed before checkout. Subscriptions renew
        automatically until cancelled. Cancellation takes effect at the end of the paid period; already-accepted review
        work may finish and historical evidence is not deleted merely because a plan ends.
      </p>
      <p>
        The Early Access price applies for the first 12 months. RateLoop will give at least 60 days&apos; notice before
        a later price change. After the first 12 months, founding customers receive 20% off the then-current comparable
        monthly plan. There is no lifetime price guarantee, and a customer may cancel before a new price takes effect.
      </p>
      <h2>Separate subscription and panel costs</h2>
      <p>
        A workspace subscription pays for access to the RateLoop software and its plan limits. It does not include
        participant bounty, attempt reserve, or the separately disclosed public-panel execution fee. Those panel costs
        are itemized before funding and do not increase a workspace&apos;s subscription allowance.
      </p>
      <h2>Billing, taxes, and refunds</h2>
      <p>
        Subscriptions are intended for approved business customers. Customers must provide accurate legal, invoice,
        trader, tax, and VAT details and remain responsible for taxes not collected at checkout. Stripe processes
        subscription payment details and provides invoices and receipts. Except where law requires otherwise or RateLoop
        agrees in writing, paid subscription periods are non-refundable.
      </p>
      <h2>Trust and privacy limits</h2>
      <p>
        The immutable panel core has no operator withdrawal path. A separate issuer controls new voucher admission. If
        its signer is compromised, an attacker can fill remaining seats in open rounds, influence their verdicts, and
        direct the bounties for those attacker-controlled reports until the signer is rotated. The issuer still cannot
        redirect escrow, redirect another report&apos;s claim, or change an accepted commit.
      </p>
      <p>
        A paid commit publishes a timelock-encrypted vote, prediction, response hash, payout address, and salt. The
        commit irrevocably schedules those details to become publicly decryptable at the configured drand beacon after
        the commit deadline, whether or not the reviewer or keeper later reveals or claims; there is no post-commit
        abort. Reusing a payout destination can link rounds.
      </p>
      <p>
        Circle retains token-layer authority over USDC and can pause or blacklist transfers, including transfers to or
        from an escrow contract. The panel&apos;s no-operator-withdrawal design does not override those USDC controls.
      </p>
      <h2>Use of results</h2>
      <p>
        RateLoop supplies decision evidence, limitations, and settlement records. The customer remains responsible for
        the final go, revise, or stop decision. RateLoop results are not financial, legal, medical, or investment advice
        and must not be used as an automatic approval for regulated or safety-critical decisions.
      </p>
      <h2>Operator</h2>
      <p>
        The interface is operated by Hawig Ventures UG (haftungsbeschränkt). See the{" "}
        <Link href="/legal/imprint">imprint</Link>
        for contact information.
      </p>
    </article>
  );
}
