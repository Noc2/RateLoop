import Link from "next/link";
import { RateLoopLogo } from "~~/components/RateLoopLogo";
import OrbAnimation from "~~/components/home/OrbAnimation";

export default function ComingSoonPage() {
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-black text-base-content">
      <header className="relative z-20 px-6 py-6 sm:px-10 sm:py-8 lg:px-14">
        <div className="mx-auto flex w-full max-w-[92rem] items-center">
          <Link
            href="/"
            aria-label="RateLoop home"
            className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-base-content"
          >
            <RateLoopLogo className="h-10 w-10 shrink-0 sm:h-12 sm:w-12" idPrefix="coming-soon-brand" />
            <span className="font-display text-2xl leading-none sm:text-[2rem]">RateLoop</span>
          </Link>
        </div>
      </header>

      <main id="main-content" className="relative z-10 flex flex-1 items-center px-6 py-8 sm:px-10 lg:px-14 lg:py-0">
        <section className="relative mx-auto flex w-full max-w-[92rem] flex-col items-center lg:block">
          <div className="relative z-10 flex w-full flex-col items-center text-center lg:w-[56%] lg:items-start lg:text-left">
            <p className="mb-6 font-mono text-xs font-semibold uppercase tracking-[0.28em] text-base-content/65 sm:text-sm">
              Coming Soon
            </p>

            <h1 className="hero-headline text-[2.7rem] leading-[0.94] text-base-content min-[375px]:text-[3.2rem] sm:text-[4.8rem] lg:text-[clamp(4.5rem,11vh,6.8rem)]">
              <span className="block">The Next Loop</span>{" "}
              <span className="block w-fit">
                <span className="rateloop-text-gradient inline-block">Begins</span>{" "}
                <span className="rateloop-text-gradient inline-block">Soon.</span>
              </span>
            </h1>

            <p className="mt-7 max-w-[38rem] text-[1.05rem] leading-8 text-base-content/65 sm:text-xl sm:leading-9">
              Thank you to everyone who contributed, tested early ideas, and shared thoughtful feedback.
            </p>

            <a href="https://x.com/RateLoop" className="rateloop-gradient-action group mt-8 text-base" data-size="lg">
              <span className="rateloop-gradient-action-inner gap-3">
                <span>Follow on X</span>
                <span
                  aria-hidden="true"
                  className="text-lg leading-none transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </span>
            </a>
          </div>

          <div
            aria-hidden="true"
            data-testid="coming-soon-orb"
            className="relative z-0 -mx-[28vw] -mb-[24vw] mt-2 w-[156vw] sm:-mx-[18vw] sm:-mb-[18vw] sm:w-[118vw] lg:absolute lg:-right-[clamp(7.75rem,11vw,14rem)] lg:top-1/2 lg:m-0 lg:w-[clamp(40rem,62vw,70rem)] lg:-translate-y-1/2"
          >
            <OrbAnimation />
          </div>
        </section>
      </main>
    </div>
  );
}
