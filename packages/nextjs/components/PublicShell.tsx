import { Suspense } from "react";
import { BetaNoticeBanner } from "~~/components/BetaNoticeBanner";
import { FooterLinks } from "~~/components/FooterLinks";
import { HeaderBrand, HeaderMenuLinks, HeaderSearchBar } from "~~/components/Header";
import { PublicMobileHeader } from "~~/components/PublicMobileHeader";
import { ReferralAttributionCapture } from "~~/components/referrals/ReferralAttributionCapture";
import { RateLoopConnectButton } from "~~/components/scaffold-eth";

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
          <RateLoopConnectButton inlineMenu />
        </div>
      </div>
    </aside>
  );
}

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-base-100 text-base-content">
      <div className="xl:pl-52">
        <BetaNoticeBanner />
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
