export default function HowTokenlessWorksPage() {
  return (
    <article className="prose max-w-none">
      <h1>How it works</h1>
      <ol>
        <li>The funder chooses a binary/A-B question, audience tier, and budget.</li>
        <li>The quote itemizes bounty, fee, and maximum accepted-work reserve.</li>
        <li>
          Before a first paid voucher, raters complete identity, residence/tax, sanctions, and payout eligibility.
        </li>
        <li>Eligible raters submit a sealed answer, one prediction bucket, and any required rationale.</li>
        <li>Anyone may continue freeze, weighting, and finalization.</li>
        <li>
          Healthy rounds pay base plus bounded accuracy bonus. Zero-commit rounds refund fully; partial failures refund
          bounty and fee while the reserve compensates accepted work.
        </li>
      </ol>
      <h2>No post-commit cancellation</h2>
      <p>After the first accepted paid commit, the round follows its deterministic settlement or compensation path.</p>
      <h2>Recovery and claim privacy</h2>
      <p>
        One-time vote and payout keys are created in the browser and exported in an encrypted recovery package. The
        operator never receives those keys. Claiming publicly links the vote key to its per-round payout address.
      </p>
    </article>
  );
}
