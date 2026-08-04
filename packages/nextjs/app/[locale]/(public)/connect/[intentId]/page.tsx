import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PublicAgentConnectionStatus } from "~~/components/tokenless/agents/PublicAgentConnectionStatus";
import { Card } from "~~/components/tokenless/ui/Card";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";
import type { Locale } from "~~/i18n/config";
import { getOptionalAppUrl } from "~~/lib/env/server";
import { getPublicAgentConnectionIntent } from "~~/lib/tokenless/agentConnectionIntents";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents.connectIntent" });
  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
    referrer: "no-referrer",
    robots: { follow: false, index: false },
  };
}

const STATUS_KEYS = new Set([
  "issued",
  "install_required",
  "authorizing",
  "approval_required",
  "testing",
  "connected",
  "action_required",
  "cancelled",
  "expired",
  "rejected",
  "revoked",
  "superseded",
]);
const DEADLINE_STATUSES = new Set([
  "issued",
  "install_required",
  "authorizing",
  "approval_required",
  "testing",
  "action_required",
]);

export default async function AgentConnectionPage({
  params,
}: {
  params: Promise<{ intentId: string; locale: Locale }>;
}) {
  const { intentId, locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents.connectIntent" });
  const intent = await getPublicAgentConnectionIntent(intentId).catch(() => null);
  if (!intent) notFound();

  const statusKey = STATUS_KEYS.has(intent.status) ? intent.status : "unknown";
  const status = {
    label: t(`status.${statusKey}.label`),
    action: t(`status.${statusKey}.action`),
    showDeadline: DEADLINE_STATUSES.has(intent.status) || statusKey === "unknown",
  };
  const recoveryAction = intent.status === "action_required" ? intent.recoveryAction : null;
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
    <div className="mx-auto w-full max-w-4xl px-5 py-12 sm:py-16">
      <script
        type="application/json"
        data-rateloop-agent-connection="2026-07-17"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(machineHandoff).replaceAll("<", "\\u003c") }}
      />
      <Card as="section" className="rounded-2xl p-6 sm:p-8" aria-labelledby="agent-connection-heading">
        <PageHeading
          accent="blue"
          heading={status.label}
          headingId="agent-connection-heading"
          subtitle={<span className="block max-w-2xl leading-7">{status.action}</span>}
        />

        {recoveryAction ? (
          <section
            className="mt-5 rounded-xl border border-warning/25 bg-warning/[0.07] p-4"
            aria-labelledby="connection-recovery-heading"
            role="alert"
          >
            <h2 id="connection-recovery-heading" className="text-sm font-semibold text-warning">
              {t("recoveryTitle")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-warning/80">{recoveryAction}</p>
          </section>
        ) : null}

        {!recoveryAction ? <PublicAgentConnectionStatus /> : null}

        {status.showDeadline && intent.hardExpiresAt ? (
          <p className="mt-6 border-t border-base-content/10 pt-5 text-sm text-base-content/55">
            {t("completeBy")}{" "}
            <time dateTime={intent.hardExpiresAt}>
              {new Intl.DateTimeFormat(locale, {
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                month: "short",
                timeZone: "UTC",
                timeZoneName: "short",
                year: "numeric",
              }).format(new Date(intent.hardExpiresAt))}
            </time>
          </p>
        ) : null}
      </Card>
    </div>
  );
}
