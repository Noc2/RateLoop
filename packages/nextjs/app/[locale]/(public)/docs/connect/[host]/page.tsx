import { notFound } from "next/navigation";
import { CONNECTION_MESSAGE_URL_PLACEHOLDER, HOST_TIER_BADGES, HostGuideCodeBlock, HostTierBadge } from "../hostGuide";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import {
  LocalizedPublicContent,
  resolvePublicLocale,
  translatePublicString,
} from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";
import { buildAgentConnectionMessageForHost } from "~~/components/tokenless/agents/agentConnectionMessage";
import {
  TOKENLESS_HOST_CAPABILITIES,
  type TokenlessHostCapability,
  type TokenlessInstallAffordance,
  tokenlessHostCapability,
} from "~~/lib/tokenless/hostCapabilities";
import { localizeTokenlessHostCapabilityCopy } from "~~/lib/tokenless/hostCapabilityLocalization";

export const dynamicParams = false;

export function generateStaticParams() {
  return TOKENLESS_HOST_CAPABILITIES.map(host => ({ host: host.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale?: string; host: string }> }) {
  const [{ host: hostId }, locale] = await Promise.all([params, resolvePublicLocale(params)]);
  const host = tokenlessHostCapability(hostId);
  if (!host) return { title: translatePublicString("Connect a Host", locale, "docs") };
  return {
    title: `${translatePublicString("Connect", locale, "docs")} ${host.displayName}`,
    description: `${translatePublicString(
      "What to expect, the exact connection message, and RateLoop's support status for",
      locale,
      "docs",
    )} ${host.displayName}.`,
  };
}

function InstallAffordance({ affordance, locale }: { affordance: TokenlessInstallAffordance; locale: "en" | "de" }) {
  const label = localizeTokenlessHostCapabilityCopy(affordance.label, locale);
  const value =
    affordance.kind === "settings-instructions"
      ? localizeTokenlessHostCapabilityCopy(affordance.value, locale)
      : affordance.value;
  return (
    <LocalizedPublicContent locale={locale} section="docs">
      <section>
        <p>{label}</p>
        {affordance.kind === "cli-command" || affordance.kind === "config-snippet" ? (
          <HostGuideCodeBlock>{affordance.value}</HostGuideCodeBlock>
        ) : affordance.kind === "deep-link" ? (
          <p>
            <a href={affordance.value}>
              <code>{affordance.value}</code>
            </a>
          </p>
        ) : affordance.kind === "settings-instructions" ? (
          <p>{value}</p>
        ) : (
          <p>
            <code>{affordance.value}</code>
          </p>
        )}
        <p className="text-sm text-base-content/55">
          Checked {affordance.checkedAt} against {affordance.clientVersion}.
        </p>
      </section>
    </LocalizedPublicContent>
  );
}

function HostGuide({ host, locale }: { host: TokenlessHostCapability; locale: "en" | "de" }) {
  const message = buildAgentConnectionMessageForHost({
    hostId: host.id,
    connectionUrl: CONNECTION_MESSAGE_URL_PLACEHOLDER,
  });

  return (
    <LocalizedPublicContent locale={locale} section="docs">
      <article className="prose max-w-none">
        <Link
          href="/docs/connect"
          className="not-prose mb-4 inline-block text-sm text-base-content/65 underline underline-offset-4 hover:text-base-content"
        >
          &larr; Back to Connect a Host
        </Link>
        <DocsTitle gradientText={host.displayName}>Connect</DocsTitle>
        <p className="not-prose flex flex-wrap items-center gap-3">
          <HostTierBadge locale={locale} tier={host.supportTier} />
          <span className="text-sm leading-6 text-base-content/60">
            {HOST_TIER_BADGES[host.supportTier].meaning}
            {host.supportTier === "release-tested"
              ? ` Tier granted ${host.releaseTestedAt} (${host.releaseTestEvidence}).`
              : null}
          </span>
        </p>
        {host.notes ? <p>{host.notes}</p> : null}

        <h2>What to expect</h2>
        <p>The connection asks for your action only at steps this host presents itself:</p>
        <ol>
          {host.humanActions.map(action => (
            <li key={action}>{localizeTokenlessHostCapabilityCopy(action, locale)}</li>
          ))}
        </ol>

        <h2>The connection message</h2>
        <p>
          Copy the real message from <Link href="/agents/connections">Connections</Link>. It ends with a single-use link
          in the <code>{CONNECTION_MESSAGE_URL_PLACEHOLDER}</code> shape shown below; only that link differs from the
          exact wording this host receives:
        </p>
        <HostGuideCodeBlock>{message}</HostGuideCodeBlock>

        <h2>Host-native setup</h2>
        {host.installAffordances.length > 0 ? (
          host.installAffordances.map(affordance => (
            <InstallAffordance key={`${affordance.kind}:${affordance.value}`} affordance={affordance} locale={locale} />
          ))
        ) : (
          <p>
            No checked install command, link, or configuration snippet is published for this host yet; RateLoop does not
            guess client syntax.
          </p>
        )}

        <h2>If the tools are missing after authorization</h2>
        <p>
          The message above already carries this host&apos;s recovery steps, so let the agent follow them. The full
          setup and support reference, including stale-plugin recovery after a workspace deletion, is{" "}
          <a href="/docs/agent-connection.md">agent-connection.md</a>. All hosts are listed under{" "}
          <Link href="/docs/connect">Connect a Host</Link>.
        </p>
      </article>
    </LocalizedPublicContent>
  );
}

export default async function ConnectHostPage({ params }: { params: Promise<{ locale?: string; host: string }> }) {
  const [{ host: hostId }, locale] = await Promise.all([params, resolvePublicLocale(params)]);
  const host = tokenlessHostCapability(hostId);
  if (!host) notFound();
  return <HostGuide host={host} locale={locale} />;
}
