"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function MagnifyingGlassIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m16 16 4.2 4.2" />
    </svg>
  );
}

function XMarkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

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
        <MagnifyingGlassIcon className="h-6 w-6 shrink-0" />
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
        {mobile ? (
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/60" />
        ) : null}
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
          className={`input input-sm h-9 w-full rounded-lg border-0 bg-base-content/[0.12] text-base text-base-content outline-none placeholder:text-base-content/60 focus:bg-base-content/[0.15] focus:outline-none focus:ring-0 ${
            mobile ? "pl-8 pr-8" : "px-4 text-center"
          }`}
          placeholder="Search"
          autoFocus={mobile}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear answer search"
            onClick={clear}
            className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-base-content/10 text-base-content/65 transition-colors hover:bg-base-content/20 hover:text-base-content"
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </form>
  );
}
