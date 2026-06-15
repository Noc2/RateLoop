"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { HeaderBrand, HeaderMenuLinks, closeDetailsMenu } from "~~/components/Header";
import { HumanSignInButton } from "~~/components/shared/HumanSignInButton";
import { ASK_ROUTE, GOVERNANCE_ROUTE, RATE_ROUTE } from "~~/constants/routes";
import { useOutsideClick } from "~~/hooks/scaffold-eth";
import { HUMAN_SIGN_IN_DISCOVER_ROUTE, HUMAN_SIGN_IN_LABEL } from "~~/lib/home/humanSignInRoute";

const publicNavLinks = [
  { href: RATE_ROUTE, label: "Discover", heavy: true },
  { href: ASK_ROUTE, label: "Submit", heavy: true },
  { href: GOVERNANCE_ROUTE, label: "Reputation", heavy: true },
  { href: "/docs", label: "Docs", heavy: false },
] as const;

export function PublicSignInButton({ className = "" }: { className?: string }) {
  return (
    <HumanSignInButton
      className={className}
      data-testid="public-auth-connect-button"
      gradientMotion="idle"
      gradientSize="sm"
      postSignInRoute={HUMAN_SIGN_IN_DISCOVER_ROUTE}
    >
      {HUMAN_SIGN_IN_LABEL}
    </HumanSignInButton>
  );
}

export function PublicMobileHeader() {
  const pathname = usePathname() ?? "";
  const menuRef = useRef<HTMLDetailsElement>(null);

  const closeMenu = useCallback(() => {
    closeDetailsMenu(menuRef.current);
  }, []);

  useOutsideClick(menuRef, closeMenu);

  useEffect(() => {
    closeMenu();
  }, [closeMenu, pathname]);

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-black/95 px-4 py-3 backdrop-blur-xl sm:px-6 xl:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <details ref={menuRef} className="dropdown relative z-50">
            <summary className="btn btn-ghost btn-sm p-1 hover:bg-transparent" aria-label="Open menu">
              <Bars3Icon className="h-5 w-5" />
            </summary>
            <ul
              className="menu menu-compact dropdown-content z-[80] mt-3 w-64 rounded-xl border border-[color:var(--rateloop-shell-border-strong)] bg-base-200 p-2 shadow-lg"
              onClick={closeMenu}
            >
              <Suspense>
                <HeaderMenuLinks />
              </Suspense>
            </ul>
          </details>
          <HeaderBrand brandIdPrefix="rateloop-public-header-logo" compact />
        </div>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {publicNavLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              prefetch={link.heavy ? false : undefined}
              className="rounded-lg px-3 py-2 text-sm font-medium text-base-content/60 transition-colors hover:bg-base-content/[0.06] hover:text-base-content"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <PublicSignInButton />
      </div>
    </header>
  );
}
