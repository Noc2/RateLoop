import type { Metadata } from "next";
import {
  LocalizedPublicContent,
  type PublicLocaleParams,
  getLocalizedPublicMetadata,
  usePublicLocale,
} from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";
import { PublicEvidenceVerifier } from "~~/components/tokenless/PublicEvidenceVerifier";

const VERIFY_DESCRIPTION = "Check a RateLoop evidence packet in your browser without uploading it.";

export function generateMetadata({ params }: { params: PublicLocaleParams }): Promise<Metadata> {
  return getLocalizedPublicMetadata({
    params,
    section: "docs",
    title: "Verify evidence",
    description: VERIFY_DESCRIPTION,
  });
}

export default function VerifyEvidencePage({ params }: { params?: PublicLocaleParams } = {}) {
  const locale = usePublicLocale(params);
  return (
    <LocalizedPublicContent locale={locale} section="docs">
      <article className="max-w-none">
        <Link
          className="text-sm font-medium text-base-content/60 transition-colors hover:text-base-content"
          href="/docs/evidence#verify"
        >
          ← Evidence reference
        </Link>
        <p className="mt-8 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rateloop-blue)]">
          Public verification
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-base-content sm:text-5xl">
          Verify an evidence packet
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-base-content/65">
          Paste or choose an exported packet. This page checks its digest, both Merkle roots, privacy-safe aggregation,
          and signature against RateLoop&apos;s public current and retired keys.
        </p>
        <p className="mt-5 max-w-3xl rounded-2xl border-l-2 border-[var(--rateloop-yellow)] bg-warning/[0.06] p-4 text-sm leading-6 text-base-content/70">
          Chain evidence is carried in the packet but is not independently checked here. Compare those references with
          an independently selected RPC or indexer.
        </p>

        <PublicEvidenceVerifier />
      </article>
    </LocalizedPublicContent>
  );
}
