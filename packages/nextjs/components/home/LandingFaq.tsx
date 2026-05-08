import Link from "next/link";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { landingFaqItems } from "~~/lib/docs/landingFaq";

export function LandingFaq() {
  return (
    <section className="relative z-10 w-full">
      <div className="mx-auto w-full">
        <div className="mb-12 sm:mb-16">
          <span className="mb-6 block font-mono text-sm tracking-widest text-base-content/40">03</span>
          <h2 className="display-section text-[2.85rem] text-base-content sm:text-[4.3rem] lg:text-[5.4rem]">
            Common <span className="ratemesh-text-gradient">Questions</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-x-12 gap-y-4 xl:grid-cols-2">
          {landingFaqItems.map(item => (
            <details
              key={item.question}
              className="group border-l border-base-content/20 py-2 pl-5 transition-colors duration-200 hover:border-base-content/35 open:border-base-content/50"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 text-left marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="text-lg font-semibold text-base-content sm:text-xl">{item.question}</span>
                <ChevronDownIcon className="h-5 w-5 shrink-0 text-base-content/50 transition-transform duration-200 group-open:rotate-180 group-open:text-base-content" />
              </summary>

              <div className="pb-5 pr-4 text-base leading-7 text-base-content/60 sm:text-[1.05rem]">
                <p>{item.answer}</p>
                {item.learnMoreHref ? (
                  <Link
                    href={item.learnMoreHref}
                    className="mt-3 inline-flex text-sm font-medium text-base-content transition-opacity hover:opacity-70"
                  >
                    Learn More: {item.learnMoreLabel}
                  </Link>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
