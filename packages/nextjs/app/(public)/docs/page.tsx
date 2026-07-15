export default function DocsPage() {
  return (
    <article className="prose max-w-none">
      <h1>Human assurance for AI-enabled workflows</h1>
      <p className="lead">
        RateLoop helps teams test whether AI-enabled work meets a declared quality bar before rollout. A funded, blinded
        human panel returns a signal, written reasons, and inspectable settlement evidence.
      </p>
      <p>
        The public tokenless deployment is an explicit simulated sandbox. Its reviewers, results, settlement, and
        payments are test data, not live human evidence or payment receipts.
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
        Browser access starts with Better Auth and resolves to an opaque RateLoop principal; an account does not require
        or automatically create a wallet. A signed-in user adds a self-custodial or optional thirdweb app wallet only
        when an explicit funding, payout, or recovery flow needs one. Wallet bindings are purpose-scoped and never grant
        workspace access by themselves.
      </p>
      <p>
        Question and rater text stays off-chain, but RateLoop and assigned reviewers may be able to read it. Private
        artifacts are encrypted before storage and limited by explicit project assignment and short reviewer leases.
        Settlement evidence may be public. Do not submit secrets or material you are not authorized to disclose.
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
      <h2>EU-first controls and current limits</h2>
      <p>
        Repository controls bind private data to an EU home region, classification, permitted use, retention, and
        legal-hold policy. Structured subject-request workflows and integrity-chained exportable application audit
        records are implemented. The audit chain is not an immutable or WORM log.
      </p>
      <p>
        These controls do not prove that the current sandbox is EU-hosted, contractually no-training, certified, or
        independently penetration tested. Live EU resources, regional KMS, processors, backups, and external approvals
        remain separate release gates. See <a href="/trust">Trust</a> for the versioned status and unavailable
        capabilities.
      </p>
    </article>
  );
}
