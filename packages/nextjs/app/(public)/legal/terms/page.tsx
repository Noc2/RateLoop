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
      <h2>Trust and privacy limits</h2>
      <p>
        The immutable panel core has no operator withdrawal path. A separate issuer can control future admission but
        cannot redirect escrow or change accepted commits. A normal claim publicly links its vote key to the selected
        payout destination; RateLoop does not promise cross-round unlinkability.
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
