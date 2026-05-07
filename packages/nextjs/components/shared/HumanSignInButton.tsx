"use client";

import { type ButtonHTMLAttributes, type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useCuryoConnectModal } from "~~/hooks/useCuryoConnectModal";
import { HUMAN_SIGN_IN_LABEL, getHumanSignInRoute } from "~~/lib/home/humanSignInRoute";

type HumanSignInButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "type"> & {
  children?: ReactNode;
};

export function HumanSignInButton({ children, className, disabled, ...props }: HumanSignInButtonProps) {
  const router = useRouter();
  const { address } = useAccount();
  const { openConnectModal, isConnecting, thirdwebEnabled } = useCuryoConnectModal();
  const [shouldRouteAfterSignIn, setShouldRouteAfterSignIn] = useState(false);

  const routeSignedInRater = useCallback(() => {
    if (!address) {
      return false;
    }

    setShouldRouteAfterSignIn(false);
    router.push(getHumanSignInRoute());
    return true;
  }, [address, router]);

  useEffect(() => {
    if (!shouldRouteAfterSignIn) {
      return;
    }

    routeSignedInRater();
  }, [routeSignedInRater, shouldRouteAfterSignIn]);

  const handleClick = useCallback(async () => {
    if (routeSignedInRater()) {
      return;
    }

    setShouldRouteAfterSignIn(true);
    const wallet = await openConnectModal();
    if (!wallet) {
      setShouldRouteAfterSignIn(false);
    }
  }, [openConnectModal, routeSignedInRater]);

  return (
    <button
      {...props}
      type="button"
      className={className}
      disabled={disabled || (!address && !thirdwebEnabled) || isConnecting || shouldRouteAfterSignIn}
      aria-busy={isConnecting || shouldRouteAfterSignIn || undefined}
      onClick={() => {
        void handleClick();
      }}
    >
      {children ?? HUMAN_SIGN_IN_LABEL}
    </button>
  );
}
