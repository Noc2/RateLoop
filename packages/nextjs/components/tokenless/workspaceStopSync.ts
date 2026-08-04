type Listener = () => void;

const revisions = new Map<string, number>();
const listeners = new Map<string, Set<Listener>>();

export function workspaceStopRevision(workspaceId: string) {
  return revisions.get(workspaceId) ?? 0;
}

export function subscribeWorkspaceStop(workspaceId: string, listener: Listener) {
  const workspaceListeners = listeners.get(workspaceId) ?? new Set<Listener>();
  workspaceListeners.add(listener);
  listeners.set(workspaceId, workspaceListeners);
  return () => {
    workspaceListeners.delete(listener);
    if (workspaceListeners.size === 0) listeners.delete(workspaceId);
  };
}

export function notifyWorkspaceStopChanged(workspaceId: string) {
  revisions.set(workspaceId, workspaceStopRevision(workspaceId) + 1);
  for (const listener of listeners.get(workspaceId) ?? []) listener();
}

export function resetWorkspaceStopSyncForTests() {
  revisions.clear();
  listeners.clear();
}
