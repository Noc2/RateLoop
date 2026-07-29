import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";

type QueryRow = Record<string, unknown>;

export type AuthorizedSiteSearchResult = {
  area: "Run" | "Evidence" | "Agent" | "Project" | "Reviewer";
  title: string;
  description: string;
  href: string;
};

type SearchCandidate = AuthorizedSiteSearchResult & {
  identifiers: string[];
  searchable: string;
  sortTimestamp: string;
};

const MAX_RESULTS = 20;
const CANDIDATE_LIMIT = 60;

const authorizedWorkspacesCte = `WITH authorized_workspaces AS (
  SELECT w.workspace_id,w.name,m.role
  FROM tokenless_workspace_members m
  JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id
  WHERE m.account_address=? AND w.status='active'
)`;

function rowText(row: QueryRow, key: string) {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

function searchTerms(query: string) {
  return [...new Set(query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean))].slice(0, 8);
}

function matchSql(columns: readonly string[], terms: readonly string[]) {
  return {
    sql: terms
      .map(() => `(${columns.map(column => `LOWER(COALESCE(${column},'')) LIKE ?`).join(" OR ")})`)
      .join(" AND "),
    args: terms.flatMap(term => columns.map(() => `%${term}%`)),
  };
}

function href(pathname: string, params: Record<string, string>) {
  const search = new URLSearchParams(params);
  return `${pathname}?${search.toString()}`;
}

function normalize(value: string) {
  return value.toLocaleLowerCase();
}

function candidateScore(candidate: SearchCandidate, query: string, terms: readonly string[]) {
  const normalizedTitle = normalize(candidate.title);
  const normalizedQuery = normalize(query.trim());
  let score = candidate.area === "Evidence" || candidate.area === "Run" ? 40 : 20;
  if (candidate.identifiers.some(identifier => normalize(identifier) === normalizedQuery)) score += 1_000;
  if (normalizedTitle === normalizedQuery) score += 300;
  else if (normalizedTitle.startsWith(normalizedQuery)) score += 160;
  else if (normalizedTitle.includes(normalizedQuery)) score += 80;
  for (const term of terms) {
    if (normalizedTitle.includes(term)) score += 20;
    if (normalize(candidate.searchable).includes(term)) score += 5;
  }
  return score;
}

export function dedupeAuthorizedSiteSearchResults(
  candidates: readonly SearchCandidate[],
  query: string,
  limit = MAX_RESULTS,
): AuthorizedSiteSearchResult[] {
  const terms = searchTerms(query);
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index, score: candidateScore(candidate, query, terms) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.candidate.sortTimestamp.localeCompare(left.candidate.sortTimestamp) ||
        left.index - right.index,
    );
  const seen = new Set<string>();
  return ordered
    .flatMap(({ candidate }) => {
      if (seen.has(candidate.href)) return [];
      seen.add(candidate.href);
      return [
        {
          area: candidate.area,
          title: candidate.title,
          description: candidate.description,
          href: candidate.href,
        },
      ];
    })
    .slice(0, Math.max(0, limit));
}

async function searchRuns(accountAddress: string, terms: readonly string[]): Promise<SearchCandidate[]> {
  const match = matchSql(
    ["r.run_id", "p.project_id", "p.name", "s.name", "r.status", "COALESCE(d.decision,'')"],
    terms,
  );
  const result = await dbClient.execute({
    sql: `${authorizedWorkspacesCte}
      SELECT aw.workspace_id,aw.name AS workspace_name,r.run_id,r.status,r.created_at,
             p.project_id,p.name AS project_name,s.name AS suite_name,d.decision
      FROM authorized_workspaces aw
      JOIN tokenless_assurance_projects p ON p.workspace_id=aw.workspace_id
      JOIN tokenless_assurance_runs r ON r.project_id=p.project_id
      JOIN tokenless_assurance_suites s ON s.suite_id=r.suite_id AND s.version=r.suite_version
      LEFT JOIN tokenless_assurance_client_decisions d ON d.run_id=r.run_id
      WHERE p.status<>'deleted' AND ${match.sql}
      ORDER BY CASE WHEN LOWER(r.run_id)=? THEN 0 ELSE 1 END,r.created_at DESC
      LIMIT ${CANDIDATE_LIMIT}`,
    args: [accountAddress, ...match.args, terms.join(" ")],
  });
  return result.rows.map(value => {
    const row = value as QueryRow;
    const workspaceId = rowText(row, "workspace_id");
    const workspaceName = rowText(row, "workspace_name");
    const runId = rowText(row, "run_id");
    const projectId = rowText(row, "project_id");
    const projectName = rowText(row, "project_name");
    const suiteName = rowText(row, "suite_name");
    const status = rowText(row, "status");
    const decision = rowText(row, "decision");
    return {
      area: "Run" as const,
      title: `${projectName} run`,
      description: `${workspaceName} · ${status}${decision ? ` · ${decision}` : ""} · ${runId}`,
      href: href("/agents/results", { workspace: workspaceId, resultRun: runId }),
      identifiers: [runId, projectId],
      searchable: [projectName, projectId, suiteName, status, decision, runId, workspaceName].join(" "),
      sortTimestamp: rowText(row, "created_at"),
    };
  });
}

async function searchEvidence(accountAddress: string, terms: readonly string[]): Promise<SearchCandidate[]> {
  const match = matchSql(["ep.packet_id", "r.run_id", "p.project_id", "p.name", "s.name"], terms);
  const result = await dbClient.execute({
    sql: `${authorizedWorkspacesCte}
      SELECT aw.workspace_id,aw.name AS workspace_name,ep.packet_id,ep.generated_at,
             r.run_id,p.project_id,p.name AS project_name,s.name AS suite_name
      FROM authorized_workspaces aw
      JOIN tokenless_assurance_projects p ON p.workspace_id=aw.workspace_id
      JOIN tokenless_assurance_runs r ON r.project_id=p.project_id
      JOIN tokenless_assurance_suites s ON s.suite_id=r.suite_id AND s.version=r.suite_version
      JOIN tokenless_assurance_evidence_packets ep ON ep.run_id=r.run_id
      WHERE p.status<>'deleted' AND ${match.sql}
      ORDER BY CASE WHEN LOWER(ep.packet_id)=? THEN 0 ELSE 1 END,ep.generated_at DESC
      LIMIT ${CANDIDATE_LIMIT}`,
    args: [accountAddress, ...match.args, terms.join(" ")],
  });
  return result.rows.map(value => {
    const row = value as QueryRow;
    const workspaceId = rowText(row, "workspace_id");
    const workspaceName = rowText(row, "workspace_name");
    const packetId = rowText(row, "packet_id");
    const runId = rowText(row, "run_id");
    const projectId = rowText(row, "project_id");
    const projectName = rowText(row, "project_name");
    const suiteName = rowText(row, "suite_name");
    return {
      area: "Evidence" as const,
      title: `${projectName} evidence`,
      description: `${workspaceName} · packet ${packetId} · run ${runId}`,
      href: href("/agents/results", { workspace: workspaceId, run: runId, packet: packetId }),
      identifiers: [packetId, runId, projectId],
      searchable: [projectName, projectId, suiteName, packetId, runId, workspaceName].join(" "),
      sortTimestamp: rowText(row, "generated_at"),
    };
  });
}

async function searchAgents(accountAddress: string, terms: readonly string[]): Promise<SearchCandidate[]> {
  const match = matchSql(
    [
      "a.agent_id",
      "a.external_id",
      "a.status",
      "v.version_id",
      "CAST(v.version_number AS TEXT)",
      "v.display_name",
      "COALESCE(v.description,'')",
      "v.declared_provider",
      "v.declared_model",
      "COALESCE(v.declared_model_version,'')",
      "v.environment",
      "v.configuration_commitment",
    ],
    terms,
  );
  const result = await dbClient.execute({
    sql: `${authorizedWorkspacesCte}
      SELECT aw.workspace_id,aw.name AS workspace_name,a.agent_id,a.external_id,a.status,
             v.version_id,v.version_number,v.display_name,v.description,v.declared_provider,
             v.declared_model,v.declared_model_version,v.environment,v.configuration_commitment,v.created_at
      FROM authorized_workspaces aw
      JOIN tokenless_agents a ON a.workspace_id=aw.workspace_id
      JOIN tokenless_agent_versions v ON v.workspace_id=a.workspace_id AND v.agent_id=a.agent_id
      WHERE ${match.sql}
      ORDER BY
        CASE WHEN LOWER(a.agent_id)=? OR LOWER(v.version_id)=? THEN 0 ELSE 1 END,
        v.created_at DESC
      LIMIT ${CANDIDATE_LIMIT}`,
    args: [accountAddress, ...match.args, terms.join(" "), terms.join(" ")],
  });
  return result.rows.map(value => {
    const row = value as QueryRow;
    const workspaceId = rowText(row, "workspace_id");
    const workspaceName = rowText(row, "workspace_name");
    const agentId = rowText(row, "agent_id");
    const externalId = rowText(row, "external_id");
    const versionId = rowText(row, "version_id");
    const versionNumber = rowText(row, "version_number");
    const displayName = rowText(row, "display_name");
    const description = rowText(row, "description");
    const provider = rowText(row, "declared_provider");
    const model = rowText(row, "declared_model");
    const modelVersion = rowText(row, "declared_model_version");
    const environment = rowText(row, "environment");
    return {
      area: "Agent" as const,
      title: `${displayName} · version ${versionNumber}`,
      description: `${workspaceName} · ${provider} ${model}${modelVersion ? ` ${modelVersion}` : ""} · ${environment}`,
      href: href("/agents/connections", { workspace: workspaceId, agent: agentId, version: versionId }),
      identifiers: [agentId, versionId, externalId],
      searchable: [
        displayName,
        description,
        agentId,
        versionId,
        externalId,
        provider,
        model,
        modelVersion,
        environment,
        rowText(row, "configuration_commitment"),
        rowText(row, "status"),
        workspaceName,
      ].join(" "),
      sortTimestamp: rowText(row, "created_at"),
    };
  });
}

async function searchProjects(accountAddress: string, terms: readonly string[]): Promise<SearchCandidate[]> {
  const match = matchSql(["p.project_id", "p.name", "COALESCE(p.description,'')", "p.status"], terms);
  const result = await dbClient.execute({
    sql: `${authorizedWorkspacesCte}
      SELECT aw.workspace_id,aw.name AS workspace_name,p.project_id,p.name AS project_name,
             p.description,p.status,p.updated_at
      FROM authorized_workspaces aw
      JOIN tokenless_assurance_projects p ON p.workspace_id=aw.workspace_id
      WHERE p.status<>'deleted' AND ${match.sql}
      ORDER BY CASE WHEN LOWER(p.project_id)=? THEN 0 ELSE 1 END,p.updated_at DESC
      LIMIT ${CANDIDATE_LIMIT}`,
    args: [accountAddress, ...match.args, terms.join(" ")],
  });
  return result.rows.map(value => {
    const row = value as QueryRow;
    const workspaceId = rowText(row, "workspace_id");
    const workspaceName = rowText(row, "workspace_name");
    const projectId = rowText(row, "project_id");
    const projectName = rowText(row, "project_name");
    const description = rowText(row, "description");
    const status = rowText(row, "status");
    return {
      area: "Project" as const,
      title: projectName,
      description: `${workspaceName} · ${status} · ${projectId}`,
      href: href("/agents/results", { workspace: workspaceId, resultProject: projectId, resultQ: projectName }),
      identifiers: [projectId],
      searchable: [projectName, description, projectId, status, workspaceName].join(" "),
      sortTimestamp: rowText(row, "updated_at"),
    };
  });
}

async function searchReviewers(accountAddress: string, terms: readonly string[]): Promise<SearchCandidate[]> {
  const displayName = "COALESCE(profile.display_name,better_auth_user.name,browser_identity.display_name,'')";
  const verifiedEmail = `COALESCE(
    CASE WHEN better_auth_user.email_verified=true THEN better_auth_user.email END,
    CASE WHEN browser_identity.email_verified=true THEN browser_identity.primary_email END,
    ''
  )`;
  const match = matchSql([displayName, verifiedEmail], terms);
  const result = await dbClient.execute({
    sql: `${authorizedWorkspacesCte}
      SELECT aw.workspace_id,aw.name AS workspace_name,r.activated_at,
             ${displayName} AS display_name,${verifiedEmail} AS email
      FROM authorized_workspaces aw
      JOIN tokenless_workspace_reviewers r ON r.workspace_id=aw.workspace_id
      LEFT JOIN tokenless_account_profiles profile ON profile.principal_address=r.principal_address
      LEFT JOIN tokenless_browser_identities browser_identity ON browser_identity.principal_address=r.principal_address
      LEFT JOIN tokenless_identity_bindings identity_binding
        ON identity_binding.principal_id=r.principal_address
       AND identity_binding.provider='better_auth'
       AND identity_binding.status='active'
      LEFT JOIN tokenless_better_auth_users better_auth_user
        ON better_auth_user.id=identity_binding.provider_subject
      WHERE aw.role IN ('owner','admin') AND r.status='active' AND ${match.sql}
      ORDER BY r.activated_at DESC
      LIMIT ${CANDIDATE_LIMIT}`,
    args: [accountAddress, ...match.args],
  });
  return result.rows.map(value => {
    const row = value as QueryRow;
    const workspaceId = rowText(row, "workspace_id");
    const workspaceName = rowText(row, "workspace_name");
    const displayNameValue = rowText(row, "display_name");
    const email = rowText(row, "email");
    const label = displayNameValue || email || "Workspace reviewer";
    return {
      area: "Reviewer" as const,
      title: label,
      description: `Reviewer in ${workspaceName}`,
      href: `${href("/agents/review-setup", { workspace: workspaceId })}#workspace-reviewers-heading`,
      identifiers: [],
      searchable: [displayNameValue, email, workspaceName].join(" "),
      sortTimestamp: rowText(row, "activated_at"),
    };
  });
}

export async function searchAuthorizedSiteData(input: {
  accountAddress: string;
  query: string;
  limit?: number;
}): Promise<AuthorizedSiteSearchResult[]> {
  const terms = searchTerms(input.query);
  if (terms.length === 0) return [];
  const accountAddress = normalizeAccountSubject(input.accountAddress);
  const candidates = (
    await Promise.all([
      searchRuns(accountAddress, terms),
      searchEvidence(accountAddress, terms),
      searchAgents(accountAddress, terms),
      searchProjects(accountAddress, terms),
      searchReviewers(accountAddress, terms),
    ])
  ).flat();
  return dedupeAuthorizedSiteSearchResults(candidates, input.query, input.limit ?? MAX_RESULTS);
}
