import type { Metadata } from "next";
import {
  LocalizedPublicContent,
  resolvePublicLocale,
  translatePublicString,
} from "~~/components/docs/LocalizedPublicContent";
import { EvidenceShareViewer } from "~~/components/tokenless/EvidenceShareViewer";

export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale?: string; grantId: string }>;
}): Promise<Metadata> {
  const locale = await resolvePublicLocale(params);
  return {
    title: translatePublicString("Shared evidence", locale, "docs"),
    description: translatePublicString("Open and verify one shared RateLoop evidence packet.", locale, "docs"),
    referrer: "no-referrer",
    robots: { follow: false, index: false },
  };
}

export default async function EvidenceSharePage({ params }: { params: Promise<{ locale?: string; grantId: string }> }) {
  const [{ grantId }, locale] = await Promise.all([params, resolvePublicLocale(params)]);
  return (
    <LocalizedPublicContent locale={locale} section="docs">
      <article className="mx-auto w-full max-w-5xl px-5 py-12 sm:py-16">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rateloop-blue)]">
          Shared evidence
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-base-content sm:text-5xl">
          Verify this evidence packet
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-base-content/65">
          This link unlocks one packet. Verification runs in your browser against RateLoop&apos;s public signing keys.
        </p>
        <EvidenceShareViewer grantId={grantId} />
      </article>
    </LocalizedPublicContent>
  );
}
