"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RateLoopLogo } from "~~/components/RateLoopLogo";
import { BaseAccountSessionButton } from "~~/components/base-account/BaseAccountSessionButton";

type IconProps = { className?: string };

function DiscoverIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="9" />
      <path d="m15.4 8.6-2.1 4.7-4.7 2.1 2.1-4.7 4.7-2.1Z" />
    </svg>
  );
}

function SubmitIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function AccountIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19c.7-3.2 3-5 6.5-5s5.8 1.8 6.5 5" />
    </svg>
  );
}

function DocsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 1 5 16V4.5Z" />
      <path d="M8.5 16H19M8 8h7M8 11h6" />
    </svg>
  );
}

const links = [
  { href: "/rate", label: "Discover", icon: DiscoverIcon },
  { href: "/ask", label: "Submit", icon: SubmitIcon },
  { href: "/settings", label: "Account", icon: AccountIcon },
  { href: "/docs", label: "Docs", icon: DocsIcon },
] as const;

const footerLinks = [
  ["Terms", "/legal/terms"],
  ["Privacy", "/legal/privacy"],
  ["Imprint", "/legal/imprint"],
] as const;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2">
      <RateLoopLogo className={compact ? "h-8 w-8 shrink-0" : "h-9 w-9 shrink-0"} idPrefix="tokenless-brand" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className={`font-display truncate leading-none text-base-content ${compact ? "text-[1.35rem]" : "text-[1.2rem]"}`}
        >
          RateLoop
        </span>
        <span className="truncate text-xs text-base-content/75">Level Up Your Agent</span>
      </div>
    </Link>
  );
}

function NavLinks({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname() ?? "";

  return (
    <>
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-4 py-3 transition-colors ${
              active ? "text-base-content" : "text-base-content/75 hover:bg-base-content/[0.04] hover:text-base-content"
            }`}
          >
            <Icon className="h-6 w-6 shrink-0" />
            <span className="text-base font-medium">{label}</span>
            {active ? (
              <span className="absolute bottom-2 right-2 top-2 w-1 rounded-full bg-gradient-to-b from-[var(--rateloop-blue)] via-[var(--rateloop-green)] to-[var(--rateloop-pink)]" />
            ) : null}
          </Link>
        );
      })}
      {mobile ? (
        <div className="mt-2 border-t border-white/10 px-2 pt-4">
          <BaseAccountSessionButton />
          <Link href="/legal" className="mt-3 block px-2 text-sm text-base-content/60">
            Legal
          </Link>
        </div>
      ) : null}
    </>
  );
}

function Notice({ sandboxMode }: { sandboxMode: boolean }) {
  return (
    <div className="border-b border-white/10 bg-black px-4 py-2.5 text-base-content xl:pl-56">
      <p className="mx-auto max-w-6xl text-center text-xs font-medium leading-5 text-base-content/72 sm:text-sm">
        <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--rateloop-yellow)]" />
        {sandboxMode
          ? "Preview network — panels use test funds while the Base deployment is prepared."
          : "Early access — verify the network and panel terms before funding."}
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="shrink-0 border-t border-white/10 px-4 py-9 xl:pl-56">
      <nav aria-label="Footer">
        <ul className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-base-content/70 lg:text-base">
          {footerLinks.map(([label, href], index) => (
            <li key={href} className="flex items-center gap-2">
              <Link href={href} className="transition-colors hover:text-base-content">
                {label}
              </Link>
              {index < footerLinks.length - 1 ? <span className="text-base-content/40">·</span> : null}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="text-base-content/40">·</span>
            <a
              href="https://github.com/Noc2/RateLoop"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-base-content"
            >
              GitHub
            </a>
          </li>
        </ul>
      </nav>
    </footer>
  );
}

export function TokenlessShell({ children, sandboxMode }: { children: React.ReactNode; sandboxMode: boolean }) {
  return (
    <div className="flex min-h-screen flex-col bg-base-100 text-base-content">
      <Notice sandboxMode={sandboxMode} />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/95 px-4 py-3 backdrop-blur-xl xl:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Brand compact />
          <details className="dropdown dropdown-end">
            <summary className="btn btn-ghost btn-sm list-none px-2" aria-label="Open navigation">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </summary>
            <nav className="dropdown-content z-40 mt-3 w-64 rounded-xl border border-[color:var(--rateloop-shell-border-strong)] bg-base-200 p-2 shadow-2xl">
              <NavLinks mobile />
            </nav>
          </details>
        </div>
      </header>

      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-52 flex-col border-r border-[color:var(--rateloop-shell-border-strong)] bg-black py-4 shadow-[18px_0_48px_rgba(9,10,12,0.24)] xl:flex">
        <div className="mb-5 px-4">
          <Brand />
        </div>
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 px-2.5">
          <NavLinks />
        </nav>
        <div className="mx-2.5 border-t border-[color:var(--rateloop-shell-border-strong)] pt-4">
          <BaseAccountSessionButton />
          <p className="mt-3 px-1 text-center text-[11px] leading-4 text-base-content/40">USDC panels on Base</p>
        </div>
      </aside>

      <main id="main-content" className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden xl:pl-52">
        {children}
      </main>
      <Footer />
    </div>
  );
}
