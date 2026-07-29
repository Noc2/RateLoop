import type { Metadata } from "next";
import { EvidenceShareViewer } from "~~/components/tokenless/EvidenceShareViewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shared evidence",
  description: "Open and verify one shared RateLoop evidence packet.",
  referrer: "no-referrer",
  robots: { follow: false, index: false },
};

export default async function EvidenceSharePage({ params }: { params: Promise<{ grantId: string }> }) {
  const { grantId } = await params;
  return (
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
  );
}
