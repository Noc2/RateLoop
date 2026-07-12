import Link from "next/link";
import { RateLoopLogo } from "~~/components/RateLoopLogo";

const links = [
  { href: "/ask", label: "Run a panel" },
  { href: "/rate", label: "Rate tasks" },
  { href: "/settings", label: "Unlock paid tasks" },
  { href: "/docs", label: "Docs" },
] as const;

export function TokenlessShell({ children, sandboxMode }: { children: React.ReactNode; sandboxMode: boolean }) {
  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <div className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-center text-xs text-amber-100">
        {sandboxMode
          ? "Tokenless test sandbox — simulated panels and test data only. No real paid work or production funds."
          : "Tokenless test deployment — contracts and services are disposable until Phase 5 hardening."}
      </div>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
            <RateLoopLogo className="h-8 w-8" idPrefix="tokenless-shell-logo" />
            <span>RateLoop</span>
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/55">
              tokenless
            </span>
          </Link>
          <nav className="flex flex-wrap items-center justify-end gap-1" aria-label="Primary">
            {links.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm text-white/65 transition hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className="border-t border-white/10 px-4 py-8 text-center text-xs text-white/45">
        <p>
          Non-custodial escrow test. Admission is operator-attested; normal claims link a vote key to its payout
          address.
        </p>
        <p className="mt-3 flex justify-center gap-4">
          <Link href="/legal/terms" className="hover:text-white">
            Test terms
          </Link>
          <Link href="/legal/privacy" className="hover:text-white">
            Privacy
          </Link>
          <Link href="/legal/imprint" className="hover:text-white">
            Imprint
          </Link>
        </p>
      </footer>
    </div>
  );
}
