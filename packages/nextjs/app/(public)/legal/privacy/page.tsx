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
        The quote and ask API stores request payloads, itemized economics, idempotency keys, operation keys, statuses,
        and sandbox results in the isolated branch database. The explicit sandbox may use temporary in-process storage
        if that database is unavailable. The site uses privacy-preserving aggregate analytics without advertising or
        cross-site profiling.
      </p>
      <h2>On-chain data</h2>
      <p>
        Future test interactions may publish transaction addresses, commitments, round terms, settlement data, and
        claims to Base Sepolia. Public-chain records are visible to third parties and generally cannot be erased by the
        interface operator. A normal claim links a vote key to its payout destination.
      </p>
      <h2>Paid eligibility</h2>
      <p>
        Production mode collects identity tier, age confirmation, residence, applicable tax/DAC7 fields, sanctions
        screening state, and payout Base Account ownership before the first paid voucher. Provider results, tax data,
        and stable nullifier seeds are envelope-encrypted under versioned server-only keys. Advisory browsing does not
        require this unlock. Public round records contain commitments rather than the eligibility payload.
      </p>
      <h2>Retention and rights</h2>
      <p>
        Test database records may be deleted when the isolated deployment is reset. Statutory retention may apply once
        real payments exist. You may request access, correction, deletion where available, restriction, or object to
        processing by contacting the address above; public blockchain records remain outside the operator&apos;s ability
        to erase.
      </p>
    </article>
  );
}
