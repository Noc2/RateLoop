"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function AnswerSearch({ mobile = false }: { mobile?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  function navigate(value = query) {
    const next = value.trim();
    router.push(`/rate?q=${encodeURIComponent(next)}&scope=all`);
    if (mobile) setExpanded(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate();
  }

  function clear() {
    setQuery("");
    if (pathname === "/rate") navigate("");
  }

  if (mobile && !expanded) {
    return (
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-base-content/75 hover:bg-base-content/[0.04]"
        onClick={() => setExpanded(true)}
      >
        <svg
          className="h-6 w-6 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <circle cx="10.8" cy="10.8" r="6.3" />
          <path d="m16 16 4.2 4.2" />
        </svg>
        <span className="text-base font-medium">Search</span>
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className={mobile ? "mb-3 border-b border-white/10 px-2 pb-3" : "mx-2.5 mb-4"}
      role="search"
    >
      <label className="sr-only" htmlFor={mobile ? "mobile-answer-search" : "desktop-answer-search"}>
        Search answers
      </label>
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/45"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="10.8" cy="10.8" r="6.3" />
          <path d="m16 16 4.2 4.2" />
        </svg>
        <input
          id={mobile ? "mobile-answer-search" : "desktop-answer-search"}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault();
              clear();
              if (mobile) setExpanded(false);
            }
          }}
          className="h-9 w-full rounded-md border border-base-content/10 bg-base-content/[0.09] pl-9 pr-9 text-sm text-base-content outline-none placeholder:text-base-content/45 focus:border-[var(--rateloop-blue)]"
          placeholder="Search"
          autoFocus={mobile}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear answer search"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-base-content/45 hover:text-base-content"
          >
            ×
          </button>
        ) : null}
      </div>
    </form>
  );
}
