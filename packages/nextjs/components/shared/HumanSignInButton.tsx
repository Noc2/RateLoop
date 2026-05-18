"use client";

import { type ButtonHTMLAttributes, type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useCuryoConnectModal } from "~~/hooks/useCuryoConnectModal";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { HUMAN_SIGN_IN_LABEL, getHumanSignInRoute } from "~~/lib/home/humanSignInRoute";

type HumanSignInButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "type"> & {
  children?: ReactNode;
};

export function HumanSignInButton({ children, className, disabled, ...props }: HumanSignInButtonProps) {
  const router = useRouter();
  const { address } = useAccount();
  const { openConnectModal, isConnecting } = useCuryoConnectModal();
  const [shouldRouteAfterSignIn, setShouldRouteAfterSignIn] = useState(false);
  const { data: lrepBalance } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });
  const resolvedLrepBalance = typeof lrepBalance === "bigint" ? lrepBalance : undefined;

  const routeSignedInRater = useCallback(() => {
    if (!address) {
      return false;
    }

    if (resolvedLrepBalance === undefined) {
      setShouldRouteAfterSignIn(true);
      return true;
    }

    setShouldRouteAfterSignIn(false);
    router.push(getHumanSignInRoute({ lrepBalance: resolvedLrepBalance }));
    return true;
  }, [address, resolvedLrepBalance, router]);

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
      disabled={disabled || isConnecting || shouldRouteAfterSignIn}
      aria-busy={isConnecting || shouldRouteAfterSignIn || undefined}
      onClick={() => {
        void handleClick();
      }}
    >
      {children ?? HUMAN_SIGN_IN_LABEL}
    </button>
  );
}
