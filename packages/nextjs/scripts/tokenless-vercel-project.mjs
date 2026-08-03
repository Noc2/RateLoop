export const TOKENLESS_VERCEL_PROJECT = Object.freeze({
  projectId: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
  projectName: "rateloop-tokenless",
});

export function tokenlessVercelProjectLinkError(link, { requireProjectName = true } = {}) {
  if (!link || typeof link !== "object") {
    return `The Vercel project link is unavailable; expected ${TOKENLESS_VERCEL_PROJECT.projectName} (${TOKENLESS_VERCEL_PROJECT.projectId}).`;
  }
  const projectId = typeof link.projectId === "string" ? link.projectId : null;
  const projectName = typeof link.projectName === "string" ? link.projectName : null;
  if (
    projectId === TOKENLESS_VERCEL_PROJECT.projectId &&
    (projectName === TOKENLESS_VERCEL_PROJECT.projectName || (!requireProjectName && projectName === null))
  ) {
    return null;
  }
  return `Unexpected Vercel project ${projectName ?? "unknown"} (${projectId ?? "unknown"}); expected ${TOKENLESS_VERCEL_PROJECT.projectName} (${TOKENLESS_VERCEL_PROJECT.projectId}).`;
}
