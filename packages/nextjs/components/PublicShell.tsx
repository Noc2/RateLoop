import { Suspense } from "react";
import Link from "next/link";
import { FooterLinks } from "~~/components/FooterLinks";
import { HeaderBrand, HeaderMenuLinks, HeaderSearchBar } from "~~/components/Header";
import { TestnetNoticeBanner } from "~~/components/TestnetNoticeBanner";
import { ReferralAttributionCapture } from "~~/components/referrals/ReferralAttributionCapture";
import { GradientActionInner, getGradientActionClassName } from "~~/components/shared/GradientAction";
import { ASK_ROUTE, GOVERNANCE_ROUTE, RATE_ROUTE } from "~~/constants/routes";
import { HUMAN_SIGN_IN_FAUCET_ROUTE, HUMAN_SIGN_IN_LABEL } from "~~/lib/home/humanSignInRoute";
import scaffoldConfig from "~~/scaffold.config";

const publicNavLinks = [
  { href: RATE_ROUTE, label: "Discover", heavy: true },
  { href: ASK_ROUTE, label: "Submit", heavy: true },
  { href: GOVERNANCE_ROUTE, label: "Reputation", heavy: true },
  { href: "/docs", label: "Docs", heavy: false },
] as const;

function PublicSignInButton({ className = "" }: { className?: string }) {
  return (
    <Link
      href={HUMAN_SIGN_IN_FAUCET_ROUTE}
      className={getGradientActionClassName(className)}
      data-motion="idle"
      data-size="sm"
    >
      <GradientActionInner>{HUMAN_SIGN_IN_LABEL}</GradientActionInner>
    </Link>
  );
}

function PublicMobileHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-black/95 px-4 py-3 backdrop-blur-xl sm:px-6 xl:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <HeaderBrand brandIdPrefix="rateloop-public-header-logo" compact />

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

function PublicDesktopSidebar() {
  return (
    <aside className="fixed left-0 top-0 z-20 hidden h-screen w-52 shrink-0 flex-col items-stretch border-r border-[color:var(--rateloop-shell-border-strong)] bg-black py-4 shadow-[18px_0_48px_rgba(9,10,12,0.24)] xl:flex">
      <HeaderBrand brandIdPrefix="rateloop-public-sidebar-logo" className="mb-4 shrink-0 px-4" />
      <div className="mb-4 w-full min-w-0 px-2.5">
        <Suspense>
          <HeaderSearchBar className="sidebar" />
        </Suspense>
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 overflow-y-auto">
        <ul className="menu menu-vertical w-full gap-0.5 p-0">
          <HeaderMenuLinks variant="desktop" />
        </ul>
      </nav>
      <div className="mt-auto flex w-full shrink-0 flex-col items-stretch gap-2 border-t border-[color:var(--rateloop-shell-border-strong)] px-2.5 pt-4">
        <div className="flex w-full justify-stretch">
          <PublicSignInButton />
        </div>
      </div>
    </aside>
  );
}

export function PublicShell({ children }: { children: React.ReactNode }) {
  const publicTargetChainId = scaffoldConfig.targetNetworks[0].id;

  return (
    <div className="flex min-h-screen flex-col bg-base-100 text-base-content">
      <div className="xl:pl-52">
        <TestnetNoticeBanner targetChainId={publicTargetChainId} />
      </div>
      <PublicMobileHeader />
      <PublicDesktopSidebar />
      <main id="main-content" className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden xl:pl-52">
        {children}
      </main>
      <footer className="shrink-0 border-t border-white/10 px-4 py-10 xl:pl-52">
        <FooterLinks
          className="w-full"
          listClassName="w-full justify-center text-sm lg:text-base"
          linkClassName="text-base-content/70 transition-colors hover:text-base-content/90"
          separatorClassName="text-base-content/50"
        />
      </footer>
      <Suspense fallback={null}>
        <ReferralAttributionCapture />
      </Suspense>
    </div>
  );
}
