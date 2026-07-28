"use client";

export function RuntimeErrorActions({ reset }: { reset: () => void }) {
  return (
    <>
      <button type="button" onClick={reset} className="rateloop-gradient-action min-h-11 px-4">
        Try again
      </button>
      <button
        type="button"
        onClick={() => window.history.back()}
        className="btn rateloop-secondary-action min-h-11 px-4"
      >
        Go back
      </button>
    </>
  );
}
