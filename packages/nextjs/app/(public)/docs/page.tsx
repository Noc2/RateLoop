export default function DocsPage() {
  return (
    <article className="prose max-w-none">
      <h1>Human assurance for AI-enabled workflows</h1>
      <p className="lead">
        RateLoop helps teams test whether AI-enabled work meets a declared quality bar before rollout. A funded, blinded
        human panel returns a signal, written reasons, and inspectable settlement evidence.
      </p>
      <h2>Good first use cases</h2>
      <ul>
        <li>Review AI-drafted customer-support replies before they reach customers.</li>
        <li>Run acceptance checks for AI consulting and implementation work.</li>
        <li>Compare marketing, product, and internal-copilot variants against one stated criterion.</li>
        <li>Retest a workflow after a model, prompt, policy, or retrieval change.</li>
      </ul>
      <h2>Decision ownership</h2>
      <p>
        A RateLoop result is decision support. It is not an automatic release, safety, legal, or compliance approval.
        The customer defines the criterion, considers other evidence, and keeps an accountable person responsible for
        the final action.
      </p>
      <h2>Privacy and identity</h2>
      <p>
        Question and rater text stays off-chain, but RateLoop and participating raters may be able to read it.
        Settlement evidence may be public. Do not submit secrets or regulated personal data in early access. Optional
        credentials can support panel-specific eligibility; no single identity provider is required for every use case.
      </p>
      <h2>Fund custody and settlement</h2>
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
        RateLoop is in early access. Sandbox results are deterministic simulations and are labeled as such. Base Sepolia
        addresses remain disposable until hardening, and a fresh contract deployment plus complete environment update
        are required before live end-to-end use.
      </p>
    </article>
  );
}
