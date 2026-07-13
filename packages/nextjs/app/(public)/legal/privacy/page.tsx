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
      <h2>Agent and browser handoffs</h2>
      <p>
        The public MCP accepts only material that the caller confirms is public, synthetic, or safely redacted. It
        processes an approved draft to create a browser handoff but does not store that draft. The complete draft and a
        high-entropy bearer token are placed in the URL fragment, which browsers do not send in normal HTTP requests.
        The reviewed question and panel terms are stored when the user requests an exact quote; submitting the ask is a
        separate explicit action. Anyone who receives the complete handoff URL may be able to inspect the draft and
        later read its status or result, so users must not share it or include secrets, credentials, regulated personal
        data, or confidential customer material.
      </p>
      <h2>Browser sign-in</h2>
      <p>
        Browser users may sign in through thirdweb using email, Google, Apple, a passkey, or a supported external
        wallet. thirdweb and the selected sign-in provider process authentication data under their own terms. RateLoop
        receives the resulting wallet address and, for an in-app wallet, may store the verified provider, thirdweb user
        identifier, normalized email address and domain, and display name needed for account access and audit UX.
        RateLoop stores its own hashed, time-limited browser session; it does not store the thirdweb secret key or a
        social-provider token in the browser session. An email domain alone never grants workspace membership.
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
