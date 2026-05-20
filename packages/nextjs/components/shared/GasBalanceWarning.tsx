import Link from "next/link";

interface GasBalanceWarningProps {
  nativeTokenSymbol: string;
}

export function GasBalanceWarning({ nativeTokenSymbol }: GasBalanceWarningProps) {
  return (
    <div className="rounded-lg bg-error p-4 text-error-content">
      <p className="mb-2 text-base font-medium">Need {nativeTokenSymbol} for gas</p>
      <p className="text-base text-error-content/85">
        Add a little {nativeTokenSymbol} in{" "}
        <Link href="/settings#wallet" className="font-semibold text-error-content underline underline-offset-2">
          Wallet settings
        </Link>
        , then retry.{" "}
        <Link
          href="/docs/how-it-works#transaction-costs"
          className="font-semibold text-error-content underline underline-offset-2"
        >
          See transaction costs
        </Link>
      </p>
    </div>
  );
}
