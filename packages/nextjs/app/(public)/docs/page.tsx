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
        Settlement evidence may be public. Do not submit secrets or material you are not authorized to disclose.
        Credentials support panel-specific eligibility; no single identity provider is required for every use case.
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
      <h2>Operating model</h2>
      <p>
        Workspaces define who may publish, which reviewer sources are permitted, how much an agent may spend, and which
        evidence must be present before a result is released. Reviewer source, compensation, limitations, and settlement
        terms remain visible throughout the workflow.
      </p>
    </article>
  );
}
