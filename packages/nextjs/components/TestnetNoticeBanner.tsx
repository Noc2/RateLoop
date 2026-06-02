"use client";

import { useCallback, useEffect, useState } from "react";
import { ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/24/outline";

const TESTNET_NOTICE_DISMISSED_STORAGE_KEY = "rateloop:testnet-notice-dismissed";

// MAINNET-1 (2026-05-21 testnet-readiness audit): the banner copy says "deployed on World
// Chain Sepolia testnet only", which contradicts reality once mainnet (chainId 480) ships.
// Gate the banner so it never renders on the mainnet target. Local dev (31337) and testnet
// (4801) keep showing the notice.
const NON_MAINNET_TARGET_CHAIN_IDS = new Set<number>([31337, 4801]);

export function TestnetNoticeBanner({ targetChainId }: { targetChainId: number }) {
  const isMainnetTarget = !NON_MAINNET_TARGET_CHAIN_IDS.has(targetChainId);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    try {
      setIsVisible(window.localStorage.getItem(TESTNET_NOTICE_DISMISSED_STORAGE_KEY) !== "true");
    } catch {
      setIsVisible(true);
    }
  }, []);

  const dismissNotice = useCallback(() => {
    setIsVisible(false);

    try {
      window.localStorage.setItem(TESTNET_NOTICE_DISMISSED_STORAGE_KEY, "true");
    } catch {
      // Dismiss for this page view even when browser storage is unavailable.
    }
  }, []);

  if (isMainnetTarget || !isVisible) {
    return null;
  }

  return (
    <div className="border-b border-white/10 bg-black px-4 py-2.5 text-base-content shadow-[0_12px_32px_rgba(0,0,0,0.22)] sm:px-6">
      <div className="mx-auto flex max-w-6xl items-start gap-3 xl:max-w-none">
        <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-500" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-base-content">
          RateLoop smart contracts are deployed on World Chain Sepolia testnet only. RateLoop is not live yet and under
          active development. Feel free to contribute:{" "}
          <a
            href="https://github.com/Noc2/RateLoop"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-base-content underline decoration-base-content/40 underline-offset-4 transition-colors hover:text-white hover:decoration-white"
          >
            Noc2/RateLoop
          </a>
        </p>
        <button
          type="button"
          onClick={dismissNotice}
          className="btn btn-ghost btn-xs h-7 min-h-0 w-7 shrink-0 rounded-full p-0 text-base-content/75 hover:bg-base-content/10 hover:text-base-content"
          aria-label="Dismiss testnet notice"
        >
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
