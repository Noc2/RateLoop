"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RateLoopLogo } from "~~/components/RateLoopLogo";
import { AnswerSearch } from "~~/components/tokenless/navigation/AnswerSearch";
import { DOCS_NAV } from "~~/constants/docsNav";

const ThirdwebSessionButton = dynamic(
  () => import("~~/components/thirdweb/ThirdwebSessionButton").then(module => module.ThirdwebSessionButton),
  { ssr: false },
);

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
  { href: "/rate", label: "Answer", icon: DiscoverIcon },
  { href: "/ask", label: "Ask", icon: SubmitIcon },
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
        <span className="truncate text-xs text-base-content/75">Human Assurance</span>
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
        const showDocsNavigation = href === "/docs" && active;

        return (
          <div key={href} className="w-full">
            <Link
              href={href}
              className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-4 py-3 transition-colors ${
                active
                  ? "text-base-content"
                  : "text-base-content/75 hover:bg-base-content/[0.04] hover:text-base-content"
              }`}
            >
              <Icon className="h-6 w-6 shrink-0" />
              <span className="text-base font-medium">{label}</span>
              {active ? (
                <span className="absolute bottom-2 right-2 top-2 w-1 rounded-full bg-gradient-to-b from-[var(--rateloop-blue)] via-[var(--rateloop-green)] to-[var(--rateloop-pink)]" />
              ) : null}
            </Link>
            {showDocsNavigation ? (
              <div className={`flex flex-col gap-5 pb-4 pt-3 ${mobile ? "px-2" : "px-1"}`}>
                {DOCS_NAV.map(group => (
                  <section key={group.section}>
                    <h2 className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-base-content/50">
                      {group.section}
                    </h2>
                    <div className="flex flex-col gap-0.5">
                      {group.links.map(link => {
                        const linkActive = pathname === link.href;

                        return (
                          <Link
                            key={link.href}
                            href={link.href}
                            className={`block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                              linkActive
                                ? "bg-base-content font-semibold text-base-100"
                                : "text-base-content/70 hover:bg-base-content/[0.05] hover:text-base-content"
                            }`}
                          >
                            {link.label}
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {mobile ? (
        <div className="mt-2 border-t border-white/10 px-2 pt-4">
          <ThirdwebSessionButton />
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
    <div className="border-b border-white/10 bg-black px-4 py-2 text-base-content xl:pl-52">
      <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 text-center text-[11px] font-medium leading-5 text-base-content/72 sm:text-xs">
        <svg
          className="h-4 w-4 shrink-0 text-error"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 9v5m0 3h.01" />
        </svg>
        {sandboxMode
          ? "Sandbox only: simulated reviews and test funds. Do not use private data."
          : "Early access: check the network and panel terms before funding."}
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
          <li className="flex items-center gap-2">
            <span className="text-base-content/40">·</span>
            <a
              href="https://x.com/RateLoop"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-base-content"
            >
              X
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
            <nav className="dropdown-content z-40 mt-3 max-h-[calc(100vh-5rem)] w-64 overflow-y-auto rounded-xl border border-[color:var(--rateloop-shell-border-strong)] bg-base-200 p-2 shadow-2xl">
              <AnswerSearch mobile />
              <NavLinks mobile />
            </nav>
          </details>
        </div>
      </header>

      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-52 flex-col border-r border-[color:var(--rateloop-shell-border-strong)] bg-black py-4 shadow-[18px_0_48px_rgba(9,10,12,0.24)] xl:flex">
        <div className="mb-4 px-4">
          <Brand />
        </div>
        <AnswerSearch />
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-4">
          <NavLinks />
        </nav>
        <div className="mx-2.5 border-t border-[color:var(--rateloop-shell-border-strong)] pt-4">
          <ThirdwebSessionButton compact />
        </div>
      </aside>

      <main id="main-content" className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden xl:pl-52">
        {children}
      </main>
      <Footer />
    </div>
  );
}
