import type { ContentItem } from "~~/hooks/contentFeed/shared";
import { resolveContentDeploymentScope, resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";

export interface ContentFeedbackPanelScope {
  chainId: number | null;
  deploymentKey: string | null;
  unsupported: boolean;
}

function normalizeDeploymentKey(value: string | null | undefined) {
  const deploymentKey = value?.trim().toLowerCase();
  return deploymentKey ? deploymentKey : null;
}

export function resolveContentFeedbackPanelScope(
  item: Pick<ContentItem, "chainId" | "deploymentKey"> | null | undefined,
): ContentFeedbackPanelScope {
  const chainId =
    typeof item?.chainId === "number" && Number.isSafeInteger(item.chainId) && item.chainId > 0 ? item.chainId : null;
  if (!chainId) {
    return {
      chainId: null,
      deploymentKey: null,
      unsupported: Boolean(item),
    };
  }

  const protocolDeploymentKey = normalizeDeploymentKey(resolveProtocolDeploymentScope(chainId)?.deploymentKey);
  const contentDeploymentKey = normalizeDeploymentKey(resolveContentDeploymentScope(chainId)?.deploymentKey);
  const itemDeploymentKey = normalizeDeploymentKey(item?.deploymentKey);
  const itemDeploymentIsCurrent =
    !itemDeploymentKey || itemDeploymentKey === protocolDeploymentKey || itemDeploymentKey === contentDeploymentKey;

  return {
    chainId,
    deploymentKey: protocolDeploymentKey,
    unsupported: !protocolDeploymentKey || !itemDeploymentIsCurrent,
  };
}
