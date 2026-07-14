import { AccountTabs } from "~~/components/tokenless/account/AccountTabs";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <div className="border-l-2 border-[var(--rateloop-blue)] pl-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Account</p>
        <h1 className="display-section mt-3 text-4xl sm:text-5xl">Your RateLoop account</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-base-content/60">
          Keep your private profile, reviewer access, paid-work eligibility, and workspace controls in one place.
        </p>
      </div>
      <AccountTabs />
      {children}
    </div>
  );
}
