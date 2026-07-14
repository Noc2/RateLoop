import Link from "next/link";

const integrations = [
  {
    title: "Remote MCP",
    body: "Create a reviewed browser handoff from any MCP client. Authenticated workspace tools use a scoped RateLoop credential.",
    code: "https://rateloop-tokenless.vercel.app/api/mcp",
    color: "#359EEE",
  },
  {
    title: "TypeScript SDK",
    body: "Use the versioned quote → ask → payment → wait → result workflow from an agent service.",
    code: "yarn add @rateloop/sdk",
    color: "#03CEA4",
  },
  {
    title: "Agent CLI",
    body: "Review a file-backed handoff or run a policy-bound integration without putting wallet secrets in a prompt.",
    code: "yarn workspace @rateloop/agents handoff --file ask.json",
    color: "#EF476F",
  },
] as const;

export function AgentIntegrationPanel() {
  return (
    <section className="surface-card rounded-2xl p-6">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Integration</p>
      <h2 className="mt-2 text-2xl font-semibold">Connect an agent to human assurance</h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-base-content/60">
        Start with a reviewed handoff. Create a workspace credential and spending policy before allowing autonomous
        public requests. Private-group requests may be unpaid; public-network requests always reserve USDC.
      </p>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {integrations.map(integration => (
          <article
            key={integration.title}
            className="surface-card-nested rounded-xl border-l-2 p-4"
            style={{ borderColor: integration.color }}
          >
            <h3 className="font-semibold">{integration.title}</h3>
            <p className="mt-2 text-sm leading-6 text-base-content/55">{integration.body}</p>
            <code className="mt-4 block overflow-x-auto rounded-lg bg-black/35 p-3 text-xs text-base-content/75">
              {integration.code}
            </code>
          </article>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/handoff" className="rateloop-gradient-action px-5">
          Open reviewed handoff
        </Link>
        <Link href="/docs/ai" className="btn border-0 bg-white/[0.08] px-5">
          Integration docs
        </Link>
      </div>
    </section>
  );
}
