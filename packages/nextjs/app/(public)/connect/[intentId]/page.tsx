import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PublicAgentConnectionStatus } from "~~/components/tokenless/agents/PublicAgentConnectionStatus";
import { getOptionalAppUrl } from "~~/lib/env/server";
import { getPublicAgentConnectionIntent } from "~~/lib/tokenless/agentConnectionIntents";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Agent connection",
  description: "Resume a secure RateLoop workspace connection.",
  referrer: "no-referrer",
  robots: { follow: false, index: false },
};

const STATUS_COPY: Record<string, { label: string; action: string; showDeadline?: boolean }> = {
  issued: {
    label: "Ready for the agent",
    action: "Return to the agent so it can start the connection.",
    showDeadline: true,
  },
  install_required: {
    label: "Finish setup in the agent host",
    action: "Complete the install or trust prompt, then return to the same agent task.",
    showDeadline: true,
  },
  authorizing: {
    label: "Authorization needed",
    action: "Complete the RateLoop authorization prompt opened by your agent host.",
    showDeadline: true,
  },
  approval_required: {
    label: "Approval required",
    action: "Review the access request before allowing this connection.",
    showDeadline: true,
  },
  testing: {
    label: "Verifying connection",
    action: "No action needed. RateLoop is checking the connection.",
    showDeadline: true,
  },
  connected: {
    label: "Agent connected",
    action: "No action needed. It can check review requirements and decisions only.",
  },
  action_required: {
    label: "Action required",
    action: "Return to the agent and follow its recovery step using the original connection.",
    showDeadline: true,
  },
  cancelled: { label: "Connection cancelled", action: "Create a new connection message in RateLoop to try again." },
  expired: { label: "Connection expired", action: "Create a new connection message in RateLoop to try again." },
  rejected: { label: "Connection rejected", action: "Create a new connection message only if you want to try again." },
  revoked: { label: "Access revoked", action: "Create a new connection message to reconnect this agent." },
  superseded: { label: "Connection replaced", action: "Use the newer connection message for this workspace." },
};

export default async function AgentConnectionPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params;
  const intent = await getPublicAgentConnectionIntent(intentId).catch(() => null);
  if (!intent) notFound();

  const status = STATUS_COPY[intent.status] ?? {
    label: "Connection in progress",
    action: "Return to the agent and continue with the original connection.",
    showDeadline: true,
  };
  const appOrigin = getOptionalAppUrl()?.replace(/\/$/, "") ?? "";
  const machineHandoff = {
    schemaVersion: "2026-07-17",
    kind: "rateloop.agent-connection-handoff",
    intent,
    representation: `${appOrigin}/api/agent/v1/connection-intents/${intentId}`,
    mcpResource: `${appOrigin}/api/agent/v1/mcp`,
    connectionTool: "rateloop_connect_workspace",
    claimTool: "rateloop_claim_connection_intent",
  };

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-12 sm:py-16">
      <script
        type="application/json"
        data-rateloop-agent-connection="2026-07-17"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(machineHandoff).replaceAll("<", "\\u003c") }}
      />
      <section className="surface-card rounded-2xl p-6 sm:p-8" aria-labelledby="agent-connection-heading">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Agent connection</p>
        <h1 id="agent-connection-heading" className="mt-3 text-3xl font-semibold">
          {status.label}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-base-content/70">{status.action}</p>

        <PublicAgentConnectionStatus />

        {status.showDeadline && intent.hardExpiresAt ? (
          <p className="mt-6 border-t border-white/10 pt-5 text-sm text-base-content/55">
            Complete by <time dateTime={intent.hardExpiresAt}>{new Date(intent.hardExpiresAt).toLocaleString()}</time>
          </p>
        ) : null}
      </section>
    </main>
  );
}
