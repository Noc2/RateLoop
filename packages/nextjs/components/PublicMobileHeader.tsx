"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Address } from "viem";
import { useAccount } from "wagmi";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { HeaderBrand, HeaderMenuLinks, closeDetailsMenu } from "~~/components/Header";
import { RateLoopConnectButton } from "~~/components/scaffold-eth";
import { AddressInfoDropdown } from "~~/components/scaffold-eth/ConnectButton/AddressInfoDropdown";
import { ASK_ROUTE, GOVERNANCE_ROUTE, RATE_ROUTE } from "~~/constants/routes";
import { useOutsideClick } from "~~/hooks/scaffold-eth";

const publicNavLinks = [
  { href: RATE_ROUTE, label: "Discover", heavy: true },
  { href: ASK_ROUTE, label: "Submit", heavy: true },
  { href: GOVERNANCE_ROUTE, label: "Reputation", heavy: true },
  { href: "/docs", label: "Docs", heavy: false },
] as const;

const MOBILE_HEADER_SCROLL_DELTA = 12;
const MOBILE_HEADER_HIDE_OFFSET = 72;

function PublicMobileMenuLinks() {
  const { address } = useAccount();

  return (
    <>
      <HeaderMenuLinks />
      {address ? (
        <>
          <li className="divider my-1" />
          <AddressInfoDropdown
            address={address as Address}
            displayName={`${address.slice(0, 6)}...${address.slice(-4)}`}
            menuItemsOnly
          />
        </>
      ) : null}
    </>
  );
}

export function PublicMobileHeader() {
  const pathname = usePathname() ?? "";
  const menuRef = useRef<HTMLDetailsElement>(null);
  const lastScrollYRef = useRef(0);
  const [isMobileHeaderVisible, setIsMobileHeaderVisible] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMenu = useCallback(() => {
    closeDetailsMenu(menuRef.current);
    setMobileMenuOpen(false);
  }, []);

  useOutsideClick(menuRef, closeMenu);

  useEffect(() => {
    closeMenu();
    setIsMobileHeaderVisible(true);
    lastScrollYRef.current = window.scrollY;
  }, [closeMenu, pathname]);

  useEffect(() => {
    lastScrollYRef.current = window.scrollY;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (menuRef.current?.open) {
        setIsMobileHeaderVisible(true);
        lastScrollYRef.current = currentScrollY;
        return;
      }

      const scrollDelta = currentScrollY - lastScrollYRef.current;
      if (Math.abs(scrollDelta) < MOBILE_HEADER_SCROLL_DELTA) {
        return;
      }

      setIsMobileHeaderVisible(scrollDelta < 0 || currentScrollY < MOBILE_HEADER_HIDE_OFFSET);
      lastScrollYRef.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const headerVisible = isMobileHeaderVisible || mobileMenuOpen;

  return (
    <header
      className={`sticky top-0 z-20 border-b border-white/10 bg-black/95 px-4 py-3 backdrop-blur-xl transition-transform will-change-transform sm:px-6 xl:hidden ${
        headerVisible ? "translate-y-0" : "-translate-y-full"
      }`}
      data-mobile-header="true"
      data-visible={headerVisible ? "true" : "false"}
      inert={headerVisible ? undefined : true}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <details
            ref={menuRef}
            className="dropdown relative z-50"
            onToggle={() => {
              const nextOpen = menuRef.current?.open ?? false;
              setMobileMenuOpen(nextOpen);
              if (nextOpen) setIsMobileHeaderVisible(true);
            }}
          >
            <summary className="btn btn-ghost btn-sm p-1 hover:bg-transparent" aria-label="Open menu">
              <Bars3Icon className="h-5 w-5" />
            </summary>
            <ul
              className="menu menu-compact dropdown-content z-[80] mt-3 w-64 rounded-xl border border-[color:var(--rateloop-shell-border-strong)] bg-base-200 p-2 shadow-lg"
              onClick={() => window.setTimeout(closeMenu, 0)}
            >
              <Suspense>
                <PublicMobileMenuLinks />
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

        <RateLoopConnectButton compact />
      </div>
    </header>
  );
}
