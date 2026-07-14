"use client";

import { useState } from "react";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { AskHistoryClient } from "~~/components/tokenless/ask/AskHistoryClient";
import { AskPageTabs, type AskTab } from "~~/components/tokenless/ask/AskPageTabs";
import { PrivateEvaluationClient } from "~~/components/tokenless/ask/PrivateEvaluationClient";
import { PublicQuestionClient } from "~~/components/tokenless/ask/PublicQuestionClient";

export function AskPageClient({ sandboxMode }: { sandboxMode: boolean }) {
  const [tab, setTab] = useState<AskTab>("public");
  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <AskPageTabs active={tab} onChange={setTab} />
      {tab === "public" ? <PublicQuestionClient sandboxMode={sandboxMode} /> : null}
      {tab === "private" ? <PrivateEvaluationClient /> : null}
      {tab === "history" ? <AskHistoryClient /> : null}
    </AppPageShell>
  );
}
