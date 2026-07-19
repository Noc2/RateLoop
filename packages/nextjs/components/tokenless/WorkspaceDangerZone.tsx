"use client";

import { WorkspaceDeletionPanel } from "./WorkspaceDeletionPanel";
import { WorkspaceStopPanel } from "./WorkspaceStopControl";

type WorkspaceDangerZoneProps = {
  canDelete: boolean;
  workspaceId: string;
  workspaceName: string;
};

export function WorkspaceDangerZone({ canDelete, workspaceId, workspaceName }: WorkspaceDangerZoneProps) {
  return (
    <section aria-labelledby="workspace-danger-zone-heading">
      <h2 id="workspace-danger-zone-heading" className="mb-3 text-2xl font-semibold">
        Danger Zone
      </h2>
      <div className="divide-y divide-red-400/25 overflow-hidden rounded-2xl border border-red-400/45 bg-red-400/[0.025]">
        <WorkspaceStopPanel workspaceId={workspaceId} />
        {canDelete ? <WorkspaceDeletionPanel workspaceId={workspaceId} workspaceName={workspaceName} /> : null}
      </div>
    </section>
  );
}
