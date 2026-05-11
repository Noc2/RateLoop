import { normalizeReferralAddress } from "./referralAttribution";
import { getAddress, zeroAddress } from "viem";

export type LaunchReferralInputState =
  | {
      status: "empty";
      normalizedReferrer: null;
      message: null;
      canUseReferrer: false;
    }
  | {
      status: "valid";
      normalizedReferrer: `0x${string}`;
      message: null;
      canUseReferrer: true;
    }
  | {
      status: "invalid";
      normalizedReferrer: null;
      message: string;
      canUseReferrer: false;
    }
  | {
      status: "self";
      normalizedReferrer: null;
      message: string;
      canUseReferrer: false;
    };

export function normalizeLaunchReferralAddress(value: string | null | undefined): `0x${string}` | null {
  const normalized = normalizeReferralAddress(value);
  if (!normalized || normalized === zeroAddress) {
    return null;
  }

  return getAddress(normalized) as `0x${string}`;
}

export function isSameAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeReferralAddress(left);
  const normalizedRight = normalizeReferralAddress(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return getAddress(normalizedLeft) === getAddress(normalizedRight);
}

export function getLaunchReferralInputState(options: {
  connectedAddress?: string | null;
  inputValue: string;
}): LaunchReferralInputState {
  const trimmedValue = options.inputValue.trim();
  if (!trimmedValue) {
    return {
      status: "empty",
      normalizedReferrer: null,
      message: null,
      canUseReferrer: false,
    };
  }

  const normalizedReferrer = normalizeLaunchReferralAddress(trimmedValue);
  if (!normalizedReferrer) {
    return {
      status: "invalid",
      normalizedReferrer: null,
      message: "Enter a valid referral address.",
      canUseReferrer: false,
    };
  }

  if (isSameAddress(normalizedReferrer, options.connectedAddress)) {
    return {
      status: "self",
      normalizedReferrer: null,
      message: "You cannot refer yourself.",
      canUseReferrer: false,
    };
  }

  return {
    status: "valid",
    normalizedReferrer,
    message: null,
    canUseReferrer: true,
  };
}

export function resolveLaunchClaimReferrer(options: {
  connectedAddress?: string | null;
  inputValue: string;
}): `0x${string}` {
  const state = getLaunchReferralInputState(options);
  return state.canUseReferrer ? state.normalizedReferrer : zeroAddress;
}
