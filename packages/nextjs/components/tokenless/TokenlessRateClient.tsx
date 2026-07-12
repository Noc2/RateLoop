"use client";

import { useState } from "react";
import Link from "next/link";

export function TokenlessRateClient({ sandboxMode }: { sandboxMode: boolean }) {
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [prediction, setPrediction] = useState<number | null>(null);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <div className="border-l-2 border-[var(--rateloop-green)] pl-6">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Discover</p>
            <h1 className="display-section mt-3 text-4xl sm:text-5xl">One answer. One prediction.</h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-base-content/60">
              Browsing and advisory calibration require no tax form or payout wallet. Paid eligibility must be complete
              before the first paid voucher is issued.
            </p>
          </div>

          <article className="rateloop-surface-card mt-9 p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4 text-xs text-base-content/45">
              <span>{sandboxMode ? "Preview panel" : "Paid panel"}</span>
              <span>Guaranteed base $1.33 · possible bonus $0.33 · failure compensation up to $0.50</span>
            </div>
            <h2 className="mt-6 text-2xl font-semibold leading-tight sm:text-3xl">
              Would this message make you more likely to try the product?
            </h2>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {(["yes", "no"] as const).map(value => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-lg border p-4 font-semibold transition-colors ${answer === value ? "border-base-content/55 bg-base-content/[0.1]" : "border-white/10 bg-black/20 hover:border-white/25 hover:bg-white/[0.04]"}`}
                  onClick={() => setAnswer(value)}
                >
                  {value === "yes" ? "Yes" : "No"}
                </button>
              ))}
            </div>
            <p className="mt-8 font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">
              Predict the panel · What share will answer Yes?
            </p>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {[10, 30, 50, 70, 90].map(value => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-lg border px-2 py-3 text-sm transition-colors ${prediction === value ? "border-[var(--rateloop-green)] bg-emerald-300/10" : "border-white/10 hover:border-white/25 hover:bg-white/[0.04]"}`}
                  onClick={() => setPrediction(value)}
                >
                  {value}%
                </button>
              ))}
            </div>
            <button
              type="button"
              className="rateloop-gradient-action mt-6 w-full px-6 disabled:cursor-not-allowed disabled:opacity-45"
              disabled
            >
              Submit sealed response
            </button>
          </article>
        </section>

        <aside className="rateloop-surface-card sticky top-24 h-fit p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">Before paid work</p>
          <h2 className="mt-2 text-xl font-semibold">Unlock paid tasks</h2>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-base-content/60">
            <li>18+ and identity assurance tier</li>
            <li>Residence and applicable DAC7 fields</li>
            <li>Sanctions consent and screening</li>
            <li>Self-custodial payout destination</li>
          </ul>
          <p className="mt-5 border-l-2 border-[var(--rateloop-yellow)] bg-amber-300/10 py-2 pl-3 text-xs leading-5 text-amber-100">
            Eligibility is completed before the first paid voucher, so earned work never sits behind a surprise claim
            requirement.
          </p>
          <Link href="/settings" className="rateloop-gradient-action mt-5 w-full px-5">
            Set up account
          </Link>
        </aside>
      </div>
    </div>
  );
}
