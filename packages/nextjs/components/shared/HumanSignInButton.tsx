"use client";

import { type ButtonHTMLAttributes, type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import {
  GradientActionButton,
  type GradientActionMotion,
  type GradientActionSize,
} from "~~/components/shared/GradientAction";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useRateLoopConnectModal } from "~~/hooks/useRateLoopConnectModal";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { HUMAN_SIGN_IN_LABEL, getHumanSignInRoute } from "~~/lib/home/humanSignInRoute";

type HumanSignInButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "type"> & {
  children?: ReactNode;
  gradientMotion?: GradientActionMotion | false;
  gradientPill?: boolean;
  gradientSize?: GradientActionSize;
  postSignInRoute?: string;
};

export function HumanSignInButton({
  children,
  className,
  disabled,
  gradientMotion = false,
  gradientPill = false,
  gradientSize = "default",
  postSignInRoute,
  ...props
}: HumanSignInButtonProps) {
  const router = useRouter();
  const { address } = useAccount();
  const { openConnectModal, isConnecting } = useRateLoopConnectModal();
  const [shouldRouteAfterSignIn, setShouldRouteAfterSignIn] = useState(false);
  const { data: lrepBalance } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address && !postSignInRoute },
  });
  const resolvedLrepBalance = typeof lrepBalance === "bigint" ? lrepBalance : undefined;

  const routeSignedInRater = useCallback(() => {
    if (!address) {
      return false;
    }

    if (postSignInRoute) {
      setShouldRouteAfterSignIn(false);
      router.push(postSignInRoute);
      return true;
    }

    if (resolvedLrepBalance === undefined) {
      setShouldRouteAfterSignIn(true);
      return true;
    }

    setShouldRouteAfterSignIn(false);
    router.push(getHumanSignInRoute({ lrepBalance: resolvedLrepBalance }));
    return true;
  }, [address, postSignInRoute, resolvedLrepBalance, router]);

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
