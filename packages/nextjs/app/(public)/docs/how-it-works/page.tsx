export default function HowTokenlessWorksPage() {
  return (
    <article className="prose max-w-none">
      <h1>How it works</h1>
      <ol>
        <li>
          The customer names a real AI-workflow decision, defines one binary or A/B quality criterion, and chooses an
          audience tier and budget.
        </li>
        <li>The submitted material is minimized and redacted so participating raters receive only what they need.</li>
        <li>The quote itemizes bounty, fee, and maximum accepted-work reserve.</li>
        <li>
          Before a first paid voucher, raters complete identity, residence/tax, sanctions, and payout eligibility.
        </li>
        <li>
          Eligible humans submit a sealed answer, one prediction bucket, and any required rationale without seeing the
          crowd&apos;s direction.
        </li>
        <li>Anyone may continue the deterministic freeze, weighting, and finalization process.</li>
        <li>
          Healthy rounds pay base plus bounded accuracy bonus. Zero-commit rounds refund fully; partial failures refund
          bounty and fee while the reserve compensates accepted work.
        </li>
        <li>The customer uses the panel result and reasons as evidence while retaining the final rollout decision.</li>
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
        Off-chain content may be visible to RateLoop and participating raters, so early-access panels must not contain
        secrets or regulated personal data. Identity requirements are panel-specific and the credential provider may
        vary. Invite-only customer cohorts are not yet a complete enterprise workflow.
      </p>
      <p>
        One-time vote and payout keys are created in the browser and exported in an encrypted recovery package. The
        operator never receives those keys. Claiming publicly links the vote key to its per-round payout address.
      </p>
    </article>
  );
}
