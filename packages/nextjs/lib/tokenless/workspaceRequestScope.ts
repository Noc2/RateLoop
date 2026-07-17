export type WorkspaceRequest = {
  signal: AbortSignal;
  isCurrent: () => boolean;
  finish: () => void;
};

type ActiveRequest = {
  controller: AbortController;
  generation: number;
  workspaceId: string;
};

/**
 * Keeps workspace-scoped browser requests from committing after the active
 * workspace changes. Channels also make the most recent same-purpose request
 * authoritative within one workspace.
 */
export class WorkspaceRequestScope {
  private activeRequests = new Map<string, ActiveRequest>();
  private generation = 0;
  private workspaceId = "";

  get currentWorkspaceId() {
    return this.workspaceId;
  }

  selectWorkspace(workspaceId: string) {
    if (workspaceId === this.workspaceId) return false;
    this.workspaceId = workspaceId;
    this.generation += 1;
    for (const request of this.activeRequests.values()) request.controller.abort();
    this.activeRequests.clear();
    return true;
  }

  isWorkspaceCurrent(workspaceId: string) {
    return workspaceId === this.workspaceId;
  }

  begin(workspaceId: string, channel: string): WorkspaceRequest {
    this.activeRequests.get(channel)?.controller.abort();

    const request: ActiveRequest = {
      controller: new AbortController(),
      generation: this.generation,
      workspaceId,
    };
    this.activeRequests.set(channel, request);
    if (!this.isCurrent(channel, request)) request.controller.abort();

    return {
      signal: request.controller.signal,
      isCurrent: () => this.isCurrent(channel, request),
      finish: () => {
        if (this.activeRequests.get(channel) === request) this.activeRequests.delete(channel);
      },
    };
  }

  private isCurrent(channel: string, request: ActiveRequest) {
    return (
      !request.controller.signal.aborted &&
      request.generation === this.generation &&
      request.workspaceId === this.workspaceId &&
      this.activeRequests.get(channel) === request
    );
  }
}
