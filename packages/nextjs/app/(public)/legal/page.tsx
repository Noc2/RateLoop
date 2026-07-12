import Link from "next/link";

const documents = [
  ["Test terms", "/legal/terms", "Rules and limitations for this tokenless test deployment."],
  ["Privacy notice", "/legal/privacy", "What the test interface stores and what may become public on-chain."],
  ["Imprint", "/legal/imprint", "Operator and contact information."],
] as const;

export default function LegalPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-4xl font-semibold">Legal</h1>
      <p className="mt-4 leading-7 text-white/55">
        These documents cover the isolated tokenless test deployment. It does not currently issue paid vouchers or
        accept production funds.
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {documents.map(([title, href, description]) => (
          <Link key={href} href={href} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-white/50">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
