"use client";

import { useEffect, useRef } from "react";

type Props = {
  autoAuthorize: boolean;
  values: Record<string, string>;
};

export function AgentOAuthConsentForm({ autoAuthorize, values }: Props) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (autoAuthorize) formRef.current?.requestSubmit();
  }, [autoAuthorize]);

  return (
    <form ref={formRef} action="/api/agent/oauth/authorize" method="post" className="mt-8 space-y-3">
      {Object.entries(values).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {autoAuthorize ? (
        <>
          <input type="hidden" name="decision" value="approve" />
          <p className="text-sm text-base-content/65" role="status">
            Completing the secure connection…
          </p>
          <button className="rateloop-gradient-action min-h-11 w-full px-4" type="submit">
            Continue connection
          </button>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <button className="btn btn-outline min-h-11" type="submit" name="decision" value="deny">
            Cancel
          </button>
          <button className="rateloop-gradient-action min-h-11 px-4" type="submit" name="decision" value="approve">
            Allow safe connection
          </button>
        </div>
      )}
    </form>
  );
}
