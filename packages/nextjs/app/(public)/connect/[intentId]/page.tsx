import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PublicAgentConnectionStatus } from "~~/components/tokenless/agents/PublicAgentConnectionStatus";
import { getOptionalAppUrl } from "~~/lib/env/server";
import { getPublicAgentConnectionIntent } from "~~/lib/tokenless/agentConnectionIntents";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Agent connection | RateLoop",
  description: "Resume a secure RateLoop workspace connection.",
  referrer: "no-referrer",
  robots: { follow: false, index: false },
};

const STATUS_COPY: Record<string, { label: string; detail: string }> = {
  issued: {
    label: "Ready for the agent",
    detail: "The agent has not claimed this connection yet.",
  },
  install_required: {
    label: "Install or trust required",
    detail: "Complete the host-native action once; the original connection will resume automatically.",
  },
  authorizing: {
    label: "Authorizing",
    detail: "Complete the RateLoop authorization prompt if your host opened one.",
  },
  approval_required: {
    label: "Approval required",
    detail: "The requested access exceeds the safe default and needs explicit approval.",
  },
  testing: {
    label: "Verifying connection",
    detail: "RateLoop is checking context and safe access. No action is needed.",
  },
  connected: {
    label: "Connected with safe access",
    detail: "The agent can check review requirements but cannot spend, publish, read private files, or administer.",
  },
  action_required: {
    label: "Action required",
    detail: "Return to the agent for the exact recovery action. Keep using the original message.",
  },
  cancelled: { label: "Cancelled", detail: "Create and copy a new connection message from RateLoop to try again." },
  expired: { label: "Expired", detail: "Create and copy a new connection message from RateLoop to try again." },
  rejected: { label: "Rejected", detail: "This connection cannot be resumed." },
  revoked: { label: "Revoked", detail: "This agent no longer has workspace access." },
  superseded: { label: "Replaced", detail: "Use the newer connection message created for this workspace." },
};

export default async function AgentConnectionPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params;
  const intent = await getPublicAgentConnectionIntent(intentId).catch(() => null);
  if (!intent) notFound();

  const status = STATUS_COPY[intent.status] ?? {
    label: "Connection in progress",
    detail: "Return to the agent and keep using the original connection message.",
  };
  const appOrigin = getOptionalAppUrl()?.replace(/\/$/, "") ?? "";
  const machineHandoff = {
    schemaVersion: "2026-07-15",
    kind: "rateloop.agent-connection-handoff",
    intent,
    representation: `${appOrigin}/api/agent/v1/connection-intents/${intentId}`,
    mcpResource: `${appOrigin}/api/agent/v1/mcp`,
    claimTool: "rateloop_claim_connection_intent",
  };

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-12 sm:py-16">
      <script
        type="application/json"
        data-rateloop-agent-connection="2026-07-15"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(machineHandoff).replaceAll("<", "\\u003c") }}
      />
      <section className="surface-card rounded-2xl p-6 sm:p-8" aria-labelledby="agent-connection-heading">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Agent connection</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 id="agent-connection-heading" className="text-3xl font-semibold">
              {status.label}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-base-content/60">{status.detail}</p>
          </div>
          <span className="badge badge-ghost shrink-0 font-mono text-xs">{intent.status}</span>
        </div>

        <PublicAgentConnectionStatus />

        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <article className="surface-card-nested rounded-xl p-5">
            <h2 className="font-semibold">For the workspace owner</h2>
            <p className="mt-2 text-sm leading-6 text-base-content/55">
              Return to the agent after any host-native install, trust, or RateLoop authorization prompt. You never need
              to paste the connection message a second time.
            </p>
          </article>
          <article className="surface-card-nested rounded-xl p-5">
            <h2 className="font-semibold">For agents and hosts</h2>
            <p className="mt-2 text-sm leading-6 text-base-content/55">
              Preserve the complete original URL locally, connect to the canonical workspace MCP resource, then claim,
              load context, and verify. Never print or send the URL fragment as telemetry.
            </p>
          </article>
        </div>

        <dl className="mt-7 grid gap-4 border-t border-white/10 pt-6 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-base-content/45">Safe access</dt>
            <dd className="mt-1">Check review requirements and decisions only</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Connection deadline</dt>
            <dd className="mt-1">
              <time dateTime={intent.hardExpiresAt ?? undefined}>
                {intent.hardExpiresAt ? new Date(intent.hardExpiresAt).toLocaleString() : "Unavailable"}
              </time>
            </dd>
          </div>
        </dl>
        <a
          className="mt-6 inline-flex text-sm text-[var(--rateloop-blue)] underline underline-offset-4"
          href="/docs/agent-connection.md"
        >
          Open the generic connection guide
        </a>
      </section>
    </main>
  );
}
