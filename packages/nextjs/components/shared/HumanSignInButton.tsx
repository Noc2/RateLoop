"use client";

import { type ButtonHTMLAttributes, type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveWalletChain } from "thirdweb/react";
import { useAccount } from "wagmi";
import {
  GradientActionButton,
  type GradientActionMotion,
  type GradientActionSize,
} from "~~/components/shared/GradientAction";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useRateLoopConnectModal } from "~~/hooks/useRateLoopConnectModal";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { HUMAN_SIGN_IN_LABEL, getHumanSignInRoute } from "~~/lib/home/humanSignInRoute";

type HumanSignInButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "type"> & {
  children?: ReactNode;
  gradientInnerClassName?: string;
  gradientMotion?: GradientActionMotion | false;
  gradientPill?: boolean;
  gradientSize?: GradientActionSize;
  postSignInRoute?: string;
};

export function hasCompleteHumanSignInSession(params: {
  address?: string | null;
  chainId?: number | null;
  targetChainId: number;
}): boolean {
  return Boolean(params.address && params.chainId === params.targetChainId);
}

export function getHumanPostSignInRoute({
  lrepBalance,
  postSignInRoute,
}: {
  lrepBalance: bigint;
  postSignInRoute?: string | null;
}) {
  if (lrepBalance === 0n) {
    return getHumanSignInRoute({ lrepBalance });
  }

  return postSignInRoute ?? getHumanSignInRoute({ lrepBalance });
}

export function HumanSignInButton({
  children,
  className,
  disabled,
  gradientInnerClassName,
  gradientMotion = false,
  gradientPill = false,
  gradientSize = "default",
  postSignInRoute,
  ...props
}: HumanSignInButtonProps) {
  const router = useRouter();
  const { address, chain } = useAccount();
  const activeThirdwebChain = useActiveWalletChain();
  const resolvedChainId = chain?.id ?? activeThirdwebChain?.id;
  const { targetNetwork } = useTargetNetwork();
  const { openConnectModal, isConnecting } = useRateLoopConnectModal();
  const [shouldRouteAfterSignIn, setShouldRouteAfterSignIn] = useState(false);
  const { data: lrepBalance } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });
  const resolvedLrepBalance = typeof lrepBalance === "bigint" ? lrepBalance : undefined;

  const routeSignedInRater = useCallback(() => {
    if (!hasCompleteHumanSignInSession({ address, chainId: resolvedChainId, targetChainId: targetNetwork.id })) {
      return false;
    }

    if (resolvedLrepBalance === undefined) {
      setShouldRouteAfterSignIn(true);
      return true;
    }

    setShouldRouteAfterSignIn(false);
    router.push(getHumanPostSignInRoute({ lrepBalance: resolvedLrepBalance, postSignInRoute }));
    return true;
  }, [address, postSignInRoute, resolvedChainId, resolvedLrepBalance, router, targetNetwork.id]);

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

  const isBusy = isConnecting || shouldRouteAfterSignIn;
  const isDisabled = disabled || isBusy;
  const buttonContent = children ?? HUMAN_SIGN_IN_LABEL;
  const onClick = () => {
    void handleClick();
  };

  if (gradientMotion) {
    return (
      <GradientActionButton
        {...props}
        className={className}
        disabled={isDisabled}
        innerClassName={gradientInnerClassName}
        motion={isBusy ? "processing" : gradientMotion}
        pill={gradientPill}
        size={gradientSize}
        onClick={onClick}
      >
        {buttonContent}
      </GradientActionButton>
    );
  }

  return (
    <button
      {...props}
      type="button"
      className={className}
      disabled={isDisabled}
      aria-busy={isBusy || undefined}
      onClick={onClick}
    >
      {buttonContent}
    </button>
  );
}
