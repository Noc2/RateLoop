"use client";

export function RuntimeErrorActions({
  goBackLabel = "Go back",
  reset,
  tryAgainLabel = "Try again",
}: {
  goBackLabel?: string;
  reset: () => void;
  tryAgainLabel?: string;
}) {
  return (
    <>
      <button type="button" onClick={reset} className="rateloop-gradient-action min-h-11 px-4">
        {tryAgainLabel}
      </button>
      <button
        type="button"
        onClick={() => window.history.back()}
        className="btn rateloop-secondary-action min-h-11 px-4"
      >
        {goBackLabel}
      </button>
    </>
  );
}
