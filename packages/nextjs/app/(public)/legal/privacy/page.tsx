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
      <p>
        RateLoop acts as controller for accounts, security, billing, service operations, paid-reviewer eligibility and
        settlement. For personal data in private material that a business customer submits and controls, RateLoop
        generally acts as that customer&apos;s processor under the{" "}
        <Link href="/legal/dpa">Data Processing Addendum</Link>. The role depends on the actual purpose and means of
        each processing activity.
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
        Each customer artifact has its own random data-encryption key. In the current isolated deployment, designated
        private fields and artifact keys are protected by purpose-separated, server-only application keyrings and an
        authenticated envelope-encryption boundary. Authorized RateLoop workloads can decrypt covered data when needed
        to provide the service. Hosted artifact wrapping derives workspace/project keys from a versioned root in
        Vercel&apos;s server-only secret store. This is application-managed encryption, not a customer-held-key or
        non-exportable hardware-security-module boundary. Key inventory, rotation and rewrapping, recovery,
        least-privilege access tests, and the DPIA remain release gates before real customer material is accepted in a
        hosted release.
      </p>
      <h2>Purposes and legal bases</h2>
      <p>
        RateLoop processes account, workspace, assignment, response, and delivery data to perform the service and the
        applicable contract; security and abuse signals to protect accounts, reviewers, customers, and the service on
        the basis of legitimate interests; and billing, tax, sanctions, dispute, and statutory records where a legal
        obligation applies. Optional notification email is enabled at the user&apos;s request and can be disabled or
        unsubscribed. RateLoop does not use personal data for advertising or cross-site profiling.
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
      <h2 id="on-chain-data">On-chain data</h2>
      <p>
        Public-chain interactions publish transaction addresses, commitments, round terms, settlement data, claims, and
        each paid commit&apos;s timelock ciphertext. That ciphertext contains the vote, prediction, response hash,
        payout address, and salt. A commit irrevocably schedules those details to become publicly decryptable at the
        configured drand beacon after the commit deadline, whether or not the reviewer or keeper submits a reveal or
        claim; there is no post-commit abort. Reveal transactions also publish their plaintext calldata. These records
        are visible to third parties and generally cannot be erased by the interface operator. Reusing a funding or
        payout address can link paid activity across rounds even though the RateLoop account principal itself is opaque.
      </p>
      <p>
        RateLoop presents the public-record disclosure before a reviewer can create a recovery backup or request a paid
        commit. The blockchain assessment follows data-protection-by-design principles and considers the European Data
        Protection Board&apos;s final{" "}
        <a href="https://www.edpb.europa.eu/documents/guideline/guidelines-on-processing-of-personal-data-through-blockchain-technologies_en">
          Guidelines 02/2025 on processing personal data through blockchain technologies, version 2.0
        </a>{" "}
        of 7 July 2026. Before a hosted launch accepts real customer material, RateLoop must complete and approve a
        blockchain-specific DPIA and a current provider, subprocessor, and international-transfer inventory. Until both
        release gates are complete, RateLoop does not claim launch-level GDPR compliance.
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
      <p>
        In the customer-invited paid lane, the inviting workspace must expressly warrant that the invitee is at least
        18. That customer attestation is not government-document age verification. Sanctions screening is a separate
        first-party manual decision and may delay eligibility; an invitation alone never approves paid work. The
        RateLoop-network lane may use a configured identity provider for minimum-age or unique-human predicates, with
        raw identity details minimized where possible. A reviewer may contact RateLoop to contest or correct an
        eligibility record.
      </p>
      <h2>Reviewer forecast integrity</h2>
      <p>
        When a terminal review includes a crowd forecast, RateLoop uses aggregate forecast counters to detect repeated
        low-effort or lockstep reporting and protect the availability and integrity of future assignments. The service
        keeps running sums for calibration, variance, outcome and vote discrimination, plus workspace-level forecast
        histograms and pair-distance sums. It does not create a new per-round forecast history. After a private result
        is aggregated, the individual forecast is removed from the private response row. Forecasts published through a
        paid public-chain commit remain subject to the on-chain disclosure described above.
      </p>
      <p>
        Invited-review counters use a server-keyed reference scoped to the principal and workspace. Network-review
        counters use the restricted RateLoop rater identifier. These are deliberately separate identity spaces:
        invited-review history is not used for network admission. This processing is based on RateLoop&apos;s legitimate
        interests in abuse prevention, service security, and reliable reviewer assignment. It never reduces or withholds
        pay already earned. A hard aggregate finding can pause new assignments; the reviewer dashboard shows the
        applicable reason codes and counters. A reviewer can open an appeal, and the assignment consequence is suspended
        while that appeal is open.
      </p>
      <h2>Recipients, processors, and international transfers</h2>
      <p>
        RateLoop uses service providers for hosting, database/runtime operations, email, billing, and optional identity
        or wallet features. The current categories, named providers, feature conditions, and change-notice process are
        listed on the <Link href="/legal/subprocessors">subprocessor page</Link>. Where covered data is transferred
        outside the EEA, RateLoop uses an applicable adequacy decision or contractual transfer safeguards and
        supplementary measures as required. Public blockchain publication is a separate, user-visible replication
        boundary and not a private processor copy.
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
        recreating a deleted account. Expired or revoked session and sign-in security telemetry is purged on a rolling
        35-day operational schedule; terminal notification-delivery records are purged after 90 days. Generated
        subject-access exports expire after seven days. Statutory accounting, tax, payout, fraud, dispute, and
        legal-hold records follow their documented legal schedule and can remain restricted rather than erased while
        that duty applies. Linkable off-chain forecast accumulators, pair records, findings, and appeals are retained
        during the account or workspace lifetime while they are needed for assignment integrity; eligible rows are
        erased with account or workspace deletion. A later sign-up starts a new account. Backup copies expire under the
        applicable backup schedule, and public blockchain records remain outside the operator&apos;s ability to erase.
      </p>
      <p>
        You may request access, correction, deletion where available, restriction, portability, or object to processing,
        and may withdraw consent for future processing where consent is the basis. Signed-in access and export requests
        enter an authenticated queue; completed exports are available only to the requesting principal for seven days.
        Other requests and questions may be sent to the controller address above. RateLoop normally responds within one
        month, subject to lawful extensions, identity verification, legal holds, and retention duties. You may complain
        to the{" "}
        <a href="https://www.datenschutz.rlp.de/service/kontakt">
          Landesbeauftragte für den Datenschutz und die Informationsfreiheit Rheinland-Pfalz
        </a>{" "}
        or another competent supervisory authority.
      </p>
      <h2>Cookies and local storage</h2>
      <p>
        RateLoop does not load audience analytics and does not set advertising cookies. It uses first-party
        authentication cookies and limited browser storage for requested functions such as drafts, device recovery,
        provider handoff state, and a remembered integration choice. Details and lifetimes are in the{" "}
        <Link href="/legal/cookies">cookies and browser storage policy</Link>. The privacy-enhanced YouTube player is
        contacted only after a user chooses to play an attached video.
      </p>
    </article>
  );
}
