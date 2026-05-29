import Link from "next/link";

interface GasBalanceWarningProps {
  nativeTokenSymbol: string;
  showTransactionCostsLink?: boolean;
}

export function shouldShowGasWarningTransactionCostsLink(params: {
  freeTransactionRemaining: number;
  freeTransactionVerified: boolean;
}) {
  return params.freeTransactionVerified && params.freeTransactionRemaining <= 0;
}

export function GasBalanceWarning({ nativeTokenSymbol, showTransactionCostsLink = false }: GasBalanceWarningProps) {
  return (
    <div className="rounded-lg bg-error p-4 text-error-content">
      <p className="mb-2 text-base font-medium">Need {nativeTokenSymbol} for gas</p>
      <p className="text-base text-error-content/85">
        Add a little {nativeTokenSymbol} in{" "}
        <Link href="/settings#wallet" className="font-semibold text-error-content underline underline-offset-2">
          Wallet settings
        </Link>
        , then retry.
        {showTransactionCostsLink ? (
          <>
            {" "}
            <Link
              href="/docs/how-it-works#transaction-costs"
              className="font-semibold text-error-content underline underline-offset-2"
            >
              See transaction costs
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
