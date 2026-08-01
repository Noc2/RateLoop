"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "~~/components/tokenless/ui/Card";

type PreviewValue =
  | { kind: "image"; contentType: string; objectUrl: string }
  | { kind: "text"; contentType: string; text: string }
  | { kind: "unsupported"; contentType: string };

const PREVIEW_CHARACTER_LIMIT = 900;
const INLINE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function displayText(contentType: string, raw: string) {
  if (contentType !== "application/json") return raw;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function PrivateArtifactPreview({
  artifactUrl,
  label,
  onAvailabilityChange,
  onRefreshAccess,
}: {
  artifactUrl: string;
  label: string;
  onAvailabilityChange?: (availability: "loading" | "ready" | "unavailable") => void;
  onRefreshAccess: () => Promise<void> | void;
}) {
  const t = useTranslations("review.artifact");
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const textPreviewRef = useRef<HTMLPreElement>(null);
  const availabilityChangeRef = useRef(onAvailabilityChange);
  const [preview, setPreview] = useState<PreviewValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [textOverflowing, setTextOverflowing] = useState(false);
  const [reloadGeneration, setReloadGeneration] = useState(0);

  useEffect(() => {
    availabilityChangeRef.current = onAvailabilityChange;
  }, [onAvailabilityChange]);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setPreview(null);
    availabilityChangeRef.current?.("loading");
    void (async () => {
      try {
        const response = await fetch(artifactUrl, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 410 ? t("accessExpired") : t("unavailable"));
        const contentType =
          response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
        if (INLINE_IMAGE_TYPES.has(contentType)) {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setPreview({ kind: "image", contentType, objectUrl });
        } else if (contentType === "application/json" || contentType.startsWith("text/")) {
          const raw = await response.text();
          if (controller.signal.aborted) return;
          setPreview({ kind: "text", contentType, text: displayText(contentType, raw) });
        } else {
          setPreview({ kind: "unsupported", contentType });
        }
        availabilityChangeRef.current?.("ready");
      } catch {
        if (!controller.signal.aborted) {
          setError(t("unavailable"));
          availabilityChangeRef.current?.("unavailable");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifactUrl, reloadGeneration, t]);

  useEffect(() => {
    if (!expanded) return;
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpanded(false);
        openerRef.current?.focus();
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        last.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === last) {
        first.focus();
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  const longText = preview?.kind === "text" && preview.text.length > PREVIEW_CHARACTER_LIMIT;
  const visibleText =
    preview?.kind === "text" && longText
      ? `${preview.text.slice(0, PREVIEW_CHARACTER_LIMIT).trimEnd()}…`
      : preview?.kind === "text"
        ? preview.text
        : "";
  const textCanExpand = longText || textOverflowing;

  useEffect(() => {
    const element = textPreviewRef.current;
    if (preview?.kind !== "text" || !element) {
      setTextOverflowing(false);
      return;
    }
    const measure = () => setTextOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [preview, visibleText]);

  return (
    <section className="rounded-xl border border-base-content/10 bg-base-content/[0.03] p-4" aria-labelledby={titleId}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={titleId} className="text-sm font-semibold">
          {label}
        </h3>
        {preview?.kind === "unsupported" ? (
          <a className="text-xs font-semibold underline underline-offset-4" href={artifactUrl} download>
            {t("download")}
          </a>
        ) : null}
      </div>
      {loading ? (
        <p role="status" className="mt-4 text-sm text-base-content/55">
          {t("loading")}
        </p>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-lg border border-base-content/10 p-3 text-sm">
          <p role="alert" className="text-error">
            {error}
          </p>
          <button
            type="button"
            className="mt-2 text-xs font-semibold underline underline-offset-4"
            onClick={() => void Promise.resolve(onRefreshAccess()).then(() => setReloadGeneration(value => value + 1))}
          >
            {t("refresh")}
          </button>
        </div>
      ) : null}
      {preview?.kind === "text" ? (
        <div className="mt-4">
          <pre
            ref={textPreviewRef}
            className="max-h-72 overflow-hidden whitespace-pre-wrap break-words font-sans text-sm leading-6 text-base-content/80"
          >
            {visibleText || t("empty")}
          </pre>
          {textCanExpand ? (
            <button
              ref={openerRef}
              type="button"
              className="mt-3 text-sm font-semibold underline underline-offset-4"
              onClick={() => setExpanded(true)}
            >
              {t("showMore")}
            </button>
          ) : null}
        </div>
      ) : null}
      {preview?.kind === "image" ? (
        <button ref={openerRef} type="button" className="mt-4 block w-full" onClick={() => setExpanded(true)}>
          {/* Private blob URLs cannot be passed through next/image. */}
          <img
            src={preview.objectUrl}
            alt={t("imagePreview", { label })}
            className="max-h-80 w-full rounded-lg object-contain"
          />
          <span className="mt-2 block text-xs font-semibold underline underline-offset-4">{t("openImage")}</span>
        </button>
      ) : null}
      {preview?.kind === "unsupported" ? (
        <p className="mt-4 text-sm leading-6 text-base-content/60">{t("unsupported")}</p>
      ) : null}

      {expanded && preview && preview.kind !== "unsupported" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${titleId}-dialog`}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
        >
          <Card as="div" ref={dialogRef} className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4 border-b border-base-content/10 pb-4">
              <h2 id={`${titleId}-dialog`} className="text-xl font-semibold">
                {label}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                className="btn btn-sm rateloop-secondary-action px-3"
                onClick={() => {
                  setExpanded(false);
                  openerRef.current?.focus();
                }}
              >
                {t("close")}
              </button>
            </div>
            <div className="mt-4 min-h-0 overflow-auto">
              {preview.kind === "text" ? (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-base-content/85">
                  {preview.text}
                </pre>
              ) : (
                <img
                  src={preview.objectUrl}
                  alt={t("fullPreview", { label })}
                  className="mx-auto max-h-[72vh] max-w-full object-contain"
                />
              )}
            </div>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
