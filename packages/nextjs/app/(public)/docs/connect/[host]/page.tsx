import Link from "next/link";
import { notFound } from "next/navigation";
import { CONNECTION_MESSAGE_URL_PLACEHOLDER, HOST_TIER_BADGES, HostGuideCodeBlock, HostTierBadge } from "../hostGuide";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { buildAgentConnectionMessageForHost } from "~~/components/tokenless/agents/agentConnectionMessage";
import {
  TOKENLESS_HOST_CAPABILITIES,
  type TokenlessHostCapability,
  type TokenlessInstallAffordance,
  tokenlessHostCapability,
} from "~~/lib/tokenless/hostCapabilities";

export const dynamicParams = false;

export function generateStaticParams() {
  return TOKENLESS_HOST_CAPABILITIES.map(host => ({ host: host.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const host = tokenlessHostCapability((await params).host);
  if (!host) return { title: "Connect a Host" };
  return {
    title: `Connect ${host.displayName}`,
    description: `What to expect, the exact connection message, and RateLoop's support status for ${host.displayName}.`,
  };
}

function InstallAffordance({ affordance }: { affordance: TokenlessInstallAffordance }) {
  return (
    <section>
      <p>{affordance.label}</p>
      {affordance.kind === "cli-command" || affordance.kind === "config-snippet" ? (
        <HostGuideCodeBlock>{affordance.value}</HostGuideCodeBlock>
      ) : affordance.kind === "deep-link" ? (
        <p>
          <a href={affordance.value}>
            <code>{affordance.value}</code>
          </a>
        </p>
      ) : affordance.kind === "settings-instructions" ? (
        <p>{affordance.value}</p>
      ) : (
        <p>
          <code>{affordance.value}</code>
        </p>
      )}
      <p className="text-sm text-base-content/55">
        Checked {affordance.checkedAt} against {affordance.clientVersion}.
      </p>
    </section>
  );
}

function HostGuide({ host }: { host: TokenlessHostCapability }) {
  const message = buildAgentConnectionMessageForHost({
    hostId: host.id,
    connectionUrl: CONNECTION_MESSAGE_URL_PLACEHOLDER,
  });

  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText={host.displayName}>Connect</DocsTitle>
      <p className="not-prose flex flex-wrap items-center gap-3">
        <HostTierBadge tier={host.supportTier} />
        <span className="text-sm leading-6 text-base-content/60">
          {HOST_TIER_BADGES[host.supportTier].meaning}
          {host.supportTier === "verified" ? ` Tier granted ${host.verifiedAt} (${host.verificationEvidence}).` : null}
        </span>
      </p>
      {host.notes ? <p>{host.notes}</p> : null}

      <h2>What to expect</h2>
      <p>The connection asks for your action only at steps this host presents itself:</p>
      <ol>
        {host.humanActions.map(action => (
          <li key={action}>{action}</li>
        ))}
      </ol>

      <h2>The connection message</h2>
      <p>
        Copy the real message from your workspace&apos;s <Link href="/agents">Agents tab</Link>. It ends with a
        single-use link in the <code>{CONNECTION_MESSAGE_URL_PLACEHOLDER}</code> shape shown below; only that link
        differs from the exact wording this host receives:
      </p>
      <HostGuideCodeBlock>{message}</HostGuideCodeBlock>

      <h2>Host-native setup</h2>
      {host.installAffordances.length > 0 ? (
        host.installAffordances.map(affordance => (
          <InstallAffordance key={`${affordance.kind}:${affordance.value}`} affordance={affordance} />
        ))
      ) : (
        <p>
          No checked install command, link, or configuration snippet is published for this host yet; RateLoop does not
          guess client syntax.
        </p>
      )}

      <h2>If the tools are missing after authorization</h2>
      <p>
        The message above already carries this host&apos;s recovery steps, so let the agent follow them. The full setup
        and support reference, including stale-plugin recovery after a workspace deletion, is{" "}
        <a href="/docs/agent-connection.md">agent-connection.md</a>. All hosts are listed under{" "}
        <Link href="/docs/connect">Connect a Host</Link>.
      </p>
    </article>
  );
}

export default async function ConnectHostPage({ params }: { params: Promise<{ host: string }> }) {
  const host = tokenlessHostCapability((await params).host);
  if (!host) notFound();
  return <HostGuide host={host} />;
}
