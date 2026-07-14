"use client";

import { useState } from "react";
import { AskHistoryClient } from "~~/components/tokenless/ask/AskHistoryClient";
import { AskPageTabs, type AskTab } from "~~/components/tokenless/ask/AskPageTabs";
import { PrivateEvaluationClient } from "~~/components/tokenless/ask/PrivateEvaluationClient";
import { PublicQuestionClient } from "~~/components/tokenless/ask/PublicQuestionClient";

export function AskPageClient({ sandboxMode }: { sandboxMode: boolean }) {
  const [tab, setTab] = useState<AskTab>("public");
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <div className="border-l-2 border-[var(--rateloop-blue)] pl-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Ask RateLoop</p>
        <h1 className="display-section mt-3 text-4xl sm:text-5xl">Put a question in front of humans.</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-base-content/60">
          Submit a public question for safe outside judgment, create a private evaluation, or review your prior asks.
        </p>
      </div>
      <AskPageTabs active={tab} onChange={setTab} />
      {tab === "public" ? <PublicQuestionClient sandboxMode={sandboxMode} /> : null}
      {tab === "private" ? <PrivateEvaluationClient /> : null}
      {tab === "history" ? <AskHistoryClient /> : null}
    </div>
  );
}
