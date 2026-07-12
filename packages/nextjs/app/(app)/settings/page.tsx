export default function PaidTaskUnlockPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-sky-300">Eligibility before earnings</p>
      <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">Unlock paid tasks</h1>
      <p className="mt-5 leading-7 text-white/55">
        Browsing and advisory calibration stay frictionless. This combined step happens only before the first paid
        voucher, so nobody earns money and later discovers that the claim is blocked.
      </p>
      <div className="mt-9 space-y-3">
        {[
          "Confirm age and residence",
          "Complete the selected identity tier",
          "Provide applicable DAC7 fields",
          "Complete sanctions screening",
          "Set a self-custodial payout destination",
        ].map((label, index) => (
          <div key={label} className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.035] p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 font-mono text-xs">
              {index + 1}
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-5 text-sm leading-6 text-amber-100">
        Test-stage limitation: eligibility storage, screening, and credential signing are not active in this UI slice.
        No paid voucher is issued. A normal payout claim will link the one-time vote key to its payout address.
      </div>
    </div>
  );
}
