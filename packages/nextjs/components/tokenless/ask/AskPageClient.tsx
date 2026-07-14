"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { AskHistoryClient } from "~~/components/tokenless/ask/AskHistoryClient";
import { AskPageTabs, type AskTab } from "~~/components/tokenless/ask/AskPageTabs";
import { PrivateEvaluationClient } from "~~/components/tokenless/ask/PrivateEvaluationClient";
import { PublicQuestionClient } from "~~/components/tokenless/ask/PublicQuestionClient";

export function AskPageClient({ initialTab = "public", sandboxMode }: { initialTab?: AskTab; sandboxMode: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [tab, setTab] = useState<AskTab>(initialTab);

  useEffect(() => setTab(initialTab), [initialTab]);

  function selectTab(nextTab: AskTab) {
    setTab(nextTab);
    const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    if (nextTab === "public") params.delete("tab");
    else params.set("tab", nextTab);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <AskPageTabs active={tab} onChange={selectTab} />
      {tab === "public" ? <PublicQuestionClient sandboxMode={sandboxMode} /> : null}
      {tab === "private" ? <PrivateEvaluationClient /> : null}
      {tab === "history" ? <AskHistoryClient /> : null}
    </AppPageShell>
  );
}
