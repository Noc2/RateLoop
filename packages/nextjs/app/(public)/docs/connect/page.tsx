import Link from "next/link";
import { HOST_CATEGORY_LABELS, HostTierBadge } from "./hostGuide";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import {
  TOKENLESS_HOST_CAPABILITIES,
  type TokenlessHostCapability,
  type TokenlessHostCategory,
} from "~~/lib/tokenless/hostCapabilities";

export const metadata = {
  title: "Connect a Host",
  description: "Per-host RateLoop connection guides generated from the host capability registry.",
};

/**
 * The bundled plugin hosts are the primary path (per the cross-client
 * compatibility review); every other registry host is listed below them.
 * Ordering within each group is the registry's own order.
 */
const PRIMARY_CATEGORY: TokenlessHostCategory = "plugin-host";
const PRIMARY_HOSTS = TOKENLESS_HOST_CAPABILITIES.filter(host => host.category === PRIMARY_CATEGORY);
const OTHER_HOSTS = TOKENLESS_HOST_CAPABILITIES.filter(host => host.category !== PRIMARY_CATEGORY);
const OTHER_CATEGORIES = [...new Set(OTHER_HOSTS.map(host => host.category))];

function HostList({ hosts }: { hosts: readonly TokenlessHostCapability[] }) {
  return (
    <ul className="not-prose m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
      {hosts.map(host => (
        <li key={host.id}>
          <Link
            href={`/docs/connect/${host.id}`}
            prefetch={false}
            className="rateloop-surface-card flex items-center justify-between gap-3 rounded-xl p-4 no-underline"
          >
            <span className="text-sm font-semibold text-base-content">{host.displayName}</span>
            <HostTierBadge tier={host.supportTier} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ConnectHostIndexPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Host">Connect a</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        Copy the connection message from your workspace&apos;s <Link href="/agents">Agents tab</Link>, then open your
        host&apos;s guide to see what to expect. Every guide is generated from the same host-capability registry that
        builds the message, so these pages can only say what the product does.
      </p>

      <h2>Primary path</h2>
      <HostList hosts={PRIMARY_HOSTS} />

      <h2>Other hosts</h2>
      {OTHER_CATEGORIES.map(category => (
        <section key={category}>
          <h3>{HOST_CATEGORY_LABELS[category]}</h3>
          <HostList hosts={OTHER_HOSTS.filter(host => host.category === category)} />
        </section>
      ))}

      <p>
        The wider agent workflow — publishing lanes, the tool surface, and the approval boundary — is in{" "}
        <Link href="/docs/ai">Agents &amp; MCP</Link>; the machine-readable setup and support reference is{" "}
        <a href="/docs/agent-connection.md">agent-connection.md</a>.
      </p>
    </article>
  );
}
