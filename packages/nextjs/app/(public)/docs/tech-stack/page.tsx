export default function TokenlessTechStackPage() {
  return (
    <article className="prose max-w-none">
      <h1>Tech stack</h1>
      <p>
        RateLoop is tokenless: reviewers never buy, stake, or receive LREP. Quality and attack resistance instead come
        from several independent, disclosed controls. None of them proves that an individual answer is true.
      </p>
      <h2>Settlement and reporting incentives</h2>
      <ul>
        <li>Base Sepolia for the isolated test deployment; Base for the eventual hardened deployment.</li>
        <li>An immutable, adminless fund core with USDC-denominated bounty, fee, and attempt reserve.</li>
        <li>Voucher-bound one-time vote keys, relayed commits, sealed reports, and permissionless settlement.</li>
        <li>
          A fixed base payment for accepted work plus a bounded binary Robust Bayesian Truth Serum bonus. The public
          scoring rule uses the reviewer&apos;s report, prediction, and seeded canonical peers; unused bonus is
          refunded.
        </li>
        <li>drand/tlock sealing with a self-reveal fallback.</li>
      </ul>
      <p>
        RBTS makes random, copied, or strategically uninformative reporting less attractive under its published model
        assumptions. It is not a truth oracle and does not defeat coordinated real humans by itself.
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
          A per-round Surprisingly Popular diagnostic runs in shadow mode only. It cannot change settlement or the
          primary verdict unless a later, separately reviewed mechanism version explicitly adopts it.
        </li>
      </ul>
      <p>
        World ID limits duplicate provider subjects; it does not establish expertise, legal payout eligibility,
        independence, or honest judgment. Customer-invited panels remain a separate audience with explicit limitations.
      </p>
      <h2>Application and evidence</h2>
      <ul>
        <li>Postgres-backed agent quote and ask state.</li>
        <li>Versioned quote → ask → wait → result API and SDK.</li>
        <li>Public deterministic settlement evidence plus privacy-minimized, customer-scoped decision packets.</li>
      </ul>
    </article>
  );
}
