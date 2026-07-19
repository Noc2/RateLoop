"use client";

import { useCallback, useEffect, useState } from "react";
import { OneTimeSecretNotice } from "./OneTimeSecretNotice";
import { formatEvidenceDeliveryDate, readEvidenceDeliveryJson } from "./evidenceDeliveryClient";

const EVENT_TYPES = [
  ["ai.rateloop.review.completed", "Review completed"],
  ["ai.rateloop.review.failed", "Review failed"],
  ["ai.rateloop.review.expired", "Review expired"],
  ["ai.rateloop.packet.anchored", "Packet anchored"],
  ["ai.rateloop.gate.blocked", "Gate blocked"],
] as const;

type EventType = (typeof EVENT_TYPES)[number][0];
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
    return "Configured HTTPS receiver";
  }
}

export function SiemEvidenceDelivery({ workspaceId }: { workspaceId: string }) {
  const endpoint = `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/event-streams`;
  const [streams, setStreams] = useState<EventStream[]>([]);
  const [url, setUrl] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<EventType[]>(EVENT_TYPES.map(([value]) => value));
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<{ label: string; value: string } | null>(null);

  const load = useCallback(async () => {
    const body = await readEvidenceDeliveryJson<{ streams: EventStream[] }>(
      await fetch(endpoint, { cache: "no-store", credentials: "same-origin" }),
    );
    setStreams(body.streams);
  }, [endpoint]);

  useEffect(() => {
    void load().catch(error => setMessage(error instanceof Error ? error.message : "Unable to load SIEM streams."));
  }, [load]);

  const deactivate = async (stream: EventStream) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(stream.endpointId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) await readEvidenceDeliveryJson(response);
      await load();
      setMessage("Event stream disabled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to disable event stream.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface-card-nested rounded-xl p-5" aria-labelledby="siem-event-streams-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="siem-event-streams-heading" className="font-semibold">
            SIEM event streams
          </h3>
          <p className="mt-2 text-sm leading-6 text-base-content/55">
            Send CloudEvents and OCSF findings to a public HTTPS receiver.
          </p>
        </div>
        <span className="badge badge-ghost">{streams.filter(stream => stream.active).length} active</span>
      </div>

      {streams.length > 0 ? (
        <div className="mt-4 space-y-3">
          {streams.map(stream => (
            <article key={stream.endpointId} className="rounded-xl border border-white/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="break-all text-sm font-semibold">{eventStreamOrigin(stream.url)}</p>
                  <p className="mt-1 text-xs text-base-content/45">
                    {stream.eventTypes.length} event types · added {formatEvidenceDeliveryDate(stream.createdAt)}
                  </p>
                </div>
                <span
                  className={`badge border-0 ${stream.active ? "bg-emerald-300/10 text-emerald-100" : "bg-white/[0.06] text-base-content/55"}`}
                >
                  {stream.active ? "Active" : "Disabled"}
                </span>
              </div>
              {stream.active ? (
                <button
                  type="button"
                  className="btn btn-xs mt-3 border-red-300/20 bg-red-300/[0.04] text-red-100"
                  disabled={busy}
                  onClick={() => void deactivate(stream)}
                >
                  Disable
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/50">No SIEM stream is configured.</p>
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
        Add event stream
      </button>
      {showForm ? (
        <form
          id="siem-event-stream-form"
          className="mt-4 space-y-4 rounded-xl border border-white/10 p-4"
          onSubmit={event => {
            event.preventDefault();
            setBusy(true);
            setMessage(null);
            void fetch(endpoint, {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url, eventTypes: selectedTypes }),
            })
              .then(response => readEvidenceDeliveryJson<CreatedEventStream>(response))
              .then(created => {
                setOneTimeSecret({ label: "SIEM signing secret", value: created.signingSecret });
                return load();
              })
              .then(() => {
                setUrl("");
                setSelectedTypes(EVENT_TYPES.map(([value]) => value));
                setShowForm(false);
                setMessage("Event stream created.");
              })
              .catch(error => setMessage(error instanceof Error ? error.message : "Unable to create event stream."))
              .finally(() => setBusy(false));
          }}
        >
          <label className="text-sm text-base-content/65">
            Receiver URL
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              type="url"
              value={url}
              onChange={event => setUrl(event.target.value)}
              placeholder="https://events.example.com/rateloop"
              required
            />
          </label>
          <fieldset>
            <legend className="text-sm text-base-content/65">Events</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {EVENT_TYPES.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-base-content/65">
                  <input
                    className="checkbox checkbox-sm"
                    type="checkbox"
                    checked={selectedTypes.includes(value)}
                    onChange={event =>
                      setSelectedTypes(current =>
                        event.target.checked ? [...current, value] : current.filter(type => type !== value),
                      )
                    }
                  />
                  {label}
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
              {busy ? "Adding…" : "Add stream"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => {
                setUrl("");
                setSelectedTypes(EVENT_TYPES.map(([value]) => value));
                setShowForm(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {message ? (
        <p className="mt-4 text-xs text-base-content/60" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
