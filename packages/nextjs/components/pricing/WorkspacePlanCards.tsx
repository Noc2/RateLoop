import type { ReactNode } from "react";
import { LocalizedPublicContent, translatePublicString } from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import type { Locale } from "~~/i18n/config";
import {
  TOKENLESS_BILLING_PLANS,
  TOKENLESS_HOSTED_REVIEW_COPY,
  activeAgentLimitLabel,
  privateGroupLimitLabel,
} from "~~/lib/billing/plans";
import { FOUNDING_PILOT, SANDBOX_PRICE_CENTS, formatEurPrice } from "~~/lib/marketing/foundingPilot";

type WorkspacePlanCardsProps = {
  workspaceId?: string;
  /** Resolved by `resolveDemoBookingUrl`; null falls back to the enterprise mailto. */
  demoBookingUrl?: string | null;
  locale?: Locale;
};

const freePlan = TOKENLESS_BILLING_PLANS.free;

function workspacePlanHref(workspaceId: string | undefined) {
  const query = new URLSearchParams();
  if (workspaceId) query.set("workspace", workspaceId);
  const search = query.toString();
  return `/agents/billing${search ? `?${search}` : ""}`;
}

export function WorkspacePlanCards({ workspaceId, demoBookingUrl = null, locale = "en" }: WorkspacePlanCardsProps) {
  const copy = (source: string) => translatePublicString(source, locale, "site");
  const pilotHref = demoBookingUrl ?? "mailto:hawigxyz@proton.me?subject=RateLoop%20Founding%20Pilot";
  const pilotCta = copy("Request pilot");

  return (
    <LocalizedPublicContent locale={locale} section="site">
      <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
        <PlanCard
          name={copy("Sandbox")}
          accent="var(--rateloop-blue)"
          priceRow={
            <div className="mt-8 flex items-end gap-3">
              <span className="display-section text-6xl leading-none">
                {formatEurPrice(SANDBOX_PRICE_CENTS, locale)}
              </span>
              <span className="pb-1 text-sm text-base-content/50">{copy("No card required")}</span>
            </div>
          }
          features={[
            copy(activeAgentLimitLabel(freePlan.activeAgents)),
            copy(privateGroupLimitLabel(freePlan.activePrivateGroups)),
            copy(TOKENLESS_HOSTED_REVIEW_COPY.planBenefit),
          ]}
          footer={
            <Button
              as={Link}
              variant="secondary"
              size="none"
              block
              className="min-h-12 justify-center px-5"
              href={workspacePlanHref(workspaceId)}
            >
              {copy("Start free")}
            </Button>
          }
        />
        <PlanCard
          name={copy("Founding Pilot")}
          accent="var(--rateloop-green)"
          badge={copy("Founding offer")}
          priceRow={
            <div className="mt-8 flex items-end gap-3">
              <span className="display-section text-6xl leading-none">
                {formatEurPrice(FOUNDING_PILOT.priceCents, locale)}
              </span>
              <span className="pb-1 text-sm text-base-content/50">{copy("one-time, net")}</span>
            </div>
          }
          features={[
            copy("6-week structured pilot"),
            copy("50% creditable against a later subscription"),
            copy("Invoiced in euro by bank transfer"),
            copy("Workspace limits agreed in the pilot order"),
          ]}
          footer={
            pilotHref.startsWith("mailto:") ? (
              <Button
                as="a"
                variant="primary"
                size="none"
                block
                className="min-h-12 justify-center px-5"
                href={pilotHref}
              >
                {pilotCta}
              </Button>
            ) : (
              // The scheduler is a third-party page, so it leaves the app in a new tab rather than
              // being embedded: an embed would need its origin in the CSP and would set third-party
              // storage on page view.
              <Button
                as="a"
                variant="primary"
                size="none"
                block
                className="min-h-12 justify-center px-5"
                href={pilotHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {pilotCta}
              </Button>
            )
          }
        />
      </div>
      <p className="mx-auto mt-5 max-w-4xl text-sm text-base-content/50">{copy("All prices net of 19% VAT.")}</p>
    </LocalizedPublicContent>
  );
}

function PlanCard({
  name,
  accent,
  badge,
  priceRow,
  features,
  footer,
}: {
  name: string;
  accent: string;
  badge?: string;
  priceRow: ReactNode;
  features: readonly string[];
  footer: ReactNode;
}) {
  return (
    <Card as="article" className="relative flex min-h-[28rem] flex-col overflow-hidden rounded-2xl p-7 sm:p-9">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-2xl font-semibold">{name}</h3>
        {badge ? (
          <span className="rounded-full border border-[var(--rateloop-green)]/40 bg-[var(--rateloop-green)]/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-[var(--rateloop-green)]">
            {badge}
          </span>
        ) : null}
      </div>
      {priceRow}
      <ul className="mt-9 space-y-4 text-base leading-7 text-base-content/70">
        {features.map(feature => (
          <li key={feature} className="flex gap-3">
            <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-8">{footer}</div>
    </Card>
  );
}
