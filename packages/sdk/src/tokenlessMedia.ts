import { RateLoopSdkError } from "./errors";
import type {
  TokenlessQuestion,
  TokenlessQuestionMedia,
  TokenlessRationaleRequirement,
} from "./tokenlessTypes";

export const TOKENLESS_MAX_QUESTION_IMAGES = 4;
export const TOKENLESS_MAX_IMAGE_ALT_LENGTH = 500;
export const TOKENLESS_MAX_PROMPT_LENGTH = 4_000;

const ASSET_ID_PATTERN = /^pqm_[A-Za-z0-9_-]{24,80}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RateLoopSdkError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected)
    throw new RateLoopSdkError(`${path}.${unexpected} is not supported.`);
}

function string(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
) {
  if (typeof value !== "string")
    throw new RateLoopSdkError(`${path} must be a string.`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new RateLoopSdkError(
      `${path} must contain ${minimum}-${maximum} characters.`,
    );
  }
  return normalized;
}

function optionalLabel(value: unknown, path: string) {
  return value === undefined ? undefined : string(value, path, 1, 200);
}

function normalizeRationale(value: unknown): TokenlessRationaleRequirement {
  const rationale = record(value, "question.rationale");
  if (rationale.mode === "optional") {
    exact(rationale, ["mode"], "question.rationale");
    return { mode: "optional" };
  }
  if (rationale.mode !== "required") {
    throw new RateLoopSdkError(
      "question.rationale.mode must be optional or required.",
    );
  }
  exact(rationale, ["mode", "maxLength", "minLength"], "question.rationale");
  const minLength =
    rationale.minLength === undefined ? 0 : Number(rationale.minLength);
  const maxLength = Number(rationale.maxLength);
  if (
    !Number.isSafeInteger(minLength) ||
    !Number.isSafeInteger(maxLength) ||
    minLength < 0 ||
    maxLength < 1 ||
    maxLength > 2_000 ||
    minLength > maxLength
  ) {
    throw new RateLoopSdkError(
      "required rationale lengths must satisfy 0 <= minLength <= maxLength <= 2000.",
    );
  }
  return {
    mode: "required",
    maxLength,
    ...(rationale.minLength === undefined ? {} : { minLength }),
  };
}

export function normalizeTokenlessQuestionMedia(
  value: unknown,
): TokenlessQuestionMedia | undefined {
  if (value === undefined) return undefined;
  const media = record(value, "question.media");
  if (media.kind === "images") {
    exact(media, ["kind", "items"], "question.media");
    if (
      !Array.isArray(media.items) ||
      media.items.length < 1 ||
      media.items.length > TOKENLESS_MAX_QUESTION_IMAGES
    ) {
      throw new RateLoopSdkError(
        `question.media.items must contain 1-${TOKENLESS_MAX_QUESTION_IMAGES} images.`,
      );
    }
    const assetIds = new Set<string>();
    const items = media.items.map((value, index) => {
      const path = `question.media.items[${index}]`;
      const item = record(value, path);
      exact(item, ["assetId", "digest", "alt"], path);
      const assetId = string(item.assetId, `${path}.assetId`, 1, 100);
      const digest = string(item.digest, `${path}.digest`, 1, 80);
      const alt = string(
        item.alt,
        `${path}.alt`,
        1,
        TOKENLESS_MAX_IMAGE_ALT_LENGTH,
      );
      if (!ASSET_ID_PATTERN.test(assetId))
        throw new RateLoopSdkError(`${path}.assetId is invalid.`);
      if (!DIGEST_PATTERN.test(digest))
        throw new RateLoopSdkError(
          `${path}.digest must be a lowercase SHA-256 digest.`,
        );
      if (assetIds.has(assetId))
        throw new RateLoopSdkError(
          "question.media image assets must not contain duplicates.",
        );
      assetIds.add(assetId);
      return { assetId, digest: digest as `sha256:${string}`, alt };
    });
    return { kind: "images", items };
  }
  if (media.kind === "youtube") {
    exact(media, ["kind", "videoId"], "question.media");
    const videoId = string(media.videoId, "question.media.videoId", 11, 11);
    if (!YOUTUBE_ID_PATTERN.test(videoId))
      throw new RateLoopSdkError("question.media.videoId is invalid.");
    return { kind: "youtube", videoId };
  }
  throw new RateLoopSdkError("question.media.kind must be images or youtube.");
}

export function normalizeTokenlessQuestion(value: unknown): TokenlessQuestion {
  const question = record(value, "question");
  const prompt = string(
    question.prompt,
    "question.prompt",
    1,
    TOKENLESS_MAX_PROMPT_LENGTH,
  );
  const rationale = normalizeRationale(question.rationale);
  const media = normalizeTokenlessQuestionMedia(question.media);
  if (question.kind === "binary") {
    exact(
      question,
      [
        "kind",
        "prompt",
        "negativeLabel",
        "positiveLabel",
        "rationale",
        "media",
      ],
      "question",
    );
    return {
      kind: "binary",
      prompt,
      ...(question.negativeLabel === undefined
        ? {}
        : {
            negativeLabel: optionalLabel(
              question.negativeLabel,
              "question.negativeLabel",
            ),
          }),
      ...(question.positiveLabel === undefined
        ? {}
        : {
            positiveLabel: optionalLabel(
              question.positiveLabel,
              "question.positiveLabel",
            ),
          }),
      rationale,
      ...(media ? { media } : {}),
    };
  }
  if (question.kind === "head_to_head") {
    exact(
      question,
      ["kind", "prompt", "optionA", "optionB", "rationale", "media"],
      "question",
    );
    const optionA = record(question.optionA, "question.optionA");
    const optionB = record(question.optionB, "question.optionB");
    exact(optionA, ["key", "label"], "question.optionA");
    exact(optionB, ["key", "label"], "question.optionB");
    const normalizedA = {
      key: string(optionA.key, "question.optionA.key", 1, 200),
      label: string(optionA.label, "question.optionA.label", 1, 200),
    };
    const normalizedB = {
      key: string(optionB.key, "question.optionB.key", 1, 200),
      label: string(optionB.label, "question.optionB.label", 1, 200),
    };
    if (normalizedA.key === normalizedB.key) {
      throw new RateLoopSdkError("head_to_head option keys must be different.");
    }
    return {
      kind: "head_to_head",
      prompt,
      optionA: normalizedA,
      optionB: normalizedB,
      rationale,
      ...(media ? { media } : {}),
    };
  }
  throw new RateLoopSdkError("question.kind must be binary or head_to_head.");
}

export function parseTokenlessYouTubeUrl(value: string) {
  const input = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new RateLoopSdkError("YouTube URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new RateLoopSdkError(
      "YouTube URL must use HTTPS without credentials.",
    );
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let videoId: string | null = null;
  if (hostname === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (hostname === "youtube.com" || hostname === "m.youtube.com") {
    if (parsed.pathname === "/watch") videoId = parsed.searchParams.get("v");
    else if (parsed.pathname.startsWith("/embed/"))
      videoId = parsed.pathname.split("/")[2] ?? null;
    else if (parsed.pathname.startsWith("/shorts/"))
      videoId = parsed.pathname.split("/")[2] ?? null;
  } else if (
    hostname === "youtube-nocookie.com" &&
    parsed.pathname.startsWith("/embed/")
  ) {
    videoId = parsed.pathname.split("/")[2] ?? null;
  }
  if (!videoId || !YOUTUBE_ID_PATTERN.test(videoId)) {
    throw new RateLoopSdkError(
      "YouTube URL must identify one supported video.",
    );
  }
  return {
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    media: { kind: "youtube" as const, videoId },
  };
}
