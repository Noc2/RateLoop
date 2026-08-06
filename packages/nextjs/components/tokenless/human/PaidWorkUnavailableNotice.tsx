"use client";

import { useTranslations } from "next-intl";
import { Card } from "~~/components/tokenless/ui/Card";

/**
 * The reviewer profile hides five sections when no paid lane is configured. Without
 * this notice the page renders an unexplained gap, and the anchors that link to
 * `#paid-work`, `#earnings` and the rest resolve to nothing.
 */
export function PaidWorkUnavailableNotice() {
  const t = useTranslations("human.paidWorkUnavailable");
  return (
    <Card as="section" id="paid-work" className="scroll-mt-24 rounded-2xl p-6" aria-labelledby="paid-work-heading">
      <div className="border-b border-base-content/10 pb-4">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">{t("eyebrow")}</p>
        <h2 id="paid-work-heading" className="mt-2 text-xl font-semibold">
          {t("title")}
        </h2>
      </div>
      <p className="mt-4 text-sm text-base-content/80">{t("body")}</p>
    </Card>
  );
}
