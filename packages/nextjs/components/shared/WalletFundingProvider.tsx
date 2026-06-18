"use client";

import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BuyWidget } from "thirdweb/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import {
  getThirdwebWalletFundingUnavailableMessage,
  supportsThirdwebWalletFunding,
} from "~~/lib/thirdweb/walletFunding";
import { thirdwebClient } from "~~/services/thirdweb/client";

type BuyWidgetProps = React.ComponentProps<typeof BuyWidget>;

type WalletFundingAsset = "ETH" | "USDC";

type WalletFundingRequest = {
  amount: string;
  asset: WalletFundingAsset;
  buttonLabel?: string;
  chain: NonNullable<BuyWidgetProps["chain"]>;
  description: string;
  onSuccess?: () => void | Promise<void>;
  presetOptions?: BuyWidgetProps["presetOptions"];
  receiverAddress: `0x${string}`;
  title: string;
  tokenAddress?: `0x${string}`;
  unavailableMessage?: string;
};

type WalletFundingContextValue = {
  closeWalletFunding: () => void;
  openWalletFunding: (request: WalletFundingRequest) => void;
};

const WalletFundingContext = createContext<WalletFundingContextValue | null>(null);

export function WalletFundingProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<WalletFundingRequest | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!request) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRequest(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [request]);

  const closeWalletFunding = useCallback(() => setRequest(null), []);
  const openWalletFunding = useCallback((nextRequest: WalletFundingRequest) => setRequest(nextRequest), []);

  const contextValue = useMemo(
    () => ({
      closeWalletFunding,
      openWalletFunding,
    }),
    [closeWalletFunding, openWalletFunding],
  );

  const handleSuccess = useCallback(() => {
    void request?.onSuccess?.();
  }, [request]);

  const canRenderBuyWidget = Boolean(request && thirdwebClient && supportsThirdwebWalletFunding(request.chain.id));
  const unavailableMessage = request
    ? !thirdwebClient
      ? (request.unavailableMessage ?? "Funding is unavailable until thirdweb is configured.")
      : getThirdwebWalletFundingUnavailableMessage({
          asset: request.asset,
          chainId: request.chain.id,
          chainName: request.chain.name,
          fallbackMessage: request.unavailableMessage,
        })
    : null;

  const modal =
    isMounted && request
      ? createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
            <button
              aria-label="Close funding dialog"
              className="absolute inset-0 cursor-default"
              type="button"
              onClick={closeWalletFunding}
            />
            <div
              aria-label={request.title}
              aria-modal="true"
              className="relative z-10 w-full max-w-[520px]"
              role="dialog"
            >
              <button
                aria-label="Close funding dialog"
                className="btn btn-ghost btn-sm btn-circle absolute right-3 top-3 z-20 bg-black/40 text-white hover:bg-white/10"
                type="button"
                onClick={closeWalletFunding}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
              {canRenderBuyWidget && thirdwebClient ? (
                <BuyWidget
                  amount={request.amount}
                  amountEditable
                  buttonLabel={request.buttonLabel ?? `Add ${request.asset}`}
                  chain={request.chain}
                  client={thirdwebClient}
                  description={request.description}
                  onSuccess={handleSuccess}
                  presetOptions={request.presetOptions}
                  receiverAddress={request.receiverAddress}
                  showThirdwebBranding={false}
                  theme="dark"
                  title={request.title}
                  tokenAddress={request.tokenAddress}
                  tokenEditable={false}
                />
              ) : (
                <div className="surface-card rounded-2xl p-6">
                  <h2 className="text-2xl font-semibold text-base-content">{request.title}</h2>
                  <p className="mt-3 text-sm leading-relaxed text-base-content/65">{unavailableMessage}</p>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <WalletFundingContext.Provider value={contextValue}>
      {children}
      {modal}
    </WalletFundingContext.Provider>
  );
}

export function useWalletFunding() {
  const context = useContext(WalletFundingContext);
  if (!context) {
    throw new Error("useWalletFunding must be used within WalletFundingProvider");
  }
  return context;
}
