import Link from "next/link";

interface BountyFundingWarningProps {
  message: string;
  title?: string;
}

export function BountyFundingWarning({ message, title = "Need bounty funds" }: BountyFundingWarningProps) {
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
    </div>
  );
}
