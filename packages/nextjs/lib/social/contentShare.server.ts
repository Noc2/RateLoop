import { getOptionalAppUrl, getOptionalPonderUrl } from "../env/server";
import {
  type ContentShareContentInput,
  type ContentShareData,
  buildContentShareData,
  normalizeContentShareContentId,
} from "./contentShare";
import "server-only";
import { getQuestionConfidentiality, isConfidentialityCurrentlyGated } from "~~/lib/confidentiality/context";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";

const CONTENT_SHARE_FETCH_TIMEOUT_MS = 2_500;

interface PonderContentDetailResponse {
  content?: ContentShareContentInput | null;
}

interface PonderDeploymentResponse {
  deploymentKey?: string | null;
}

interface ContentShareDataOptions {
  chainId?: number | string | null;
  contentRegistryAddress?: string | null;
  fetchImpl?: typeof fetch;
  origin?: string;
}

function normalizeShareChainId(value: ContentShareDataOptions["chainId"]): number | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return null;
  const chainId = Number(raw);
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null;
}

function normalizeShareDeploymentKey(value: string | null | undefined): string | null {
  const deploymentKey = value?.trim().toLowerCase();
  return deploymentKey ? deploymentKey : null;
}

function resolveExpectedShareDeploymentKey(options: ContentShareDataOptions): string | null {
  const chainId = normalizeShareChainId(options.chainId);
  return chainId ? normalizeShareDeploymentKey(resolveProtocolDeploymentScope(chainId)?.deploymentKey) : null;
}

function isPonderContentGated(content: ContentShareContentInput): boolean {
  return content.contextAccess === "gated" || content.contextVisibility === "gated";
}

function redactGatedShareContent(content: ContentShareContentInput): ContentShareContentInput {
  return {
    ...content,
    contentMetadata: null,
    description: "This question uses private RateLoop-hosted context.",
    imageUrl: null,
    thumbnailUrl: null,
    title: "Private RateLoop question",
    url: null,
  };
}

function getContentShareOrigin(): string {
  return getOptionalAppUrl() ?? `http://localhost:${process.env.PORT || 3000}`;
}

async function fetchContentForShare(
  ponderUrl: string,
  contentId: string,
  fetchImpl: typeof fetch,
): Promise<ContentShareContentInput | null> {
  const url = new URL(`content/${contentId}`, `${ponderUrl.replace(/\/+$/, "")}/`);
  const response = await fetchImpl(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(CONTENT_SHARE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as PonderContentDetailResponse;
  return body.content ?? null;
}

async function ponderDeploymentMatchesShareScope(
  ponderUrl: string,
  expectedDeploymentKey: string | null,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  if (!expectedDeploymentKey) return true;

  const url = new URL("deployment", `${ponderUrl.replace(/\/+$/, "")}/`);
  const response = await fetchImpl(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(CONTENT_SHARE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return false;

  const body = (await response.json()) as PonderDeploymentResponse;
  return normalizeShareDeploymentKey(body.deploymentKey) === expectedDeploymentKey;
}

export async function getContentShareDataForParam(
  contentParam: unknown,
  options: ContentShareDataOptions = {},
): Promise<ContentShareData | null> {
  const contentId = normalizeContentShareContentId(contentParam);
  const ponderUrl = getOptionalPonderUrl();
  if (!contentId || !ponderUrl) {
    return null;
  }

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const expectedDeploymentKey = resolveExpectedShareDeploymentKey(options);
    if (!(await ponderDeploymentMatchesShareScope(ponderUrl, expectedDeploymentKey, fetchImpl))) {
      return null;
    }

    const content = await fetchContentForShare(ponderUrl, contentId, fetchImpl);
    if (!content) return null;
    const scopedContent: ContentShareContentInput = {
      ...content,
      chainId: content.chainId ?? normalizeShareChainId(options.chainId),
      contentRegistryAddress: content.contentRegistryAddress ?? options.contentRegistryAddress,
      deploymentKey: content.deploymentKey ?? expectedDeploymentKey,
    };
    const confidentiality = await getQuestionConfidentiality(scopedContent.id, {
      chainId: scopedContent.chainId,
      contentRegistryAddress: scopedContent.contentRegistryAddress,
      deploymentKey: scopedContent.deploymentKey,
    }).catch(() => null);
    const shareContent =
      isPonderContentGated(scopedContent) || isConfidentialityCurrentlyGated(confidentiality)
        ? redactGatedShareContent(scopedContent)
        : scopedContent;
    return buildContentShareData(shareContent, options.origin ?? getContentShareOrigin());
  } catch {
    return null;
  }
}
