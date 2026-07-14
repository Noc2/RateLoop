import { WorkspaceSettingsClient } from "~~/components/tokenless/WorkspaceSettingsClient";

export default function WorkspaceSettingsPage() {
  return (
    <section>
      <p className="mt-8 text-sm leading-6 text-base-content/60">
        Separate teams, prepaid balances, and agent credentials without exposing secret keys to RateLoop.
      </p>
      <WorkspaceSettingsClient />
    </section>
  );
}
