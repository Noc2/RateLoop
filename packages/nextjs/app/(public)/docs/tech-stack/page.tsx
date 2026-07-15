export default function TokenlessTechStackPage() {
  return (
    <article className="prose max-w-none">
      <h1>Tech stack</h1>
      <p>
        RateLoop is tokenless: reviewers never buy, stake, or receive LREP. Quality and attack resistance instead come
        from several independent, disclosed controls. None of them proves that an individual answer is true.
      </p>
      <p>
        The public tokenless deployment is an explicit simulated sandbox. The production architecture below is not a
        claim that the sandbox uses live reviewers, money, or verified EU resources.
      </p>
      <h2>Settlement and reporting incentives</h2>
      <ul>
        <li>Base for low-cost, USDC-denominated settlement and publicly recomputable contract evidence.</li>
        <li>An immutable, adminless fund core with USDC-denominated bounty, fee, and attempt reserve.</li>
        <li>Voucher-bound one-time vote keys, relayed commits, sealed reports, and permissionless settlement.</li>
        <li>
          A fixed base payment for accepted work plus a bounded binary Robust Bayesian Truth Serum bonus. The public
          scoring rule uses the reviewer&apos;s report, prediction, and seeded canonical peers; unused bonus is
          refunded.
        </li>
        <li>
          A versioned, centralized Surprisingly Popular bounty with a pre-reserved platform-funded maximum. It uses
          current-round predictions, a minimum panel size, a qualification threshold, leave-one-out scoring, and a fixed
          per-reviewer cap.
        </li>
        <li>drand/tlock sealing with a self-reveal fallback.</li>
      </ul>
      <p>
        RBTS makes random, copied, or strategically uninformative reporting less attractive under its published model
        assumptions. The surprise bounty can only add a separate USDC top-up after the reviewer&apos;s base claim; it
        cannot alter the majority verdict, contract settlement, fixed pay, or RBTS pay. Neither mechanism is a truth
        oracle or defeats coordinated real humans by itself.
      </p>
      <h2>Admission and panel integrity</h2>
      <ul>
        <li>
          World ID 4 Proof of Human for RateLoop-network supply, verified server-side and mapped only to a
          provider-scoped <code>unique_human</code> capability. It is a one-time, durable RateLoop-account enrollment,
          not an ongoing liveness check; World session proofs are not used because World exposes no cryptographic link
          from a session subject to the enrollment nullifier.
        </li>
        <li>
          Signed, point-in-time correlation epochs for prospective cluster-diversified assignment. Private linkage
          features stay encrypted; buyer evidence contains only aggregate constraints, hashes, and limitation codes.
        </li>
        <li>
          Versioned post-round correlation analytics gate verdict publication and future eligibility, never accepted
          work payment. Appeals and the original epoch remain auditable.
        </li>
        <li>
          Dedicated server-only roles keep credential issuance, gas relay, prepaid funding, and the central
          surprise-bonus fund separate. The bonus funder transfers only its own USDC and has no operator path into the
          immutable customer-funded contract core.
        </li>
      </ul>
      <p>
        World ID limits duplicate provider subjects; it does not establish expertise, legal payout eligibility,
        independence, or honest judgment. Customer-invited panels remain a separate audience with explicit limitations.
      </p>
      <h2>Application and evidence</h2>
      <ul>
        <li>
          Better Auth account-first sign-in resolves to an opaque RateLoop principal. Self-custodial and optional
          thirdweb wallets are separately bound only for funding, payout, or recovery.
        </li>
        <li>Postgres-backed agent quote and ask state.</li>
        <li>
          EU-first classification, permitted-use, retention, legal-hold, project-assignment, and subject-request
          controls. Live EU resource verification remains a separate release gate.
        </li>
        <li>
          Integrity-chained, tenant-exportable application audit records. They are not represented as an immutable or
          WORM external audit log.
        </li>
        <li>
          Durable surprise-bounty reservations and entitlements, indexed base-claim matching, dedicated signer nonce
          allocation, exact USDC receipt verification, bounded retry, and fail-closed reconciliation.
        </li>
        <li>Versioned quote → ask → wait → result API and SDK.</li>
        <li>Public deterministic settlement evidence plus privacy-minimized, customer-scoped decision packets.</li>
      </ul>
    </article>
  );
}
