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
      returnTo={browserReturnTo}
      secondaryAction={
        <Button as={Link} href="/docs/ai" size="lg" variant="secondary">
          {t("docs")}
        </Button>
      }
      title={t("title")}
      titleId="agents-sign-in-title"
    />
  );
}
