export type ReviewPolicyAgentChoice = {
  agentId: string;
  displayName: string;
  versions: Array<{ versionId: string; versionNumber: number; displayName: string }>;
};

export type ReviewPolicyTargetRegistry = {
  agents: ReviewPolicyAgentChoice[];
  policies: Array<{ policyId: string; agentId: string; agentVersionId: string }>;
};

export type UnboundAgentVersion = {
  agentId: string;
  agentDisplayName: string;
  versionId: string;
  versionNumber: number;
  versionDisplayName: string;
};

export function versionHasPolicy(
  registry: ReviewPolicyTargetRegistry,
  versionId: string,
  exceptPolicyId?: string | null,
) {
  return registry.policies.some(policy => policy.agentVersionId === versionId && policy.policyId !== exceptPolicyId);
}

export function listUnboundAgentVersions(registry: ReviewPolicyTargetRegistry): UnboundAgentVersion[] {
  return registry.agents.flatMap(agent =>
    agent.versions
      .filter(version => !versionHasPolicy(registry, version.versionId))
      .map(version => ({
        agentId: agent.agentId,
        agentDisplayName: agent.displayName,
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        versionDisplayName: version.displayName,
      })),
  );
}

export function reviewPolicySectionIsVisible(registry: ReviewPolicyTargetRegistry) {
  return registry.agents.length > 0 || registry.policies.length > 0;
}

export function findBoundAgentVersion(
  registry: ReviewPolicyTargetRegistry,
  policy: ReviewPolicyTargetRegistry["policies"][number],
) {
  const agent = registry.agents.find(entry => entry.agentId === policy.agentId);
  const version = agent?.versions.find(entry => entry.versionId === policy.agentVersionId);
  return { agent, version };
}
