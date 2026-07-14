import Link from "next/link";

const documents = [
  ["Terms", "/legal/terms", "Rules, responsibilities, payment terms, and service limitations."],
  [
    "Privacy notice",
    "/legal/privacy",
    "What RateLoop stores, why it is processed, and what may become public on-chain.",
  ],
  ["Imprint", "/legal/imprint", "Operator and contact information."],
] as const;

export default function LegalPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <div className="border-l-2 border-[var(--rateloop-pink)] pl-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">RateLoop</p>
        <h1 className="display-section mt-3 text-4xl sm:text-5xl">Legal</h1>
      </div>
      <p className="mt-6 max-w-3xl text-lg leading-8 text-base-content/60">
        These documents explain the RateLoop service, its privacy boundaries, payment and reviewer responsibilities,
        public-chain records, and the operator behind the application.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {documents.map(([title, href, description], index) => (
          <Link
            key={href}
            href={href}
            className="rateloop-surface-card group border-l-2 p-6"
            style={{ borderLeftColor: ["#359EEE", "#03CEA4", "#EF476F"][index] }}
          >
            <h2 className="text-lg font-semibold transition-colors group-hover:text-white">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-base-content/50">{description}</p>
            <span className="mt-5 inline-block text-sm text-base-content/70">Read document →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
