import Link from "next/link";
import { getFreeTransactionAllowanceDisplayState } from "./freeTransactionAllowanceDisplay";
import { useActiveWalletChain } from "thirdweb/react";
import { getAddress } from "viem";
import { Address } from "viem";
import { hardhat } from "viem/chains";
import { useAccount } from "wagmi";
import { ArrowLeftOnRectangleIcon, CheckIcon, ClipboardDocumentIcon, Cog6ToothIcon } from "@heroicons/react/24/outline";
import { BlockieAvatar } from "~~/components/scaffold-eth";
import { FaucetTrigger } from "~~/components/scaffold-eth/Faucet";
import { ClaimRewardsButton } from "~~/components/shared/ClaimRewardsButton";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { useCopyToClipboard } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useFreeTransactionAllowance } from "~~/hooks/useFreeTransactionAllowance";
import { shouldShowFreeTransactionAllowance } from "~~/hooks/useGasBalanceStatus";
import { useRateLoopDisconnect } from "~~/hooks/useRateLoopDisconnect";
import { useVoterAccuracy } from "~~/hooks/useVoterAccuracy";
import { resolveWalletExecutionChainId, useWalletExecutionCapabilities } from "~~/hooks/useWalletExecutionCapabilities";
import { useWalletSummaryData } from "~~/hooks/useWalletSummaryData";
import { AVATAR_WIN_RATE_TOOLTIP } from "~~/lib/profile/winRateTooltip";
import { isENS } from "~~/utils/scaffold-eth/common";

type AddressInfoDropdownProps = {
  address: Address;
  displayName: string;
  ensAvatar?: string;
  /** When true, render wallet + menu items inline (e.g. in sidebar) instead of dropdown */
  inlineMenu?: boolean;
  /** When true, render only the menu items list (for mobile menu) */
  menuItemsOnly?: boolean;
  /** When true, render the connected wallet as a compact avatar-only header affordance */
  compact?: boolean;
};

const getMenuItemClass = (showText: boolean) =>
  showText
    ? "flex items-center justify-start gap-3 px-3 py-2.5 rounded-xl transition-colors text-base-content/60 hover:text-base-content hover:bg-base-200 w-full text-base font-medium"
    : "flex items-center justify-start gap-3 px-4 py-3 rounded-xl transition-colors text-base-content/60 hover:text-base-content hover:bg-base-200 w-full text-base font-medium";

function formatLrepAmount(value: bigint | null | undefined) {
  if (value == null) return "—";
  return (Number(value) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatUsdcAmount(value: bigint | null | undefined) {
  if (value == null) return "—";
  return (Number(value) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatWinRate(value: number) {
  const percent = Number((value * 100).toFixed(1));
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function formatWalletAddressLabel(address: string) {
  return `${address.slice(0, 6)}...`;
}

function WalletAddressCopyRow({ address, displayName }: { address: string; displayName: string }) {
  const { copyToClipboard, isCopiedToClipboard } = useCopyToClipboard();
  const addressLabel =
    isENS(displayName) && !displayName.toLowerCase().startsWith("0x") ? displayName : formatWalletAddressLabel(address);
  const copyTitle = isCopiedToClipboard ? "Address copied" : "Copy address";

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-sm font-medium leading-5 text-base-content/72" title={address}>
        {addressLabel}
      </span>
      <button
        type="button"
        onClick={() => void copyToClipboard(address)}
        className="btn btn-ghost btn-xs btn-square h-6 min-h-0 w-6 shrink-0 text-base-content/62 hover:text-base-content"
        aria-label="Copy address"
        title={copyTitle}
      >
        {isCopiedToClipboard ? (
          <CheckIcon className="h-3.5 w-3.5" />
        ) : (
          <ClipboardDocumentIcon className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

function FreeTransactionAllowanceText({ className }: { className?: string }) {
  const { chain, connector } = useAccount();
  const activeWalletChain = useActiveWalletChain();
  const { isResolved, limit, remaining, verified } = useFreeTransactionAllowance();
  const { isThirdwebInApp } = useWalletExecutionCapabilities();
  const chainId = resolveWalletExecutionChainId(chain?.id, activeWalletChain?.id);
  const canShowFreeTransactionAllowance = shouldShowFreeTransactionAllowance({
    chainId,
    connectorId: connector?.id,
    isThirdwebInApp,
  });

  const displayState = getFreeTransactionAllowanceDisplayState({
    canShowFreeTransactionAllowance,
    isResolved,
    limit,
    remaining,
    verified,
  });

  if (displayState.kind === "hidden") {
    return null;
  }

  if (displayState.kind === "verify") {
    return (
      <Link
        href="/settings#identity"
        className={`flex items-center gap-1.5 text-sm font-medium leading-5 text-base-content/62 hover:text-base-content ${
          className ?? ""
        }`}
      >
        <span>Verify for {displayState.limit}</span>
        <span className="text-base-content/60">free tx</span>
        <InfoTooltip text="Verify your identity to unlock sponsored RateLoop Wallet transactions." />
      </Link>
    );
  }

  return (
    <div className={`flex items-center gap-1.5 text-sm font-medium leading-5 text-base-content/62 ${className ?? ""}`}>
      <span className="tabular-nums">
        {displayState.remaining}/{displayState.limit}
      </span>
      <span className="text-base-content/60">free tx</span>
      <InfoTooltip
        text={`RateLoop Wallet gets ${displayState.limit} sponsored app transactions after ID verification.`}
      />
    </div>
  );
}

function WinRateSummaryText({ address, className }: { address: Address; className?: string }) {
  const { stats } = useVoterAccuracy(address);
  const winRateLabel = stats && stats.totalSettledVotes > 0 ? formatWinRate(stats.winRate) : "—";

  return (
    <div className={`flex items-center gap-1.5 text-sm font-medium leading-5 text-base-content/62 ${className ?? ""}`}>
      <span className="tabular-nums">{winRateLabel}</span>
      <span className="whitespace-nowrap text-base-content/60">win rate</span>
      <InfoTooltip text={AVATAR_WIN_RATE_TOOLTIP} position="bottom" />
    </div>
  );
}

function WalletSummaryDetails({
  address,
  balanceClassName,
  freeTxClassName,
  stakeClassName,
  winRateClassName,
}: {
  address: Address;
  balanceClassName: string;
  freeTxClassName: string;
  stakeClassName: string;
  winRateClassName: string;
}) {
  const { activeVotes, earliestReveal, hasPendingReveals, liquidBalance, summary, usdcBalance } =
    useWalletSummaryData(address);
  const totalStakedMicro = summary?.totalStakedMicro ?? 0n;
  const showStaked = totalStakedMicro > 0n || activeVotes.length > 0;
  const submissionStakedMicro = summary?.submissionStakedMicro ?? 0n;
  const frontendStakedMicro = summary?.frontendStakedMicro ?? 0n;
  const votingStakedMicro = summary?.votingStakedMicro ?? 0n;

  const stakeParts: string[] = [];
  if (submissionStakedMicro > 0n) {
    stakeParts.push(`${formatLrepAmount(submissionStakedMicro)} LREP submissions`);
  }
  if (votingStakedMicro > 0n) {
    let votingLabel = `${formatLrepAmount(votingStakedMicro)} LREP voting`;
    if (earliestReveal) {
      votingLabel += ` · reveals in ${earliestReveal}`;
    } else if (hasPendingReveals) {
      votingLabel += " · pending reveal";
    }
    stakeParts.push(votingLabel);
  }
  if (frontendStakedMicro > 0n) {
    stakeParts.push(`${formatLrepAmount(frontendStakedMicro)} LREP frontend`);
  }
  const stakeTooltip = stakeParts.join(" · ");

  return (
    <>
      <div className={balanceClassName}>
        <span className="tabular-nums">{formatLrepAmount(liquidBalance)}</span>{" "}
        <span className="text-base-content/52">LREP</span>
      </div>
      <div className={balanceClassName}>
        <span className="tabular-nums">{formatUsdcAmount(usdcBalance)}</span>{" "}
        <span className="text-base-content/52">USDC</span>
      </div>
      {showStaked ? (
        <div className={stakeClassName}>
          <span className="tabular-nums">{formatLrepAmount(totalStakedMicro)}</span>
          <span className="text-base-content/52">Staked</span>
          {stakeTooltip ? <InfoTooltip text={stakeTooltip} position="bottom" /> : null}
        </div>
      ) : null}
      <WinRateSummaryText address={address} className={winRateClassName} />
      <FreeTransactionAllowanceText className={freeTxClassName} />
    </>
  );
}

function MenuItems({
  disconnect,
  showText = false,
  showFaucet,
}: {
  disconnect: () => void;
  showText?: boolean;
  showFaucet?: boolean;
}) {
  const textClass = "inline";
  const menuItemClass = getMenuItemClass(showText);
  return (
    <>
      {showFaucet && (
        <li>
          <FaucetTrigger className={menuItemClass} textClassName={textClass} />
        </li>
      )}
      <li>
        <Link href="/settings" className={menuItemClass}>
          <Cog6ToothIcon className="w-6 h-6 shrink-0" />
          <span className={textClass}>Settings</span>
        </Link>
      </li>
      <li>
        <button
          className={`${menuItemClass} text-[#ff9f80] hover:text-[#ffc2ad]`}
          type="button"
          onClick={() => void disconnect()}
        >
          <ArrowLeftOnRectangleIcon className="w-6 h-6 shrink-0" />
          <span className={textClass}>Sign Out</span>
        </button>
      </li>
    </>
  );
}

export const AddressInfoDropdown = ({
  address,
  ensAvatar,
  displayName,
  inlineMenu = false,
  menuItemsOnly = false,
  compact = false,
}: AddressInfoDropdownProps) => {
  const disconnect = useRateLoopDisconnect();
  const { chain } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const checkSumAddress = getAddress(address);
  const isLocalNetwork = targetNetwork.id === hardhat.id && chain?.id === hardhat.id;
  const showFaucet = isLocalNetwork;

  if (menuItemsOnly) {
    return (
      <>
        <li className="px-3 py-2" data-testid="wallet-connected">
          <div className="flex items-start gap-3">
            <BlockieAvatar address={checkSumAddress} size={24} ensImage={ensAvatar} />
            <div className="min-w-0 flex-1">
              <ClaimRewardsButton
                className="mb-1"
                buttonClassName="btn btn-primary btn-xs h-8 min-h-0 w-full border-none px-3 text-sm"
                showTokenSymbol={false}
              />
              <WalletAddressCopyRow address={checkSumAddress} displayName={displayName} />
              <WalletSummaryDetails
                address={address}
                balanceClassName="text-sm font-medium leading-5 text-base-content/78"
                freeTxClassName="text-left"
                stakeClassName="flex items-center gap-1.5 text-sm font-medium leading-5 text-base-content/68"
                winRateClassName="text-left"
              />
            </div>
          </div>
        </li>
        <MenuItems disconnect={disconnect} showText={true} showFaucet={showFaucet} />
      </>
    );
  }

  const walletSummary = (
    <div className="w-full px-4 py-3">
      <div className="flex items-start gap-3">
        <BlockieAvatar address={checkSumAddress} size={24} ensImage={ensAvatar} />
        <div className="min-w-0 flex flex-1 flex-col gap-1">
          <ClaimRewardsButton
            className="mb-1"
            buttonClassName="btn btn-primary btn-xs h-8 min-h-0 w-full border-none px-3 text-sm"
            showTokenSymbol={false}
          />
          <WalletAddressCopyRow address={checkSumAddress} displayName={displayName} />
          <WalletSummaryDetails
            address={address}
            balanceClassName="text-left text-sm font-medium leading-5 text-base-content/78"
            freeTxClassName="text-left"
            stakeClassName="flex items-center justify-start gap-1.5 text-left text-sm font-medium leading-5 text-base-content/68"
            winRateClassName="text-left"
          />
        </div>
      </div>
    </div>
  );

  if (inlineMenu) {
    return (
      <div className="w-full flex flex-col" data-testid="wallet-connected">
        {walletSummary}
        <ul className="menu menu-vertical p-0 gap-0.5 w-full">
          <MenuItems disconnect={disconnect} showFaucet={showFaucet} />
        </ul>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center justify-center py-1" data-testid="wallet-connected">
        <BlockieAvatar address={checkSumAddress} size={30} ensImage={ensAvatar} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center xl:items-start gap-0.5" data-testid="wallet-connected">
      <div className="flex items-center justify-center xl:justify-start gap-2 xl:px-2 py-1">
        <BlockieAvatar address={checkSumAddress} size={30} ensImage={ensAvatar} />
        <div className="hidden lg:block min-w-0">
          <WalletAddressCopyRow address={checkSumAddress} displayName={displayName} />
        </div>
      </div>
      <WalletSummaryDetails
        address={address}
        balanceClassName="hidden lg:inline lg:px-2 text-sm font-medium leading-5 text-base-content/78"
        freeTxClassName="hidden lg:flex lg:px-2"
        stakeClassName="hidden lg:flex lg:px-2 items-center gap-1.5 text-sm font-medium leading-5 text-base-content/68"
        winRateClassName="hidden lg:flex lg:px-2"
      />
    </div>
  );
};
