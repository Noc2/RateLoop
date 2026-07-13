import Link from "next/link";

const useCases = ["Support", "Consulting", "Marketing", "Product", "Copilots"] as const;

export function HumanAssuranceUseCasesStrip() {
  return (
    <section className="relative z-20 mt-10 w-full sm:mt-12 lg:mt-32 xl:mt-40">
      <p className="mb-5 text-center text-base leading-7 text-base-content/70 sm:text-lg">
        Add a human check before AI reaches your customers.
      </p>
      <div className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-2 px-4 pb-1 sm:gap-2.5 sm:px-0 lg:gap-3">
        {useCases.map(useCase => (
          <Link
            key={useCase}
            href="/ask"
            className="flex shrink-0 items-center gap-2 rounded-lg border border-base-content/10 bg-base-content/[0.055] px-3 py-2.5 text-base-content/76 transition-colors hover:border-base-content/25 hover:bg-base-content/[0.08] hover:text-base-content sm:px-3.5 lg:px-4"
          >
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px] font-bold"
            >
              {useCase.slice(0, 1)}
            </span>
            <span className="whitespace-nowrap text-sm font-semibold sm:text-base">{useCase}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
