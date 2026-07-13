import Link from "next/link";

export default function PrivacyPage() {
  return (
    <article className="prose legal-prose mx-auto max-w-4xl px-4 py-12">
      <Link href="/legal">&larr; Legal</Link>
      <h1>RateLoop test privacy notice</h1>
      <p>Last updated: July 2026</p>
      <h2>Controller</h2>
      <p>
        Hawig Ventures UG (haftungsbeschränkt), Herzogin-Juliana-Straße 7, 55469 Simmern, Germany. Contact:
        hawigxyz@proton.me.
      </p>
      <h2>Current test data</h2>
      <p>
        The isolated service stores workspaces, projects, frozen evaluation manifests, reviewer policies, assignments,
        responses, access events, itemized economics, and operational identifiers. Customer artifacts are encrypted
        before private object storage; database rows keep opaque object references and tenant-scoped metadata. Assigned
        reviewers receive short-lived leases only for their blinded cases. Sandbox responses are simulated test data.
        The site does not use advertising or cross-site profiling.
      </p>
      <h2>On-chain data</h2>
      <p>
        Future test interactions may publish transaction addresses, commitments, round terms, settlement data, and
        claims to Base Sepolia. Public-chain records are visible to third parties and generally cannot be erased by the
        interface operator. A normal claim links a vote key to its payout destination.
      </p>
      <h2>Paid eligibility</h2>
      <p>
        Customer-invited unpaid reviews do not require a global identity provider. Paid human-assurance assignments are
        currently unavailable; before enabling them, RateLoop must bind the exact assignment policy through current
        capability, minimum-age, sanctions, tax/DAC7, payout, voucher, settlement, and receipt checks. Declared
        residence, tax residence, document issuer, nationality, and any verified residence predicate remain separate
        fields. Provider evidence, statutory tax records, customer artifacts, and private rationales use separate
        server-only encryption domains; response pseudonyms use a separate keyed-hash domain. Public round records
        contain commitments and settlement data, not the eligibility payload or raw rationale. For paid work, the
        service database must retain a restricted mapping between the reviewer, voucher, vote key, and nullifier for
        eligibility, abuse control, and payment operations; RateLoop does not claim database-level anonymity.
      </p>
      <h2>Retention and rights</h2>
      <p>
        Workspace and project retention settings control private artifact deletion and access logging. Test records may
        also be deleted when the isolated deployment is reset. Legal holds and statutory retention may apply once real
        payments exist. You may request access, correction, deletion where available, restriction, or object to
        processing by contacting the address above; public blockchain records remain outside the operator&apos;s ability
        to erase.
      </p>
    </article>
  );
}
