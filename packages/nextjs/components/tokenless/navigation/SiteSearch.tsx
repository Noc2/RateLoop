"use client";

import { FormEvent, startTransition, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_ROUTE = "/search";

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

function searchTarget(value: string) {
  const query = value.trim();
  return query ? `${SEARCH_ROUTE}?q=${encodeURIComponent(query)}` : SEARCH_ROUTE;
}

export function SiteSearch({ mobile = false }: { mobile?: boolean }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const activeQuery = pathname === SEARCH_ROUTE ? (searchParams.get("q") ?? "") : "";
  const [query, setQuery] = useState(activeQuery);

  useEffect(() => {
    setQuery(activeQuery);
  }, [activeQuery]);

  const commitSearch = useCallback(
    (value: string) => {
      const target = searchTarget(value);
      startTransition(() => {
        if (pathname === SEARCH_ROUTE) router.replace(target, { scroll: false });
        else router.push(target);
      });
    },
    [pathname, router],
  );

  useEffect(() => {
    if (query === activeQuery) return;
    const timeout = window.setTimeout(() => commitSearch(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [activeQuery, commitSearch, query]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    commitSearch(query);
  }

  function clear() {
    setQuery("");
    if (pathname === SEARCH_ROUTE) commitSearch("");
  }

  return (
    <form onSubmit={submit} className={mobile ? "w-[min(10rem,38vw)] sm:w-52" : "mx-2.5 mb-4"} role="search">
      <label className="sr-only" htmlFor={mobile ? "mobile-site-search" : "desktop-site-search"}>
        Search RateLoop
      </label>
      <div className="relative">
        {mobile ? (
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/60" />
        ) : null}
        <input
          id={mobile ? "mobile-site-search" : "desktop-site-search"}
          name={mobile ? "site-search-mobile" : "site-search"}
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault();
              clear();
            }
          }}
          className={`input input-sm h-9 w-full rounded-lg border-0 bg-base-content/[0.12] text-base text-base-content !shadow-none placeholder:text-base-content/60 focus:bg-base-content/[0.15] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rateloop-blue)] [&::-webkit-search-cancel-button]:appearance-none ${
            mobile ? "pl-8 pr-8" : "px-4 text-center"
          }`}
          placeholder="Search"
          aria-label="Search RateLoop"
          autoComplete="off"
          maxLength={120}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear site search"
            onClick={clear}
            className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-base-content/10 text-base-content/65 transition-colors hover:bg-base-content/20 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rateloop-blue)]"
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </form>
  );
}
