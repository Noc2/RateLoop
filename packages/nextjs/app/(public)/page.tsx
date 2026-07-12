import Link from "next/link";

const principles = [
  ["No rater stake", "Raters never deposit, approve, or risk funds."],
  ["Accepted work gets a paid path", "A disclosed reserve compensates accepted work when a panel cannot complete."],
  [
    "Honest trust split",
    "The panel core has no operator withdrawal path; the credential issuer controls only future admission.",
  ],
] as const;

export default function TokenlessLandingPage() {
  return (
    <div className="px-4 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-4xl">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-sky-300">Paid human panels on Base</p>
          <h1 className="mt-5 text-5xl font-semibold leading-[1.02] sm:text-7xl">
            Ask a focused question. Get a sealed human panel.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-white/60">
            Tokenless RateLoop funds binary and A/B panels in USDC. Quotes separate the bounty, platform fee, and
            maximum accepted-work reserve before payment.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/ask" className="btn btn-primary rounded-xl px-6">
              Run a panel
            </Link>
            <Link href="/rate" className="btn btn-outline rounded-xl px-6">
              Explore rater flow
            </Link>
          </div>
        </div>

        <section className="mt-20 grid gap-4 md:grid-cols-3" aria-label="Protocol principles">
          {principles.map(([title, body]) => (
            <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
              <h2 className="text-xl font-semibold">{title}</h2>
              <p className="mt-3 leading-7 text-white/55">{body}</p>
            </article>
          ))}
        </section>

        <section className="mt-20 rounded-3xl border border-white/10 bg-black/25 p-7 sm:p-10">
          <p className="text-sm font-semibold text-amber-200">Test-stage limitations</p>
          <ul className="mt-4 grid gap-3 text-sm leading-6 text-white/55 md:grid-cols-2">
            <li>Credential issuance can admit or censor future raters, but cannot redirect escrowed funds.</li>
            <li>USDC inherits Circle freeze, blacklist, and depeg risks.</li>
            <li>Vote sealing trusts drand availability.</li>
            <li>A normal claim publicly links the one-time vote key to its payout address.</li>
          </ul>
          <Link href="/docs" className="mt-6 inline-block text-sm font-medium text-sky-300 hover:text-sky-200">
            Read the trust and lifecycle notes →
          </Link>
        </section>
      </div>
    </div>
  );
}
