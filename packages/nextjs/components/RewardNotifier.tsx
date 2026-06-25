"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useAllClaimableRewards } from "~~/hooks/useAllClaimableRewards";
import {
  formatClaimableLrepNotificationAmount,
  readLastClaimRewardNotificationAt,
  shouldNotifyAboutClaimableRewards,
  writeLastClaimRewardNotificationAt,
} from "~~/lib/notifications/claimRewards";
import { formatUsdAmount } from "~~/lib/questionRewardPools";
import { notification } from "~~/utils/scaffold-eth";

const CLAIMABLE_LREP_TOTAL_STORAGE_PREFIX = "rateloop_last_notified_claimable_lrep_total";
const CLAIMABLE_USDC_TOTAL_STORAGE_PREFIX = "rateloop_last_notified_claimable_usdc_total";
const MIN_VISIBLE_USDC_AMOUNT = 5_000n;

function getClaimableLrepTotalStorageKey(address: string) {
  return `${CLAIMABLE_LREP_TOTAL_STORAGE_PREFIX}:${address.toLowerCase()}`;
}

function getClaimableUsdcTotalStorageKey(address: string) {
  return `${CLAIMABLE_USDC_TOTAL_STORAGE_PREFIX}:${address.toLowerCase()}`;
}

/**
 * Headless component that fires a toast when new claimable LREP or USDC appears.
 * Uses storage to avoid repeat toasts on page refresh and a cooldown to avoid spam.
 */
export function RewardNotifier() {
  const { address } = useAccount();
  const { totalClaimable, totalUsdcClaimable } = useAllClaimableRewards();
  const prevLrepRef = useRef<bigint | null>(null);
  const prevUsdcRef = useRef<bigint | null>(null);
  const initialLoadRef = useRef(true);

  useEffect(() => {
    initialLoadRef.current = true;
    prevLrepRef.current = null;
    prevUsdcRef.current = null;
  }, [address]);

  useEffect(() => {
    if (!address || totalClaimable === undefined || totalUsdcClaimable === undefined) return;
    if (typeof window === "undefined") return;

    const lrepStorageKey = getClaimableLrepTotalStorageKey(address);
    const usdcStorageKey = getClaimableUsdcTotalStorageKey(address);

    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      const storedLrep = window.sessionStorage.getItem(lrepStorageKey);
      const storedUsdc = window.sessionStorage.getItem(usdcStorageKey);
      prevLrepRef.current = storedLrep ? BigInt(storedLrep) : totalClaimable;
      prevUsdcRef.current = storedUsdc ? BigInt(storedUsdc) : totalUsdcClaimable;
      window.sessionStorage.setItem(lrepStorageKey, totalClaimable.toString());
      window.sessionStorage.setItem(usdcStorageKey, totalUsdcClaimable.toString());
      return;
    }

    const prevLrep = prevLrepRef.current ?? 0n;
    const prevUsdc = prevUsdcRef.current ?? 0n;
    const nowMs = Date.now();
    const lastNotifiedAtMs = readLastClaimRewardNotificationAt(address, window.localStorage);
    const lrepIncreased = shouldNotifyAboutClaimableRewards({
      nowMs,
      previousTotal: prevLrep,
      nextTotal: totalClaimable,
      lastNotifiedAtMs,
    });
    const usdcIncreased =
      totalUsdcClaimable >= MIN_VISIBLE_USDC_AMOUNT &&
      shouldNotifyAboutClaimableRewards({
        nowMs,
        previousTotal: prevUsdc,
        nextTotal: totalUsdcClaimable,
        lastNotifiedAtMs,
      });

    if (lrepIncreased || usdcIncreased) {
      const parts: string[] = [];
      const formattedLrep = formatClaimableLrepNotificationAmount(totalClaimable);
      if (lrepIncreased && formattedLrep) {
        parts.push(`${formattedLrep} LREP`);
      }
      if (usdcIncreased) {
        parts.push(formatUsdAmount(totalUsdcClaimable));
      }

      if (parts.length > 0) {
        notification.success(
          <Link href="/governance" className="font-medium underline">
            {`You have ${parts.join(" + ")} ready to claim.`}
          </Link>,
          { duration: 8000 },
        );
        writeLastClaimRewardNotificationAt(address, nowMs, window.localStorage);
      }
    }

    prevLrepRef.current = totalClaimable;
    prevUsdcRef.current = totalUsdcClaimable;
    window.sessionStorage.setItem(lrepStorageKey, totalClaimable.toString());
    window.sessionStorage.setItem(usdcStorageKey, totalUsdcClaimable.toString());
  }, [address, totalClaimable, totalUsdcClaimable]);

  return null;
}
