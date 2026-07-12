"use client";

import { useState } from "react";
import Link from "next/link";

export function TokenlessRateClient({ sandboxMode }: { sandboxMode: boolean }) {
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [prediction, setPrediction] = useState<number | null>(null);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-sky-300">Rater preview</p>
          <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">One answer. One prediction.</h1>
          <p className="mt-4 max-w-2xl leading-7 text-white/55">
            Browsing and advisory calibration require no tax form or payout wallet. Paid eligibility must be complete
            before the first paid voucher is issued.
          </p>

          <article className="mt-9 rounded-2xl border border-white/10 bg-white/[0.035] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/45">
              <span>{sandboxMode ? "Sandbox interaction preview" : "Interaction preview only"}</span>
              <span>Guaranteed base $1.33 · possible bonus $0.33 · failure compensation up to $0.50</span>
            </div>
            <h2 className="mt-5 text-2xl font-semibold">Would this message make you more likely to try the product?</h2>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {(["yes", "no"] as const).map(value => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-xl border p-4 font-semibold ${answer === value ? "border-sky-300 bg-sky-300/10" : "border-white/10 bg-black/20"}`}
                  onClick={() => setAnswer(value)}
                >
                  {value === "yes" ? "Yes" : "No"}
                </button>
              ))}
            </div>
            <p className="mt-7 text-sm font-semibold">What share of the panel will answer Yes?</p>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {[10, 30, 50, 70, 90].map(value => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-lg border px-2 py-3 text-sm ${prediction === value ? "border-emerald-300 bg-emerald-300/10" : "border-white/10"}`}
                  onClick={() => setPrediction(value)}
                >
                  {value}%
                </button>
              ))}
            </div>
            <button type="button" className="btn mt-6 w-full rounded-xl" disabled>
              Preview only — voucher relay arrives in the eligibility slice
            </button>
          </article>
        </section>

        <aside className="h-fit rounded-2xl border border-white/10 bg-black/25 p-6">
          <h2 className="text-lg font-semibold">Unlock paid tasks first</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-white/55">
            <li>18+ and identity assurance tier</li>
            <li>Residence and applicable DAC7 fields</li>
            <li>Sanctions consent and screening</li>
            <li>Self-custodial payout destination</li>
          </ul>
          <p className="mt-5 rounded-xl bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
            This test UI does not issue a paid voucher yet. It never creates an inaccessible earned balance.
          </p>
          <Link href="/settings" className="btn btn-outline mt-5 w-full rounded-xl">
            Review paid-task unlock
          </Link>
        </aside>
      </div>
    </div>
  );
}
