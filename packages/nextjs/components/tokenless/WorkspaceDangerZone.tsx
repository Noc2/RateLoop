"use client";

import { LocalizedSharedContent } from "./LocalizedSharedContent";
import { WorkspaceDeletionPanel } from "./WorkspaceDeletionPanel";
import { WorkspaceStopPanel } from "./WorkspaceStopControl";

type WorkspaceDangerZoneProps = {
  canDelete: boolean;
  workspaceId: string;
  workspaceName: string;
};

export function WorkspaceDangerZone({ canDelete, workspaceId, workspaceName }: WorkspaceDangerZoneProps) {
  return (
    <LocalizedSharedContent>
      <section className="mt-8 border-t border-base-content/10 pt-6" aria-labelledby="workspace-danger-zone-heading">
        <h2 id="workspace-danger-zone-heading" className="font-mono text-xs uppercase tracking-widest text-error/80">
          Danger zone
        </h2>
        <div className="mt-4 divide-y divide-error/20 overflow-hidden rounded-xl border border-error/30 bg-error/[0.025]">
          <WorkspaceStopPanel workspaceId={workspaceId} />
          {canDelete ? <WorkspaceDeletionPanel workspaceId={workspaceId} workspaceName={workspaceName} /> : null}
        </div>
      </section>
    </LocalizedSharedContent>
  );
}
