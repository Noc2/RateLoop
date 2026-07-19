import Link from "next/link";

export default function PrivacyPage() {
  return (
    <article className="prose legal-prose mx-auto max-w-4xl px-4 py-12">
      <Link href="/legal">&larr; Legal</Link>
      <h1>RateLoop privacy notice</h1>
      <p>Last updated: July 2026</p>
      <h2>Controller</h2>
      <p>
        Hawig Ventures UG (haftungsbeschränkt), Herzogin-Juliana-Straße 7, 55469 Simmern, Germany. Contact:
        hawigxyz@proton.me.
      </p>
      <h2>Service data</h2>
      <p>
        The isolated service stores workspaces, projects, frozen evaluation manifests, reviewer policies, assignments,
        responses, access events, itemized economics, and operational identifiers. Customer artifacts are encrypted
        before private object storage; database rows keep opaque object references and tenant-scoped metadata. Assigned
        reviewers receive short-lived leases only for their blinded cases. The site does not use advertising or
        cross-site profiling.
      </p>
      <p>
        Each customer artifact has its own random data-encryption key, but those keys currently wrap to an
        operator-controlled server or KMS authority shared by tenant artifacts within a key domain. Authorized RateLoop
        systems can therefore decrypt customer artifacts in that domain to provide the service. Per-tenant or
        per-project wrapping keys are not yet implemented.
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
        Browser users sign in through RateLoop&apos;s self-hosted Better Auth service using an email one-time code or a
        registered passkey. Google and Apple are offered only when their credentials are configured. Better Auth and the
        selected email or social provider process the authentication data needed for that sign-in. RateLoop maps the
        provider subject to an opaque RateLoop principal that is independent of any wallet, then exchanges the short
        Better Auth session for its own hashed, time-limited, HttpOnly application session. Ordinary account, workspace,
        invited unpaid review, and API-key agent use do not create or require a wallet. An email address or domain alone
        never grants workspace membership or project access.
      </p>
      <h2>Optional wallets</h2>
      <p>
        A signed-in user may explicitly connect a self-custodial wallet or ask thirdweb to create an app-scoped wallet
        for public USDC funding, payout, or recovery. RateLoop sends thirdweb a five-minute, audience-bound JWT whose
        subject is only the opaque principal identifier; the token does not include an email address or display name.
        The wallet must then sign a one-time proof bound to the RateLoop domain, principal, configured Base chain,
        wallet address, selected purpose, nonce, and expiry. Each binding is revocable and never authorizes general
        account or workspace access. thirdweb processes wallet creation and recovery under its own terms. Users of a
        self-custodial wallet remain responsible for their keys and recovery method.
      </p>
      <h2>Subscription billing</h2>
      <p>
        When a business purchases or manages a workspace subscription, Stripe processes payment-card details, billing
        address, tax or VAT identifiers, invoice identity, payment status, and related fraud-prevention data under its
        own privacy terms. RateLoop stores the workspace&apos;s Stripe customer and subscription identifiers, plan,
        subscription status, billing period, cancellation state, webhook processing records, and decision-usage
        allocations. RateLoop does not store full card details. Subscription records remain separate from prepaid USDC,
        public-panel funding, participant payout, and settlement records.
      </p>
      <h2>On-chain data</h2>
      <p>
        Public-chain interactions publish transaction addresses, commitments, round terms, settlement data, claims, and
        each paid commit&apos;s timelock ciphertext. That ciphertext contains the vote, prediction, response hash,
        payout address, and salt. A commit irrevocably schedules those details to become publicly decryptable at the
        configured drand beacon after the commit deadline, whether or not the reviewer or keeper submits a reveal or
        claim; there is no post-commit abort. Reveal transactions also publish their plaintext calldata. These records
        are visible to third parties and generally cannot be erased by the interface operator. Reusing a funding or
        payout address can link paid activity across rounds even though the RateLoop account principal itself is opaque.
      </p>
      <h2>Paid eligibility</h2>
      <p>
        Customer-invited unpaid reviews do not require a global identity provider. Before a paid assignment, RateLoop
        binds the exact assignment policy through current capability, minimum-age, sanctions, tax/DAC7, payout, voucher,
        settlement, and receipt checks. Declared residence, tax residence, document issuer, nationality, and any
        verified residence predicate remain separate fields. Provider evidence, statutory tax records, customer
        artifacts, and private rationales use separate server-only encryption domains; response pseudonyms use a
        separate keyed-hash domain. Public round records contain commitments and settlement data, not the eligibility
        payload or raw rationale. For paid work, the service database must retain a restricted mapping between the
        reviewer, voucher, vote key, and nullifier for eligibility, abuse control, and payment operations; RateLoop does
        not claim database-level anonymity.
      </p>
      <h2>Retention and rights</h2>
      <p>
        Workspace and project retention settings control private artifact deletion and access logging. Subscription
        cancellation does not override an agreed evidence-retention setting or erase records required for audit, dispute
        handling, accounting, legal holds, or statutory retention. A workspace owner can delete a workspace in the
        product once its funds, subscription, open work, and unsettled billing obligations are resolved. A signed-in
        user can delete their account after deleting owned workspaces, resolving accepted work, and deactivating any
        managed wallet. Deletion revokes access and erases or anonymizes eligible off-chain account and workspace data;
        retained categories remain subject to their applicable purpose and schedule.
      </p>
      <p>
        RateLoop temporarily retains a revoked sign-in binding for 35 days to prevent an in-flight sign-in from
        recreating a deleted account. A later sign-up starts a new account. Backup copies expire under the applicable
        backup schedule, and public blockchain records remain outside the operator&apos;s ability to erase. You may also
        request access, correction, deletion where available, restriction, or object to processing by contacting the
        address above.
      </p>
    </article>
  );
}
