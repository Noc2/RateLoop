type VisualViewportMetrics = Pick<VisualViewport, "height" | "offsetTop">;

function finiteOrFallback(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function getVisualViewportBottom(params: {
  innerHeight: number;
  visualViewport?: VisualViewportMetrics | null;
}) {
  const fallbackHeight = Math.max(0, finiteOrFallback(params.innerHeight, 0));
  if (!params.visualViewport) return fallbackHeight;

  const viewportHeight =
    Number.isFinite(params.visualViewport.height) && params.visualViewport.height > 0
      ? params.visualViewport.height
      : fallbackHeight;
  const viewportTop = finiteOrFallback(params.visualViewport.offsetTop, 0);

  return viewportTop + viewportHeight;
}

export function resolveMobileDockReservedSpace(params: {
  dockTop: number;
  minimumReservedSpace: number;
  viewportBottom: number;
}) {
  const minimumReservedSpace = Math.max(0, finiteOrFallback(params.minimumReservedSpace, 0));
  const dockTop = finiteOrFallback(params.dockTop, params.viewportBottom);
  const viewportBottom = finiteOrFallback(params.viewportBottom, dockTop);

  return Math.max(minimumReservedSpace, Math.ceil(viewportBottom - dockTop));
}
