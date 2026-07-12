export default function TokenlessDocsPage() {
  return (
    <article className="prose max-w-none">
      <h1>Tokenless trust and limitations</h1>
      <p className="lead">This is a disposable test deployment, not the final Phase 5 protocol.</p>
      <h2>Fund custody</h2>
      <p>
        The target panel core has no operator or admin path to escrowed funds. The separate credential issuer can rotate
        admission signers and censor future admission, but cannot redirect claims or alter accepted commits.
      </p>
      <h2>External trust</h2>
      <ul>
        <li>USDC inherits Circle freeze, blacklist, depeg, and contract risks.</li>
        <li>Sealed reveal timing trusts drand availability.</li>
        <li>Admission and identity caps are operator-attested.</li>
        <li>A normal claim links a one-time vote key to its payout address.</li>
      </ul>
      <h2>Test status</h2>
      <p>
        Sandbox results are deterministic simulations and are labeled as such. Live mode stores quote and ask state in
        Postgres but does not claim payment or settlement completion before the chain/service integration exists.
      </p>
    </article>
  );
}
