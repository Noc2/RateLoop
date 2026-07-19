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
    <section className="mt-8 border-t border-white/10 pt-6" aria-labelledby="workspace-danger-zone-heading">
      <h2 id="workspace-danger-zone-heading" className="font-mono text-xs uppercase tracking-widest text-red-300/80">
        Danger zone
      </h2>
      <div className="mt-4 divide-y divide-red-400/20 overflow-hidden rounded-xl border border-red-400/30 bg-red-400/[0.025]">
        <WorkspaceStopPanel workspaceId={workspaceId} />
        {canDelete ? <WorkspaceDeletionPanel workspaceId={workspaceId} workspaceName={workspaceName} /> : null}
      </div>
    </section>
  );
}
