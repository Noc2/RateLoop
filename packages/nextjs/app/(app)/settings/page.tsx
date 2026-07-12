const requirements = [
  [
    "01",
    "Confirm age and residence",
    "Establish paid-work eligibility and the rules that apply where you live.",
    "#359EEE",
  ],
  ["02", "Complete identity assurance", "Meet the assurance tier required by the panels you want to join.", "#03CEA4"],
  [
    "03",
    "Provide applicable tax details",
    "Complete DAC7 or other required fields before any paid voucher is issued.",
    "#FFC43D",
  ],
  ["04", "Complete sanctions screening", "Confirm eligibility before work can create a payment obligation.", "#EF476F"],
  [
    "05",
    "Choose your payout destination",
    "Use a self-custodial Base Account for USDC payouts and recovery.",
    "#359EEE",
  ],
] as const;

export default function PaidTaskUnlockPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <div className="max-w-3xl border-l-2 border-[var(--rateloop-yellow)] pl-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Account</p>
        <h1 className="display-section mt-3 text-4xl sm:text-5xl">Unlock paid tasks</h1>
        <p className="mt-4 text-lg leading-8 text-base-content/60">
          Browse and calibrate without friction. Complete this once before your first paid voucher so there are no
          surprises after you earn.
        </p>
      </div>

      <div className="mt-10 grid gap-4">
        {requirements.map(([number, title, body, color]) => (
          <article
            key={title}
            className="rateloop-surface-card grid gap-4 p-5 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:items-center sm:p-6"
          >
            <span className="font-mono text-sm" style={{ color }}>
              {number}
            </span>
            <div>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm leading-6 text-base-content/55">{body}</p>
            </div>
            <span className="w-fit rounded-md border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-base-content/50">
              Not started
            </span>
          </article>
        ))}
      </div>

      <div className="mt-8 border-l-2 border-[var(--rateloop-green)] bg-emerald-300/[0.07] px-5 py-4 text-sm leading-6 text-base-content/70">
        Your eligibility record is separate from public panel activity. A normal on-chain claim can still link its
        one-time vote key to the payout destination you select.
      </div>
    </div>
  );
}
