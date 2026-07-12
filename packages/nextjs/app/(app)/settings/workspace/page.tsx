import { WorkspaceSettingsClient } from "~~/components/tokenless/WorkspaceSettingsClient";

export default function WorkspaceSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <div className="max-w-3xl border-l-2 border-[var(--rateloop-blue)] pl-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Account</p>
        <h1 className="display-section mt-3 text-4xl sm:text-5xl">Workspace & API access</h1>
        <p className="mt-4 text-lg leading-8 text-base-content/60">
          Separate teams, prepaid balances, and agent credentials without exposing secret keys to RateLoop.
        </p>
      </div>
      <WorkspaceSettingsClient />
    </div>
  );
}
