import type { ReactNode } from "react";
import Link from "next/link";
import { AppPageShell } from "~~/components/shared/AppPageShell";

const destinations = [
  { href: "/search", label: "Search" },
  { href: "/human/review", label: "Review work" },
  { href: "/agents/overview", label: "Manage agents" },
  { href: "/docs", label: "Read docs" },
] as const;

export function RootRecoverySurface({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <AppPageShell outerClassName="justify-center py-10 sm:py-16">
      <section
        className="surface-card mx-auto w-full max-w-2xl rounded-2xl p-6 sm:p-9"
        aria-labelledby="root-recovery-heading"
      >
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--rateloop-pink)]">{eyebrow}</p>
        <h1 id="root-recovery-heading" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-base-content/65">{description}</p>

        {actions ? <div className="mt-6 flex flex-wrap gap-3">{actions}</div> : null}

        <nav className="mt-8 border-t border-white/10 pt-6" aria-label="Useful destinations">
          <ul className="grid gap-2 sm:grid-cols-2">
            {destinations.map(destination => (
              <li key={destination.href}>
                <Link
                  href={destination.href}
                  className="block rounded-lg border border-white/10 px-4 py-3 font-medium text-base-content/75 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-base-content"
                >
                  {destination.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>
    </AppPageShell>
  );
}
