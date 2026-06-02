"use client";

type WalletRestoreLoadingProps = {
  className?: string;
};

export function WalletRestoreLoading({ className = "" }: WalletRestoreLoadingProps) {
  return (
    <div className={`flex grow flex-col items-center justify-center px-6 pt-20 ${className}`.trim()}>
      <div className="surface-card flex min-h-36 w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl p-8 text-center">
        <span className="loading loading-spinner loading-md text-primary" aria-hidden="true" />
        <span className="text-sm font-medium text-base-content/60">Loading...</span>
      </div>
    </div>
  );
}
