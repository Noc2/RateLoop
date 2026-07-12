export function PromoVideo() {
  return (
    <div className="relative mb-14 flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-base-content/10 bg-[radial-gradient(circle_at_50%_45%,rgba(3,206,164,0.09),transparent_34%),radial-gradient(circle_at_70%_58%,rgba(53,158,238,0.08),transparent_28%),#050505] shadow-[0_24px_60px_rgb(0_0_0/0.35)]">
      <div className="w-full max-w-3xl px-6 text-center sm:px-10">
        <p className="text-xl font-semibold text-base-content/75 sm:text-3xl">
          Your agent can build anything. <span className="rateloop-text-gradient">Should it?</span>
        </p>
        <div className="mx-auto mt-8 max-w-xl rounded-lg border border-base-content/10 bg-black/70 p-4 text-left shadow-2xl sm:p-5">
          <div className="mb-4 flex items-center justify-between text-[10px] font-mono text-base-content/35 sm:text-xs">
            <span>Your Agent</span>
            <span>panel session</span>
          </div>
          <div className="ml-auto max-w-[88%] rounded-md border border-[#359EEE]/20 bg-[#359EEE]/10 px-4 py-3 text-xs leading-5 text-base-content/75 sm:text-sm sm:leading-6">
            I have an idea for an AI meeting-notes app. Run a paid human panel before I build more.
          </div>
        </div>
      </div>
      <div className="absolute bottom-4 left-5 h-0.5 w-24 bg-gradient-to-r from-[var(--rateloop-blue)] via-[var(--rateloop-green)] to-transparent" />
      <p className="absolute bottom-4 left-5 mt-3 translate-y-5 text-[10px] font-semibold text-base-content/55 sm:text-xs">
        One focused question. Sealed human judgment. USDC settlement.
      </p>
    </div>
  );
}
