export default function HowTokenlessWorksPage() {
  return (
    <article className="prose max-w-none">
      <h1>How it works</h1>
      <p>
        RateLoop turns a defined quality question into blinded human judgment, recomputable incentive evidence, and a
        decision packet that keeps the final action with the customer.
      </p>
      <ol>
        <li>
          The customer creates a client-isolated project, freezes a baseline, a candidate, representative cases, a
          rubric, and a pass rule.
        </li>
        <li>
          The customer chooses customer-invited reviewers, a RateLoop-network panel, or separate hybrid subpanels. The
          exact audience policy is content-hashed.
        </li>
        <li>Submitted material is minimized, redacted, encrypted, and shown only through short assignment leases.</li>
        <li>Any paid quote itemizes bounty, fee, and maximum accepted-work reserve before funding.</li>
        <li>
          Before a paid assignment or voucher, reviewers complete the policy&apos;s capability and legal/payout gates.
          RateLoop-network reviewers must enroll with World ID 4 Proof of Human.
        </li>
        <li>
          Reviewers compare blinded A/B artifacts, choose an option, predict the panel&apos;s answer share, add bounded
          failure tags, and explain the difference without seeing other answers.
        </li>
        <li>
          Paid case rounds use sealed commits and permissionless deterministic settlement. Accepted work receives fixed
          USDC plus a bounded binary Robust Bayesian Truth Serum bonus.
        </li>
        <li>
          Before the round is funded, RateLoop reserves a separate platform-funded surprise-bounty maximum. After
          finalization, a versioned Surprisingly Popular calculation compares actual answer share with the panel&apos;s
          predicted share and uses leave-one-out scoring so a reviewer cannot score against their own report.
        </li>
        <li>
          Zero-commit rounds refund fully; failed quorum or beacon paths refund bounty and fee while accepted valid work
          remains compensable from the disclosed reserve.
        </li>
        <li>
          A qualifying Surprisingly Popular answer earns a non-negative central USDC top-up, capped per reviewer and
          paid to the same reviewer-selected address after the base claim. It never changes the majority verdict,
          contract settlement, fixed pay, or RBTS pay. Correlation analytics can qualify or limit result publication,
          but cannot reduce accepted-work payment.
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
      <h2>Independent controls, explicit limits</h2>
      <p>
        World ID limits duplicate provider subjects, RBTS changes reporting incentives, and prospective integrity epochs
        diversify assignments. Surprisingly Popular bounties reward collectively underestimated answers rather than
        declaring them correct. None of these controls proves expertise, honest judgment, behavioral independence, or
        objective truth on its own.
      </p>
      <h2>Privacy, identity, and recovery</h2>
      <p>
        RateLoop can process encrypted private artifacts and participating reviewers see only their assigned material,
        but customers must still minimize sensitive data and keep regulated or safety-critical decisions under
        accountable human control. Invitations are the default private B2B access path. External identity assurance is
        used only when a frozen audience policy requires a specific capability.
      </p>
      <p>
        One-time vote and payout keys are created in the browser and exported in an encrypted recovery package. The
        operator never receives those keys. Claiming publicly links the vote key to its per-round payout address.
      </p>
    </article>
  );
}
