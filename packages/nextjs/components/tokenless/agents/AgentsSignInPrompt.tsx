"use client";

import { useEffect, useState } from "react";
import { useAgentTranslations } from "./AgentsLocaleProvider";
import { SignedOutGate } from "~~/components/auth/SignedOutGate";
import { agentSignInReturnToWithHash } from "~~/components/tokenless/agents/agentWorkspaceState";
import { Button } from "~~/components/tokenless/ui/Button";
import { Link } from "~~/i18n/navigation";

export function AgentsSignInPrompt({ returnTo }: { returnTo: string }) {
  const t = useAgentTranslations("signIn");
  const [browserReturnTo, setBrowserReturnTo] = useState(returnTo);

  useEffect(() => {
    setBrowserReturnTo(agentSignInReturnToWithHash(returnTo, window.location.hash));
  }, [returnTo]);

  return (
    <SignedOutGate
      description={t("description")}
      returnTo={browserReturnTo}
      secondaryAction={
        <Button
          as={Link}
          href="/docs/ai"
          size="sm"
          variant="secondary"
          className="h-10 min-h-10 px-[0.9rem] text-base font-bold leading-none"
        >
          {t("docs")}
        </Button>
      }
      title={t("title")}
      titleId="agents-sign-in-title"
    />
  );
}
