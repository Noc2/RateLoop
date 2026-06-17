export const CONFIDENTIALITY_TERMS_TITLE = "Confidential Context Access Terms";
export const CONFIDENTIALITY_TERMS_VERSION = "2026-06-confidential-context-full";
export const CONFIDENTIALITY_TERMS_URI = "/confidential-context/terms";
export const CONFIDENTIALITY_TERMS_INTRO =
  "These are protocol-facing access terms for RateLoop-hosted gated question context. They are separate from the Terms of Service and Privacy Notice that may apply to a specific frontend or hosting operator.";
export const CONFIDENTIALITY_TERMS_SIGNED_PROMISE =
  "I agree not to record, copy, share, publish, or discuss this confidential RateLoop question context except as needed to rate it on RateLoop.";

export type ConfidentialityTermsBlock =
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "quote"; readonly text: string }
  | { readonly type: "list"; readonly items: readonly string[] };

type ConfidentialityTermsSection = {
  readonly heading: string;
  readonly blocks: readonly ConfidentialityTermsBlock[];
};

export const CONFIDENTIALITY_TERMS_SECTIONS = [
  {
    heading: "1. Signed Access Promise",
    blocks: [
      {
        type: "paragraph",
        text: "Before viewing confidential context, you may be asked to sign the following wallet message promise:",
      },
      { type: "quote", text: CONFIDENTIALITY_TERMS_SIGNED_PROMISE },
    ],
  },
  {
    heading: "2. What Confidential Context Means",
    blocks: [
      {
        type: "paragraph",
        text: "Confidential context is RateLoop-hosted material attached to a specific question and served only after the configured access checks pass. It may include text, images, or other hosted context that the question creator wants raters to inspect for that rating task without making the material generally public.",
      },
      {
        type: "paragraph",
        text: "These terms are an access condition for viewing that hosted context. They do not replace any separate terms imposed by a website, wallet, storage provider, identity provider, or other interface used to reach the RateLoop Protocol.",
      },
    ],
  },
  {
    heading: "3. Restricted Use",
    blocks: [
      { type: "paragraph", text: "When you access confidential context, you must not:" },
      {
        type: "list",
        items: [
          "Record, copy, screenshot, scrape, download, mirror, or otherwise preserve the material",
          "Share links, files, watermarked media, summaries, excerpts, or screenshots with anyone else",
          "Publish or discuss the material outside the rating task that required access",
          "Use the material for a competing task, dataset, model training workflow, or unrelated commercial purpose",
          "Bypass, interfere with, or misrepresent the configured gated-context access checks",
        ],
      },
    ],
  },
  {
    heading: "4. Access Logs, Watermarks, and Evidence",
    blocks: [
      {
        type: "paragraph",
        text: "Confidential context is a serving-layer access restriction, not a guarantee that disclosure is impossible. A frontend, context host, or protocol-adjacent service may watermark served media, create signed view tokens, log access events, publish evidence hashes, or submit suspected breaches to moderation or governance review.",
      },
    ],
  },
  {
    heading: "5. Bonds and Consequences",
    blocks: [
      {
        type: "paragraph",
        text: "Some confidential-context questions require a bond before the hosted context can be viewed or rated. A proven confidentiality breach may result in loss of gated-context access, loss or slashing of a posted confidentiality bond, clawback or denial of pending rewards where applicable rules allow it, reputation consequences, and governance-approved restrictions on future surplus earning paths.",
      },
    ],
  },
  {
    heading: "6. Disclosure After Settlement",
    blocks: [
      {
        type: "paragraph",
        text: "Some questions may disclose hosted context after settlement, while others may remain private. The configured disclosure policy for a question controls whether the host should later make the material public. Until that policy permits disclosure, the restrictions in these terms continue to apply.",
      },
    ],
  },
  {
    heading: "7. Versioning",
    blocks: [
      {
        type: "paragraph",
        text: "Wallet acceptance records may bind the question, wallet address, terms version, terms URI, and a hash of the signed terms payload. If these terms materially change, a new terms version may be required before viewing newly gated context.",
      },
    ],
  },
] as const satisfies readonly ConfidentialityTermsSection[];

const CONFIDENTIALITY_TERMS_OPERATOR_NOTICE =
  "For operator-specific service terms and privacy disclosures, review the Terms of Service and Privacy Notice.";
export const CONFIDENTIALITY_TERMS_OPERATOR_NOTICE_PREFIX =
  "For operator-specific service terms and privacy disclosures, review the ";

function blockToText(block: ConfidentialityTermsBlock) {
  if (block.type === "list") return block.items.map(item => `- ${item}`).join("\n");
  return block.text;
}

export const CONFIDENTIALITY_TERMS_TEXT = [
  CONFIDENTIALITY_TERMS_INTRO,
  ...CONFIDENTIALITY_TERMS_SECTIONS.flatMap(section => [section.heading, ...section.blocks.map(blockToText)]),
  CONFIDENTIALITY_TERMS_OPERATOR_NOTICE,
].join("\n\n");
