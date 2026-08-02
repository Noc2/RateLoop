import type { Metadata } from "next";
import {
  LocalizedPublicContent,
  resolvePublicLocale,
  translatePublicString,
} from "~~/components/docs/LocalizedPublicContent";
import { WorkspacePlanCards } from "~~/components/pricing/WorkspacePlanCards";
import { Card } from "~~/components/tokenless/ui/Card";
import { resolveDemoBookingUrl } from "~~/lib/marketing/demoBooking";

export async function generateMetadata({ params }: { params: Promise<{ locale?: string }> }): Promise<Metadata> {
  const locale = await resolvePublicLocale(params);
  return {
    title: translatePublicString("Pricing", locale, "site"),
    description: translatePublicString(
      "Simple workspace pricing for auditable human assurance of AI work.",
      locale,
      "site",
    ),
  };
}

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PricingPage({
  params,
  searchParams,
}: {
  params?: Promise<{ locale?: string }>;
  searchParams: Promise<{ workspace?: string | string[] }>;
}) {
  const locale = await resolvePublicLocale(params);
  const workspaceId = first((await searchParams).workspace);
  const subscriptionsEnabled = process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED === "true";
  const demoBookingUrl = resolveDemoBookingUrl();
  return (
    <LocalizedPublicContent locale={locale} section="site">
      <div className="flex grow flex-col items-center px-4 pb-20 pt-12 sm:pt-16 lg:pt-20">
        <div className="w-full max-w-6xl">
          <header className="max-w-4xl">
            <h1 className="hero-headline text-[3.25rem] leading-[0.95] text-base-content sm:text-[4.6rem] lg:text-[5.4rem]">
              Start free. <span className="rateloop-text-gradient">Scale when you need it.</span>
            </h1>
          </header>

          <section aria-labelledby="plans-heading" className="mt-14 sm:mt-20">
            <h2 id="plans-heading" className="sr-only">
              Workspace plans
            </h2>
            <WorkspacePlanCards
              locale={locale}
              subscriptionsEnabled={subscriptionsEnabled}
              workspaceId={workspaceId}
              demoBookingUrl={demoBookingUrl}
            />
          </section>

          <Card as="section" className="mt-16 max-w-2xl rounded-2xl p-7 sm:p-9">
            <article>
              <h2 className="text-2xl font-semibold">What counts as a decision?</h2>
              <p className="mt-3 text-base leading-7 text-base-content/60">
                One final verdict counts as a decision. Drafts, failures, and cancellations do not count; there are no
                overages.
              </p>
            </article>
          </Card>
        </div>
      </div>
    </LocalizedPublicContent>
  );
}
