"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentTranslations } from "./AgentsLocaleProvider";
import { OneTimeSecretNotice } from "./OneTimeSecretNotice";
import { readEvidenceDeliveryJson } from "./evidenceDeliveryClient";
import { ChoiceInput, Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { Card } from "~~/components/tokenless/ui/Card";

const EVENT_TYPES = [
  "ai.rateloop.review.completed",
  "ai.rateloop.review.failed",
  "ai.rateloop.review.expired",
  "ai.rateloop.packet.anchored",
  "ai.rateloop.gate.blocked",
] as const;

type EventType = (typeof EVENT_TYPES)[number];
type EventStream = {
  endpointId: string;
  url: string;
  eventTypes: EventType[];
  active: boolean;
  createdAt: string;
};
type CreatedEventStream = EventStream & { signingSecret: string };

function eventStreamOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function SiemEvidenceDelivery({ workspaceId }: { workspaceId: string }) {
  const copy = useAgentTranslations("evidencePanels.delivery");
  const errors = useAgentTranslations("errors");
  const format = useAgentFormatter();
  const statusCopy = useAgentTranslations("status");
  const endpoint = `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/event-streams`;
  const [streams, setStreams] = useState<EventStream[]>([]);
  const [url, setUrl] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<EventType[]>([...EVENT_TYPES]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<{ label: string; value: string } | null>(null);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const load = useCallback(async () => {
    const body = await readEvidenceDeliveryJson<{ streams: EventStream[] }>(
      await fetch(endpoint, { cache: "no-store", credentials: "same-origin" }),
    );
    setStreams(body.streams);
  }, [endpoint]);

  useEffect(() => {
    void load().catch(() => capture(errors("loadStreams"), errors("loadStreams")));
  }, [capture, errors, load]);

  const deactivate = async (stream: EventStream) => {
    setBusy(true);
    setMessage(null);
    clear();
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(stream.endpointId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) await readEvidenceDeliveryJson(response);
      await load();
      setMessage(statusCopy("streamDisabled"));
    } catch {
      capture(errors("disableStream"), errors("disableStream"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" variant="nested" className="rounded-xl p-5" aria-labelledby="siem-event-streams-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="siem-event-streams-heading" className="font-semibold">
            <AgentText id="translated219" />
          </h3>
          <p className="mt-2 text-sm leading-6 text-base-content/55">
            <AgentText id="translated220" />
          </p>
        </div>
        <span className="badge badge-ghost">
          <AgentText id="activeStreams" values={{ count: streams.filter(stream => stream.active).length }} />
        </span>
      </div>

      {streams.length > 0 ? (
        <div className="mt-4 space-y-3">
          {streams.map(stream => (
            <article key={stream.endpointId} className="rounded-xl border border-base-content/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="break-all text-sm font-semibold">
                    {eventStreamOrigin(stream.url) ?? copy("configuredReceiver")}
                  </p>
                  <p className="mt-1 text-xs text-base-content/55">
                    {stream.eventTypes.length} <AgentText id="translated221" />{" "}
                    {format.dateTime(new Date(stream.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <span
                  className={`badge border-0 ${stream.active ? "bg-success/10 text-success" : "bg-base-content/[0.06] text-base-content/55"}`}
                >
                  {stream.active ? <AgentText id="dynamic058" /> : <AgentText id="dynamic060" />}
                </span>
              </div>
              {stream.active ? (
                <button
                  type="button"
                  className="btn btn-xs mt-3 border-error/20 bg-error/[0.04] text-error"
                  disabled={busy}
                  onClick={() => void deactivate(stream)}
                >
                  <AgentText id="translated222" />
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/55">
          <AgentText id="noSiem" />
        </p>
      )}

      {oneTimeSecret ? (
        <OneTimeSecretNotice
          label={oneTimeSecret.label}
          value={oneTimeSecret.value}
          onDismiss={() => setOneTimeSecret(null)}
        />
      ) : null}

      <button
        type="button"
        className="btn btn-sm rateloop-secondary-action mt-4"
        aria-expanded={showForm}
        aria-controls="siem-event-stream-form"
        disabled={busy || oneTimeSecret !== null}
        onClick={() => setShowForm(true)}
      >
        <AgentText id="translated223" />
      </button>
      {showForm ? (
        <form
          id="siem-event-stream-form"
          className="mt-4 space-y-4 rounded-xl border border-base-content/10 p-4"
          onSubmit={event => {
            event.preventDefault();
            setBusy(true);
            setMessage(null);
            clear();
            void fetch(endpoint, {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url, eventTypes: selectedTypes }),
            })
              .then(response => readEvidenceDeliveryJson<CreatedEventStream>(response))
              .then(created => {
                setOneTimeSecret({ label: copy("siemSigningSecret"), value: created.signingSecret });
                return load();
              })
              .then(() => {
                setUrl("");
                setSelectedTypes([...EVENT_TYPES]);
                setShowForm(false);
                setMessage(statusCopy("streamCreated"));
              })
              .catch(() => capture(errors("createStream"), errors("createStream")))
              .finally(() => setBusy(false));
          }}
        >
          <Field
            label={<AgentText id="attribute033" />}
            type="url"
            value={url}
            error={fieldErrors.url}
            onChange={event => {
              clear("url");
              setUrl(event.target.value);
            }}
            placeholder="https://events.example.com/rateloop"
            required
          />
          <fieldset>
            <legend className="text-sm text-base-content/65">
              <AgentText id="events" />
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {EVENT_TYPES.map(value => (
                <label key={value} className="flex items-center gap-2 text-sm text-base-content/65">
                  <ChoiceInput
                    className="checkbox checkbox-sm"
                    type="checkbox"
                    checked={selectedTypes.includes(value)}
                    onChange={event =>
                      setSelectedTypes(current =>
                        event.target.checked ? [...current, value] : current.filter(type => type !== value),
                      )
                    }
                  />
                  {copy(`event.${value}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="btn btn-sm rateloop-gradient-action"
              disabled={busy || selectedTypes.length === 0 || oneTimeSecret !== null}
            >
              {busy ? <AgentText id="dynamic040" /> : <AgentText id="dynamic059" />}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => {
                setUrl("");
                setSelectedTypes([...EVENT_TYPES]);
                setShowForm(false);
              }}
            >
              <AgentText id="translated183" />
            </button>
          </div>
        </form>
      ) : null}
      {message ? (
        <p className="mt-4 text-xs text-base-content/60" role="status">
          {message}
        </p>
      ) : null}
      {formError ? (
        <p className="mt-4 text-sm text-error" role="alert">
          {formError}
        </p>
      ) : null}
    </Card>
  );
}
