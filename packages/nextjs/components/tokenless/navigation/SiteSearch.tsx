"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  workspacePublicContentHref,
  workspaceReturnPathForLocation,
} from "~~/components/tokenless/navigation/workspaceReturnPath";

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

function searchTarget(value: string, returnPath: string | null) {
  const query = value.trim();
  const destination = query ? `${SEARCH_ROUTE}?q=${encodeURIComponent(query)}` : SEARCH_ROUTE;
  return returnPath ? workspacePublicContentHref(destination, returnPath) : destination;
}

export function SiteSearch({ mobile = false }: { mobile?: boolean }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const returnPath = workspaceReturnPathForLocation(pathname, searchParams);
  const activeQuery = pathname === SEARCH_ROUTE ? (searchParams.get("q") ?? "") : "";
  const [query, setQuery] = useState(activeQuery);

  useEffect(() => {
    setQuery(activeQuery);
  }, [activeQuery]);

  function commitSearch(value: string) {
    const target = searchTarget(value, returnPath);
    if (pathname === SEARCH_ROUTE) router.replace(target, { scroll: false });
    else router.push(target);
  }

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
          className="input input-sm h-9 w-full rounded-lg border-0 bg-base-content/[0.12] pl-3 pr-16 text-base text-base-content !shadow-none placeholder:text-base-content/60 focus:bg-base-content/[0.15] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rateloop-blue)] [&::-webkit-search-cancel-button]:appearance-none"
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
            className="absolute right-9 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-base-content/10 text-base-content/65 transition-colors hover:bg-base-content/20 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rateloop-blue)]"
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        ) : null}
        <button
          type="submit"
          aria-label="Search"
          className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-base-content/65 transition-colors hover:bg-base-content/15 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rateloop-blue)]"
        >
          <MagnifyingGlassIcon className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
