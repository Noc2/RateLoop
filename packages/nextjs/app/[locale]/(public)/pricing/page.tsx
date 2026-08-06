import type { Metadata } from "next";
import {
  LocalizedPublicContent,
  resolvePublicLocale,
  translatePublicString,
} from "~~/components/docs/LocalizedPublicContent";
import { WorkspacePlanCards } from "~~/components/pricing/WorkspacePlanCards";
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
            <WorkspacePlanCards locale={locale} workspaceId={workspaceId} demoBookingUrl={demoBookingUrl} />
          </section>
        </div>
      </div>
    </LocalizedPublicContent>
  );
}
