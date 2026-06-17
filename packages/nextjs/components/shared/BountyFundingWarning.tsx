import Link from "next/link";

interface BountyFundingWarningProps {
  actionDisabled?: boolean;
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  title?: string;
}

export function BountyFundingWarning({
  actionDisabled,
  actionLabel,
  message,
  onAction,
  title = "Need bounty funds",
}: BountyFundingWarningProps) {
  return (
    <div className="rounded-lg bg-error p-4 text-error-content">
      <p className="mb-2 text-base font-medium">{title}</p>
      <p className="text-base text-error-content/85">
        {message}{" "}
        <Link
          href="/docs/how-it-works#transaction-costs"
          className="font-semibold text-error-content underline underline-offset-2"
        >
          See how bounty funding works
        </Link>
      </p>
      {actionLabel && onAction ? (
        <button
          type="button"
          className="btn btn-sm mt-3 border-error-content/30 bg-error-content text-error hover:border-error-content/50 hover:bg-error-content/90"
          disabled={actionDisabled}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
