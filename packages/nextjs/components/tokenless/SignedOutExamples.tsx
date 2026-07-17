export function HumanReviewExample() {
  return (
    <section className="surface-card-nested rounded-xl p-4 text-left" aria-labelledby="example-review-title">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">Example review</p>
        <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs text-base-content/70">
          Example pay · $3–$7 USDC
        </span>
      </div>
      <h3 id="example-review-title" className="mt-3 font-semibold">
        Would you send this reply?
      </h3>
      <div className="mt-3 grid grid-cols-2 gap-2 text-center text-sm">
        <span className="rounded-lg border border-white/10 px-3 py-2">Approve</span>
        <span className="rounded-lg border border-white/10 px-3 py-2">Needs work</span>
      </div>
    </section>
  );
}

export function AgentWorkspaceExample() {
  return (
    <section className="surface-card-nested rounded-xl p-4 text-left" aria-labelledby="example-workspace-title">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Example workspace</p>
      <h3 id="example-workspace-title" className="mt-2 font-semibold">
        Support agent
      </h3>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-base-content/70">
        <div>
          <dt>Agents</dt>
          <dd className="mt-1 font-mono text-base-content">1 connected</dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd className="mt-1 font-mono text-base-content">100% at first</dd>
        </div>
        <div>
          <dt>Inbox</dt>
          <dd className="mt-1 font-mono text-base-content">0 pending</dd>
        </div>
      </dl>
    </section>
  );
}
