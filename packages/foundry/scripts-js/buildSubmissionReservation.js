import {
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  toBytes,
} from "viem";

const args = process.argv.slice(2);
if (
  args.length < 8 ||
  args.length === 9 ||
  args.length > 21 ||
  (args.length > 17 && args.length < 21)
) {
  console.error(
    "Usage: node buildSubmissionReservation.js <rpcUrl> <registry> <submitter> <contextUrl> <imageUrlsJson> <videoUrl> <title> <tags> <categoryId> <salt> [rewardAsset] [rewardAmount] [requiredVoters] [requiredSettledRounds] [bountyStartBy] [bountyWindowSeconds] [feedbackWindowSeconds] [epochDuration maxDuration minVoters maxVoters]"
  );
  process.exit(1);
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_REWARD_ASSET = 0n;
const DEFAULT_REWARD_AMOUNT = 1_000_000n;
const DEFAULT_REQUIRED_VOTERS = 3n;
const DEFAULT_REQUIRED_SETTLED_ROUNDS = 1n;
const DEFAULT_BOUNTY_START_BY = 0n;
const DEFAULT_BOUNTY_WINDOW_SECONDS = 0n;
const DEFAULT_FEEDBACK_WINDOW_SECONDS = 0n;
const DEFAULT_BOUNTY_ELIGIBILITY = 0n;
const DEFAULT_QUESTION_METADATA_HASH =
  "0xed39b36e9ce5c1bfc657909c2f687347be2de998bc871eb8d33df17fdfa0d8cd";
const DEFAULT_RESULT_SPEC_HASH =
  "0x8e5f27bc3269c62c92754f76279bd83838462060fc6cd77411b7407027cfa11f";
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}`;
const QUESTION_CONTEXT_DOMAIN = keccak256(
  toBytes("rateloop-question-context-v5")
);
const QUESTION_REVEAL_DOMAIN = keccak256(
  toBytes("rateloop-question-reveal-v7")
);
const DEFAULT_ROUND_CONFIG = {
  epochDuration: 20 * 60,
  maxDuration: 20 * 60,
  minVoters: 3,
  maxVoters: 100,
};

const MAX_SUBMISSION_IMAGE_URLS = 4;
const UPLOADED_IMAGE_URL_PATTERN =
  /^https:\/\/[^\s?#]+\/api\/attachments\/images\/att_[A-Za-z0-9_-]{16,80}\.webp#sha256=0x[a-fA-F0-9]{64}$/;
const DIRECT_IMAGE_URL_PATH_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;

function isSupportedYouTubeUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;

    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.length > 1;
    }

    if (
      parsed.hostname === "www.youtube.com" &&
      parsed.pathname.startsWith("/embed/")
    ) {
      return parsed.pathname.length > "/embed/".length;
    }

    const isWatchHost =
      parsed.hostname === "youtube.com" ||
      parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "m.youtube.com";
    return (
      isWatchHost &&
      parsed.pathname === "/watch" &&
      parsed.searchParams.has("v")
    );
  } catch {
    return false;
  }
}

function assertHttpsUrl(value, label) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || /\s/.test(value))
      throw new Error("invalid");
  } catch {
    console.error(`${label} must be a valid HTTPS URL.`);
    process.exit(1);
  }
}

function isDirectImageUrl(value) {
  try {
    return DIRECT_IMAGE_URL_PATH_PATTERN.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function assertSupportedContextUrl(value, { allowEmpty = false } = {}) {
  const trimmed = value.trim();
  if (!trimmed) {
    if (allowEmpty) return;
    console.error(
      "Context URL must be provided unless image URLs or a video URL are attached."
    );
    process.exit(1);
  }
  if (trimmed !== value) {
    console.error(
      "Context URL must not include leading or trailing whitespace."
    );
    process.exit(1);
  }

  assertHttpsUrl(trimmed, "Context URL");
  if (isDirectImageUrl(trimmed)) {
    console.error(
      "Context URL must be a public page URL, not a direct image file URL."
    );
    process.exit(1);
  }
}

function assertSupportedImageUrls(imageUrls, { allowEmpty = false } = {}) {
  if (!allowEmpty && imageUrls.length === 0) {
    console.error("At least one image URL is required.");
    process.exit(1);
  }
  if (imageUrls.length > MAX_SUBMISSION_IMAGE_URLS) {
    console.error(`Expected at most ${MAX_SUBMISSION_IMAGE_URLS} image URLs.`);
    process.exit(1);
  }
  const unsupportedImageUrl = imageUrls.find(
    (item) => !UPLOADED_IMAGE_URL_PATTERN.test(item)
  );
  if (unsupportedImageUrl) {
    console.error(`Unsupported image URL: ${unsupportedImageUrl}`);
    process.exit(1);
  }
}

function parseImageUrls(value, { allowEmpty = false } = {}) {
  const trimmed = value.trim();
  if (!trimmed) {
    if (allowEmpty) return [];
    console.error("Image URL array is required.");
    process.exit(1);
  }
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (
        Array.isArray(parsed) &&
        parsed.every(
          (item) => typeof item === "string" && item.trim().length > 0
        )
      ) {
        assertSupportedImageUrls(parsed, { allowEmpty });
        return parsed;
      }
    } catch {
      // Fall through to the explicit error below.
    }

    console.error(
      "Invalid image URL array JSON. Expected a JSON string array."
    );
    process.exit(1);
  }

  assertSupportedImageUrls([trimmed], { allowEmpty });
  return [trimmed];
}

function toSubmissionMedia(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    return { imageUrls: parseImageUrls(trimmed), videoUrl: "" };
  }

  if (isSupportedYouTubeUrl(trimmed)) {
    return { imageUrls: [], videoUrl: trimmed };
  }

  return { imageUrls: parseImageUrls(trimmed), videoUrl: "" };
}

function parseArgs(rawArgs) {
  if (rawArgs.length === 8) {
    const [
      rpcUrl,
      registry,
      submitter,
      mediaUrlOrImageArrayJson,
      title,
      tags,
      categoryId,
      salt,
    ] = rawArgs;
    const media = toSubmissionMedia(mediaUrlOrImageArrayJson);
    return {
      rpcUrl,
      registry,
      submitter,
      contextUrl: "",
      media,
      title,
      tags,
      categoryId,
      salt,
      rewardAsset: DEFAULT_REWARD_ASSET,
      rewardAmount: DEFAULT_REWARD_AMOUNT,
      requiredVoters: DEFAULT_REQUIRED_VOTERS,
      requiredSettledRounds: DEFAULT_REQUIRED_SETTLED_ROUNDS,
      bountyStartBy: DEFAULT_BOUNTY_START_BY,
      bountyWindowSeconds: DEFAULT_BOUNTY_WINDOW_SECONDS,
      feedbackWindowSeconds: DEFAULT_FEEDBACK_WINDOW_SECONDS,
      bountyEligibility: DEFAULT_BOUNTY_ELIGIBILITY,
      roundConfig: null,
    };
  }

  const [
    rpcUrl,
    registry,
    submitter,
    contextUrl,
    imageUrlsJson,
    videoUrl,
    title,
    tags,
    categoryId,
    salt,
    rewardAsset = DEFAULT_REWARD_ASSET.toString(),
    rewardAmount = DEFAULT_REWARD_AMOUNT.toString(),
    requiredVoters = DEFAULT_REQUIRED_VOTERS.toString(),
    requiredSettledRounds = DEFAULT_REQUIRED_SETTLED_ROUNDS.toString(),
    bountyStartBy = DEFAULT_BOUNTY_START_BY.toString(),
    bountyWindowSeconds = DEFAULT_BOUNTY_WINDOW_SECONDS.toString(),
    feedbackWindowSeconds = DEFAULT_FEEDBACK_WINDOW_SECONDS.toString(),
    epochDuration,
    maxDuration,
    minVoters,
    maxVoters,
  ] = rawArgs;
  const imageUrls = parseImageUrls(imageUrlsJson, { allowEmpty: true });
  const trimmedVideoUrl = videoUrl.trim();
  if (trimmedVideoUrl && !isSupportedYouTubeUrl(trimmedVideoUrl)) {
    console.error(`Unsupported video URL: ${trimmedVideoUrl}`);
    process.exit(1);
  }
  if (trimmedVideoUrl && imageUrls.length > 0) {
    console.error("Choose images or video, not both.");
    process.exit(1);
  }
  return {
    rpcUrl,
    registry,
    submitter,
    contextUrl,
    media: { imageUrls, videoUrl: trimmedVideoUrl },
    title,
    tags,
    categoryId,
    salt,
    rewardAsset: BigInt(rewardAsset),
    rewardAmount: BigInt(rewardAmount),
    requiredVoters: BigInt(requiredVoters),
    requiredSettledRounds: BigInt(requiredSettledRounds),
    bountyStartBy: BigInt(bountyStartBy),
    bountyWindowSeconds: BigInt(bountyWindowSeconds),
    feedbackWindowSeconds: BigInt(feedbackWindowSeconds),
    bountyEligibility: DEFAULT_BOUNTY_ELIGIBILITY,
    roundConfig:
      epochDuration === undefined
        ? null
        : {
            epochDuration: Number(epochDuration),
            maxDuration: Number(maxDuration),
            minVoters: Number(minVoters),
            maxVoters: Number(maxVoters),
          },
  };
}

async function resolveDefaultRoundConfig(publicClient, registry) {
  const protocolConfig = await publicClient.readContract({
    address: registry,
    abi: parseAbi(["function protocolConfig() view returns (address)"]),
    functionName: "protocolConfig",
  });

  if (protocolConfig.toLowerCase() === ZERO_ADDRESS) {
    return DEFAULT_ROUND_CONFIG;
  }

  const [epochDuration, maxDuration, minVoters, maxVoters] =
    await publicClient.readContract({
      address: protocolConfig,
      abi: parseAbi([
        "function config() view returns (uint32 epochDuration, uint32 maxDuration, uint16 minVoters, uint16 maxVoters)",
      ]),
      functionName: "config",
    });

  return {
    epochDuration: Number(epochDuration),
    maxDuration: Number(maxDuration),
    minVoters: Number(minVoters),
    maxVoters: Number(maxVoters),
  };
}

function buildSubmissionMediaHash(imageUrls, videoUrl) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string[]" }, { type: "string" }],
      [imageUrls, videoUrl]
    )
  );
}

function buildSubmissionDetailsHash(detailsUrl, detailsHash) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }],
      [detailsUrl, detailsHash]
    )
  );
}

function buildQuestionSubmissionKey({
  categoryId,
  contextUrl,
  imageUrls,
  tags,
  title,
  videoUrl,
}) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
      ],
      [
        QUESTION_CONTEXT_DOMAIN,
        BigInt(categoryId),
        buildSubmissionMediaHash(imageUrls, videoUrl),
        buildSubmissionDetailsHash("", EMPTY_DETAILS_HASH),
        contextUrl,
        title,
        tags,
      ]
    )
  );
}

const {
  rpcUrl,
  registry,
  submitter,
  contextUrl,
  media,
  title,
  tags,
  categoryId,
  salt,
  rewardAsset,
  rewardAmount,
  requiredVoters,
  requiredSettledRounds,
  bountyStartBy,
  bountyWindowSeconds,
  feedbackWindowSeconds,
  bountyEligibility,
  roundConfig: roundConfigOverride,
} = parseArgs(args);
const publicClient = createPublicClient({
  transport: http(rpcUrl),
});
const roundConfig =
  roundConfigOverride ??
  (await resolveDefaultRoundConfig(publicClient, registry));
assertSupportedContextUrl(contextUrl, {
  allowEmpty: media.imageUrls.length > 0 || Boolean(media.videoUrl),
});
const mediaHash = buildSubmissionMediaHash(media.imageUrls, media.videoUrl);
const submissionKey = buildQuestionSubmissionKey({
  categoryId,
  contextUrl,
  imageUrls: media.imageUrls,
  tags,
  title,
  videoUrl: media.videoUrl,
});
const textHash = keccak256(
  encodeAbiParameters(
    [{ type: "string" }, { type: "string" }],
    [title, tags]
  )
);
const detailsHash = buildSubmissionDetailsHash("", EMPTY_DETAILS_HASH);
const rewardTermsHash = keccak256(
  encodeAbiParameters(
    [
      { type: "uint8" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint8" },
    ],
    [
      Number(rewardAsset),
      rewardAmount,
      requiredVoters,
      requiredSettledRounds,
      bountyStartBy,
      bountyWindowSeconds,
      feedbackWindowSeconds,
      Number(bountyEligibility),
    ]
  )
);
const roundConfigHash = keccak256(
  encodeAbiParameters(
    [
      { type: "uint32" },
      { type: "uint32" },
      { type: "uint16" },
      { type: "uint16" },
    ],
    [
      roundConfig.epochDuration,
      roundConfig.maxDuration,
      roundConfig.minVoters,
      roundConfig.maxVoters,
    ]
  )
);
const revealCommitment = keccak256(
  encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "address" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    [
      QUESTION_REVEAL_DOMAIN,
      submissionKey,
      mediaHash,
      textHash,
      detailsHash,
      BigInt(categoryId),
      salt,
      submitter,
      rewardTermsHash,
      roundConfigHash,
      DEFAULT_QUESTION_METADATA_HASH,
      DEFAULT_RESULT_SPEC_HASH,
    ]
  )
);

console.log(revealCommitment);
