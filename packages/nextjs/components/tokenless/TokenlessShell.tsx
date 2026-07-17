"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RateLoopLogo } from "~~/components/RateLoopLogo";
import { SiteSearch } from "~~/components/tokenless/navigation/SiteSearch";
import { DOCS_NAV } from "~~/constants/docsNav";

const ThirdwebSessionButton = dynamic(
  () => import("~~/components/thirdweb/ThirdwebSessionButton").then(module => module.ThirdwebSessionButton),
  { ssr: false },
);

type IconProps = { className?: string };

function GlobeAltIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      <path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.2 2.46 3.3 5.46 3.3 9S14.2 18.54 12 21M12 3c-2.2 2.46-3.3 5.46-3.3 9S9.8 18.54 12 21" />
    </svg>
  );
}

function PlusCircleIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 9v6m3-3H9" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function BookOpenIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 6.25v13m0-13C10.83 5.48 9.25 5 7.5 5S4.17 5.48 3 6.25v13C4.17 18.48 5.75 18 7.5 18s3.33.48 4.5 1.25m0-13C13.17 5.48 14.75 5 16.5 5s3.33.48 4.5 1.25v13C19.83 18.48 18.25 18 16.5 18s-3.33.48-4.5 1.25" />
    </svg>
  );
}

const links = [
  { href: "/human", label: "Humans", icon: GlobeAltIcon },
  { href: "/agents", label: "Agents", icon: PlusCircleIcon },
  { href: "/docs", label: "Docs", icon: BookOpenIcon },
] as const;

const footerLinks = [
  ["Pricing", "/pricing"],
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
              prefetch={false}
              className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-4 py-3 transition-colors duration-200 ${
                active
                  ? "text-base-content"
                  : "text-base-content/75 hover:bg-base-content/[0.04] hover:text-base-content"
              }`}
            >
              <Icon className="relative z-10 h-6 w-6 shrink-0 transition-colors duration-200" />
              <span className="relative z-10 text-base font-medium transition-colors duration-200">{label}</span>
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
                            className={`block rounded-lg px-3 py-1.5 text-base transition-colors ${
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
          <div className="mt-3 flex items-center gap-3 px-2 text-sm text-base-content/60">
            <Link href="/pricing" className="transition-colors hover:text-base-content">
              Pricing
            </Link>
            <span aria-hidden="true" className="text-base-content/30">
              ·
            </span>
            <Link href="/legal" className="transition-colors hover:text-base-content">
              Legal
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Footer() {
  return (
    <footer className="shrink-0 border-t border-white/10 px-4 py-9 xl:pl-52">
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

export function TokenlessShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-base-100 text-base-content">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-base-100 px-4 py-3 backdrop-blur-xl xl:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Brand compact />
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
            <SiteSearch mobile />
            <details className="dropdown dropdown-end">
              <summary className="btn btn-ghost btn-sm list-none px-2" aria-label="Open navigation">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </summary>
              <nav className="dropdown-content z-40 mt-3 max-h-[calc(100vh-5rem)] w-64 overflow-y-auto rounded-xl border border-[color:var(--rateloop-shell-border-strong)] bg-base-200 p-2 shadow-2xl">
                <NavLinks mobile />
              </nav>
            </details>
          </div>
        </div>
      </header>

      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-52 shrink-0 flex-col items-stretch border-r border-[color:var(--rateloop-shell-border-strong)] bg-base-100 py-4 shadow-[18px_0_48px_rgba(9,10,12,0.24)] xl:flex">
        <div className="mb-4 px-4">
          <Brand />
        </div>
        <SiteSearch />
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-4">
          <NavLinks />
        </nav>
        <div className="mt-auto flex w-full shrink-0 flex-col items-stretch gap-2 border-t border-[color:var(--rateloop-shell-border-strong)] px-2.5 pt-4">
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
