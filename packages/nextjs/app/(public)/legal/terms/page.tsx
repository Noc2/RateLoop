import Link from "next/link";

export default function TermsPage() {
  return (
    <article className="prose legal-prose mx-auto max-w-4xl px-4 py-12">
      <Link href="/legal">&larr; Legal</Link>
      <h1>RateLoop test terms</h1>
      <p>Last updated: July 2026</p>
      <h2>Test-only service</h2>
      <p>
        The public branch deployment is isolated from the existing service. Sandbox balances and deterministic results
        may be reset. Production-mode vouchers and funding activate only after a fresh contract deployment and complete
        environment verification.
      </p>
      <h2>Who may use it</h2>
      <p>
        You must be at least 18 and legally permitted to use the service. Real-money funder flows are intended for
        approved business customers. Paid rater access remains unavailable until identity, residence, tax, sanctions,
        and self-custodial payout setup are completed before the first paid task.
      </p>
      <h2>Funding and accepted work</h2>
      <p>
        The target protocol itemizes bounty, platform fee, and maximum attempt reserve before funding. Once the first
        paid commit is accepted, a funder cannot cancel the round. Accepted work must reach the disclosed paid or
        compensated terminal path even when quorum or infrastructure fails.
      </p>
      <h2>Trust and privacy limits</h2>
      <p>
        The immutable panel core has no operator withdrawal path. A separate issuer can control future admission but
        cannot redirect escrow or change accepted commits. A normal claim publicly links its vote key to the selected
        payout destination; this test does not promise cross-round unlinkability.
      </p>
      <h2>Use of results</h2>
      <p>Test results are not financial, legal, medical, or investment advice.</p>
      <h2>Operator</h2>
      <p>
        The interface is operated by Hawig Ventures UG (haftungsbeschränkt). See the{" "}
        <Link href="/legal/imprint">imprint</Link>
        for contact information.
      </p>
    </article>
  );
}
