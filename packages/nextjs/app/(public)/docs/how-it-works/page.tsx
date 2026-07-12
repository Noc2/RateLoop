export default function HowTokenlessWorksPage() {
  return (
    <article className="prose max-w-none">
      <h1>How it works</h1>
      <ol>
        <li>The funder chooses a binary/A-B question, audience tier, and budget.</li>
        <li>The quote itemizes bounty, fee, and maximum accepted-work reserve.</li>
        <li>Eligible raters submit a sealed answer, one prediction bucket, and any required rationale.</li>
        <li>Anyone may continue freeze, weighting, and finalization.</li>
        <li>
          Healthy rounds pay base plus bounded accuracy bonus. Zero-commit rounds refund fully; partial failures refund
          bounty and fee while the reserve compensates accepted work.
        </li>
      </ol>
      <h2>No post-commit cancellation</h2>
      <p>After the first accepted paid commit, the round follows its deterministic settlement or compensation path.</p>
    </article>
  );
}
