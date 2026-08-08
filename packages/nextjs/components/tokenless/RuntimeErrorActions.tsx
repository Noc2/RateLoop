"use client";

import { Button } from "~~/components/tokenless/ui/Button";

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
      <Button variant="primary" size="none" type="button" onClick={reset}>
        {tryAgainLabel}
      </Button>
      <Button variant="secondary" size="none" className="min-h-11" type="button" onClick={() => window.history.back()}>
        {goBackLabel}
      </Button>
    </>
  );
}
