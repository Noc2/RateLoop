"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  type ReviewerAccessPrivateSensitivity,
  reviewerAccessSensitivityMessageKey,
} from "~~/components/tokenless/human/reviewerAccessSensitivity";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { ConfirmDialog } from "~~/components/tokenless/ui/ConfirmDialog";
import { Link } from "~~/i18n/navigation";

type ReviewerAccess = {
  workspaceId: string;
  workspaceName: string;
  status: "active" | "removed" | "left" | "expired";
  grants: Array<{
    grantId: string;
    maxPrivateSensitivity: ReviewerAccessPrivateSensitivity;
    validUntil: string | null;
    status: "active" | "expired" | "revoked";
  }>;
};

async function readJson(response: Response, fallbackMessage: string) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : fallbackMessage,
    );
  }
  return body;
}

export function ReviewerAccessPanel() {
  const t = useTranslations("human.reviewerAccess");
  const format = useFormatter();
  const [access, setAccess] = useState<ReviewerAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyWorkspaceId, setBusyWorkspaceId] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState<ReviewerAccess | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const body = await readJson(
        await fetch("/api/account/reviewer-access", {
          cache: "no-store",
          credentials: "same-origin",
          signal,
        }),
        t("requestFailed"),
      );
      setAccess((body.reviewerAccess ?? []) as ReviewerAccess[]);
    },
    [t],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal)
      .then(() => setLoadError(null))
      .catch(cause => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setLoadError(t("loadFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load, t]);

  async function leave(item: ReviewerAccess) {
    setBusyWorkspaceId(item.workspaceId);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(`/api/account/reviewer-access/${encodeURIComponent(item.workspaceId)}`, {
          method: "DELETE",
          credentials: "same-origin",
        }),
        t("requestFailed"),
      );
      await load();
      setPendingLeave(null);
      setStatus(t("left", { workspace: item.workspaceName }));
    } catch {
      setError(t("leaveFailed"));
    } finally {
      setBusyWorkspaceId(null);
    }
  }

  const activeAccess = access.filter(item => item.status === "active");
  return (
    <Card as="section" className="scroll-mt-24 rounded-2xl p-6" aria-labelledby="reviewer-access-heading">
      <div className="border-b border-base-content/10 pb-4">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">{t("eyebrow")}</p>
        <h2 id="reviewer-access-heading" className="mt-2 text-xl font-semibold">
          {t("title")}
        </h2>
      </div>
      <div className="mt-5">
        <AsyncSection
          loading={loading}
          loadingLabel={t("loading")}
          error={loadError}
          empty={activeAccess.length === 0}
          emptyTitle={t("empty")}
        >
          <ul className="space-y-3">
            {activeAccess.map(item => (
              <Card as="li" variant="nested" className="rounded-lg p-4" key={item.workspaceId}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{item.workspaceName}</h3>
                    {item.grants
                      .filter(grant => grant.status === "active")
                      .map(grant => (
                        <p className="mt-2 text-xs text-base-content/55" key={grant.grantId}>
                          {t("grant", {
                            sensitivity: t(reviewerAccessSensitivityMessageKey(grant.maxPrivateSensitivity)),
                            expiry: grant.validUntil
                              ? format.dateTime(new Date(grant.validUntil), { dateStyle: "medium" })
                              : t("noExpiry"),
                          })}
                        </p>
                      ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm border border-error/20 bg-error/[0.06] text-error"
                    disabled={busyWorkspaceId === item.workspaceId}
                    onClick={() => setPendingLeave(item)}
                  >
                    {busyWorkspaceId === item.workspaceId ? t("leaving") : t("stop")}
                  </button>
                </div>
              </Card>
            ))}
          </ul>
        </AsyncSection>
        {!loading && !loadError && activeAccess.length === 0 ? (
          <Button as={Link} variant="secondary" size="none" className="btn-sm mt-3" href="/human/review?invite=1">
            {t("useInvitation")}
          </Button>
        ) : null}
      </div>
      {status ? (
        <p role="status" className="mt-5 rounded-lg bg-success/10 p-3 text-sm text-success">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-5 rounded-lg bg-error/10 p-3 text-sm text-error">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={pendingLeave !== null}
        title={t("confirmTitle", { workspace: pendingLeave?.workspaceName ?? t("confirmFallback") })}
        description={t("confirmDescription")}
        confirmLabel={t("stop")}
        busy={busyWorkspaceId !== null}
        onCancel={() => setPendingLeave(null)}
        onConfirm={() => {
          if (pendingLeave) void leave(pendingLeave);
        }}
      />
    </Card>
  );
}
