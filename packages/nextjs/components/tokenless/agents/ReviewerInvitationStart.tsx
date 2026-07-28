"use client";

import { type FormEvent, useRef, useState } from "react";
import { OneTimeSecretNotice } from "~~/components/tokenless/agents/OneTimeSecretNotice";
import { ChoiceInput, Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { Button } from "~~/components/tokenless/ui/Button";
import { readJson } from "~~/lib/tokenless/http";

export function ReviewerInvitationStart({ workspaceId }: { workspaceId: string }) {
  const emailRef = useRef<HTMLInputElement>(null);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [paidAdulthoodAttested, setPaidAdulthoodAttested] = useState(false);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const invitationPath = `/api/account/workspaces/${encodeURIComponent(workspaceId)}/reviewer-invitations`;

  async function startInvitation() {
    setStarting(true);
    clear();
    try {
      await readJson(
        await fetch(`${invitationPath}/prepare`, {
          method: "POST",
          credentials: "same-origin",
        }),
      );
      setStarted(true);
      window.setTimeout(() => emailRef.current?.focus());
    } catch (error) {
      capture(error, "Unable to start a reviewer invitation.");
    } finally {
      setStarting(false);
    }
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setIssuedUrl(null);
    clear();
    try {
      const body = await readJson(
        await fetch(invitationPath, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intendedEmail: email.trim() || null,
            maxPrivateSensitivity: "confidential",
            paidAdulthoodAttested,
            useDefaultReviewerGroup: true,
          }),
        }),
      );
      const invitation = body.invitation as Record<string, unknown> | undefined;
      if (typeof invitation?.destinationUrl !== "string") throw new Error("Invitation link was unavailable.");
      setIssuedUrl(invitation.destinationUrl);
      setEmail("");
    } catch (error) {
      capture(error, "Unable to invite the reviewer.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="surface-card rounded-2xl p-5" aria-label="Reviewer invitations">
      {!started ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm leading-6 text-base-content/60">
            You can invite reviewers now and connect your agent when you are ready.
          </p>
          <Button
            className="min-h-11 shrink-0"
            type="button"
            variant="secondary"
            disabled={starting}
            onClick={() => void startInvitation()}
          >
            {starting ? "Preparing…" : "Invite reviewers"}
          </Button>
        </div>
      ) : (
        <>
          <h2 className="text-xl font-semibold">Invite a reviewer</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">
            They can accept access now. Review work starts only after you connect and configure an agent.
          </p>
          <form className="mt-5 space-y-4" onSubmit={createInvitation}>
            <Field
              ref={emailRef}
              id="early-reviewer-email"
              label="Email (optional)"
              type="email"
              autoComplete="email"
              value={email}
              onChange={event => {
                setEmail(event.target.value);
                clear("intendedEmail");
              }}
              placeholder="name@company.com"
              error={fieldErrors.intendedEmail}
            />
            <p className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-base-content/60">
              Access covers internal and confidential material. You can narrow or remove it later.
            </p>
            <label
              className="flex items-start gap-2 text-xs leading-5 text-base-content/65"
              htmlFor="early-reviewer-paid-adulthood"
            >
              <ChoiceInput
                id="early-reviewer-paid-adulthood"
                type="checkbox"
                className="checkbox-sm mt-0.5"
                checked={paidAdulthoodAttested}
                onChange={event => setPaidAdulthoodAttested(event.target.checked)}
              />
              <span>
                Permit paid assignments: our workspace warrants this invitee is at least 18. This is a customer
                attestation, not verified age, and sanctions screening still adds a manual review delay.
              </span>
            </label>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={creating}>
                {creating ? "Creating…" : "Create invitation"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={creating}
                onClick={() => {
                  setStarted(false);
                  setIssuedUrl(null);
                  setEmail("");
                  setPaidAdulthoodAttested(false);
                  clear();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
          {issuedUrl ? (
            <OneTimeSecretNotice
              label="reviewer invitation link"
              value={issuedUrl}
              onDismiss={() => setIssuedUrl(null)}
            />
          ) : null}
        </>
      )}
      {formError ? (
        <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100" role="alert">
          {formError}
        </p>
      ) : null}
    </section>
  );
}
