"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import {
  PROTOCOL_BETA_GOVERNANCE_HREF,
  PROTOCOL_IS_BETA,
  PROTOCOL_RELEASE_CANDIDATE_LABEL,
} from "~~/constants/protocolRelease";

const BETA_NOTICE_DISMISSED_STORAGE_KEY = "rateloop:beta-notice-dismissed";

export function BetaNoticeBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    try {
      setIsVisible(window.localStorage.getItem(BETA_NOTICE_DISMISSED_STORAGE_KEY) !== "true");
    } catch {
      setIsVisible(true);
    }
  }, []);

  const dismissNotice = () => {
    setIsVisible(false);

    try {
      window.localStorage.setItem(BETA_NOTICE_DISMISSED_STORAGE_KEY, "true");
    } catch {
      // Dismiss for this page view even when browser storage is unavailable.
    }
  };

  if (!PROTOCOL_IS_BETA || !isVisible) {
    return null;
  }

  return (
    <div className="border-b border-white/10 bg-black px-4 py-2.5 text-base-content shadow-[0_12px_32px_rgba(0,0,0,0.22)] sm:px-6">
      <div className="mx-auto flex max-w-6xl items-start gap-3 xl:max-w-none">
        <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-500" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-base-content">
          RateLoop is currently in beta. This is {PROTOCOL_RELEASE_CANDIDATE_LABEL}; the Base mainnet contract stack is
          live production infrastructure while off-chain services and governance parameters continue to mature.{" "}
          <Link
            href={PROTOCOL_BETA_GOVERNANCE_HREF}
            className="font-semibold text-base-content underline decoration-base-content/40 underline-offset-4 transition-colors hover:text-white hover:decoration-white"
          >
            Read the governance plan
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={dismissNotice}
          className="btn btn-ghost btn-xs h-7 min-h-0 w-7 shrink-0 rounded-full p-0 text-base-content/75 hover:bg-base-content/10 hover:text-base-content"
          aria-label="Dismiss beta notice"
        >
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
