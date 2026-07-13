export default function DocsPage() {
  return (
    <article className="prose max-w-none">
      <h1>Trust and limitations</h1>
      <p className="lead">The implementation is complete; Base Sepolia addresses remain disposable until Phase 5.</p>
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
      <h2>Deployment status</h2>
      <p>
        Sandbox results are deterministic simulations and are labeled as such. Production mode includes authenticated
        workspaces, eligibility, exact chain payment, sponsored commits, indexed settlement evidence, analytics, and
        signed webhooks. A fresh contract deployment and complete environment update are required before live E2E use.
      </p>
    </article>
  );
}
