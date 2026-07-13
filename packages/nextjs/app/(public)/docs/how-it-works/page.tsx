export default function HowTokenlessWorksPage() {
  return (
    <article className="prose max-w-none">
      <h1>How it works</h1>
      <p>
        The public tokenless deployment is a simulated sandbox. It previews suite setup and the reviewer journey; it
        does not currently recruit or pay live reviewers and its output is not live human evidence.
      </p>
      <ol>
        <li>
          The customer creates a client-isolated project, freezes a baseline, a candidate, representative cases, a
          rubric, and a pass rule.
        </li>
        <li>
          The customer chooses customer-invited reviewers, a RateLoop-network panel, separate hybrid subpanels, or a
          simulated sandbox. The exact audience policy is content-hashed.
        </li>
        <li>Submitted material is minimized, redacted, encrypted, and shown only through short assignment leases.</li>
        <li>Any paid quote itemizes bounty, fee, and maximum accepted-work reserve before funding.</li>
        <li>
          Before a paid assignment or voucher, reviewers complete the policy&apos;s capability and legal/payout gates.
        </li>
        <li>
          Reviewers compare blinded A/B artifacts, choose an option, add bounded failure tags, and explain the
          difference without seeing other answers.
        </li>
        <li>Paid case rounds use sealed commits and permissionless deterministic settlement.</li>
        <li>
          Zero-commit rounds refund fully; failed quorum or beacon paths refund bounty and fee while accepted valid work
          remains compensable from the disclosed reserve.
        </li>
        <li>
          A private decision packet separates reviewer coverage from case judgments and reports per-case descriptive
          results, disagreement, reviewer source, limitations, and any valid settlement evidence. The customer records
          the final go, revise, or stop decision separately.
        </li>
      </ol>
      <h2>One focused quality gate</h2>
      <p>
        The current product is strongest when one panel can change the next action: approve, revise, retest, escalate,
        or stop. It is not a substitute for domain testing, monitoring, legal review, or accountable human approval.
      </p>
      <h2>No post-commit cancellation</h2>
      <p>After the first accepted paid commit, the round follows its deterministic settlement or compensation path.</p>
      <h2>Privacy, identity, and recovery</h2>
      <p>
        RateLoop can process encrypted private artifacts and participating reviewers see only their assigned material,
        but customers must still minimize sensitive data and exclude regulated or safety-critical use cases from early
        access. Invitations are the default private B2B access path. External identity assurance is optional and used
        only when a frozen audience policy requires a specific capability.
      </p>
      <p>
        One-time vote and payout keys are created in the browser and exported in an encrypted recovery package. The
        operator never receives those keys. Claiming publicly links the vote key to its per-round payout address.
      </p>
    </article>
  );
}
