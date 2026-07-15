import Link from "next/link";
import type { Metadata } from "next";
import { TRUST_CLAIM_REGISTRY, type TrustClaim, getCurrentPublicTrustClaims } from "~~/content/trustClaims";

export const metadata: Metadata = {
  title: "Trust | RateLoop",
  description: "Review RateLoop's implemented privacy and security controls, evidence, and current limits.",
};

const statusLabel: Record<TrustClaim["status"], string> = {
  implemented: "Implemented",
  limitation: "Permanent boundary",
  not_available: "Not available",
  verification_pending: "Verification pending",
};

function EvidenceLinks({ claim }: { claim: TrustClaim }) {
  return (
    <ul className="mt-5 flex flex-wrap gap-2" aria-label={`Evidence for ${claim.title}`}>
      {claim.evidence.map(evidence => (
        <li key={`${claim.key}-${evidence.href}`}>
          <Link
            href={evidence.href}
            prefetch={false}
            className="inline-flex rounded-md border border-base-content/10 bg-base-content/[0.06] px-3 py-1.5 text-xs font-semibold text-base-content/72 transition hover:border-base-content/20 hover:bg-base-content/[0.1] hover:text-base-content"
          >
            {evidence.label} <span aria-hidden="true">↗</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ClaimCard({ claim, accent }: { claim: TrustClaim; accent: string }) {
  return (
    <article
      className="surface-card flex h-full flex-col rounded-2xl border-l-2 p-6 sm:p-7"
      style={{ borderColor: accent }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.18em]" style={{ color: accent }}>
          {statusLabel[claim.status]}
        </p>
        <p className="font-mono text-[0.7rem] text-base-content/40">Review {claim.reviewDate}</p>
      </div>
      <h3 className="mt-4 text-xl font-semibold">{claim.title}</h3>
      <p className="mt-3 text-base leading-7 text-base-content/65">{claim.statement}</p>
      <div className="mt-auto">
        <EvidenceLinks claim={claim} />
      </div>
    </article>
  );
}

export default function TrustPage() {
  const claims = getCurrentPublicTrustClaims();
  const implemented = claims.filter(claim => claim.kind === "control");
  const boundaries = claims.filter(claim => claim.kind === "limitation");
  const unavailable = claims.filter(claim => claim.kind === "availability");

  return (
    <div className="flex grow flex-col items-center px-4 pb-20 pt-12 sm:pt-16 lg:pt-20">
      <div className="w-full max-w-6xl">
        <header className="max-w-4xl">
          <p className="font-mono text-sm uppercase tracking-[0.22em] text-[var(--rateloop-green)]">
            Trust registry {TRUST_CLAIM_REGISTRY.version}
          </p>
          <h1 className="hero-headline mt-5 text-[3.25rem] leading-[0.95] text-base-content sm:text-[4.6rem] lg:text-[5.4rem]">
            Trust, with <span className="rateloop-text-gradient">evidence and limits.</span>
          </h1>
          <p className="mt-7 max-w-3xl text-lg leading-8 text-base-content/65 sm:text-xl">
            Review RateLoop&apos;s implemented controls and current limits. Each statement below is versioned, approved,
            linked to evidence, and dated for review.
          </p>
          <p className="mt-4 font-mono text-xs uppercase tracking-wider text-base-content/40">
            Registry updated {TRUST_CLAIM_REGISTRY.updatedDate}
          </p>
        </header>

        <section aria-labelledby="implemented-controls" className="mt-16 sm:mt-20">
          <p className="font-mono text-sm tracking-widest text-base-content/55">01</p>
          <h2 id="implemented-controls" className="display-section mt-5 text-[3rem] sm:text-[4rem]">
            Implemented <span className="rateloop-text-gradient">controls</span>
          </h2>
          <div className="mt-9 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {implemented.map((claim, index) => (
              <ClaimCard
                key={claim.key}
                claim={claim}
                accent={["#359EEE", "#03CEA4", "#EF476F"][index % 3] ?? "#359EEE"}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="hard-boundaries" className="mt-16 sm:mt-20">
          <p className="font-mono text-sm tracking-widest text-base-content/55">02</p>
          <h2 id="hard-boundaries" className="display-section mt-5 text-[3rem] sm:text-[4rem]">
            Hard <span className="rateloop-text-gradient">boundaries</span>
          </h2>
          <div className="mt-9 grid gap-5">
            {boundaries.map(claim => (
              <ClaimCard key={claim.key} claim={claim} accent="#FFC43D" />
            ))}
          </div>
        </section>

        <section aria-labelledby="not-claimed" className="mt-16 sm:mt-20">
          <p className="font-mono text-sm tracking-widest text-base-content/55">03</p>
          <h2 id="not-claimed" className="display-section mt-5 text-[3rem] sm:text-[4rem]">
            Not <span className="rateloop-text-gradient">claimed</span>
          </h2>
          <p className="mt-5 max-w-3xl text-base leading-7 text-base-content/60">
            Configuration and engineering work are not substitutes for independent evidence, contracts, or
            certification. These items stay unavailable or pending until their external gates are complete.
          </p>
          <div className="mt-9 grid gap-5 md:grid-cols-2">
            {unavailable.map((claim, index) => (
              <ClaimCard key={claim.key} claim={claim} accent={index % 2 === 0 ? "#EF476F" : "#FFC43D"} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
