# Tokenless public question media restoration plan

**Status:** implemented

**Date:** 2026-07-14

**Branch:** `tokenless`

## Outcome

Restore image upload and YouTube context without reviving the deleted legacy contracts, wallet-signature upload challenge, content registry, confidentiality escrow, or mutable URL fields.

The exact ordered media descriptor is part of `question` before quote creation. The existing quote hash, content hash, terms hash, on-chain content ID, and voucher flow therefore bind the context automatically while image bytes and external URLs remain off-chain.

## Product design

The public Ask form gains an optional **Visual context** section directly after the question and answer labels.

- **Images:** up to four JPG, PNG, or WEBP files, at most 10 MB each. Uploads show progress, a thumbnail, accessible description, and remove control. Switching away from a populated image selection requires confirmation.
- **YouTube:** one supported `youtube.com`, `youtube-nocookie.com`, or `youtu.be` URL. Input is normalized to the exact video ID; tracking, playlist, start-time, and other query data are not committed.
- Images and YouTube are mutually exclusive for one question.
- The final public-data confirmation explicitly covers the prompt, labels, and attached context.

The Answer card keeps the established large content pane and 17.25rem action rail. Images render in an accessible contained gallery with a full-size lightbox. YouTube renders a local placeholder and loads a sandboxed `youtube-nocookie.com` iframe only after a user click; it never autoplays.

## Canonical question schema

Text-only questions remain valid. Both binary and head-to-head questions may add:

```ts
media?:
  | {
      kind: "images";
      items: Array<{
        assetId: string;
        digest: `sha256:${string}`;
        alt: string;
      }>;
    }
  | {
      kind: "youtube";
      videoId: string;
    };
```

Rules:

- Image order is significant and frozen.
- `assetId` is opaque; Blob URLs and storage references never enter the question.
- `digest` covers the exact normalized WEBP bytes served to reviewers.
- `alt` is required and bounded for accessibility.
- YouTube IDs use the exact eleven-character identifier accepted from canonical watch, short, embed, and privacy-enhanced URLs.
- Unknown media fields, duplicate assets, mixed image/video context, malformed digests, and more than four images fail validation.

## Image lifecycle and storage

A dedicated public-question media table remains separate from private assurance artifacts. Each record tracks:

- workspace and creator ownership;
- idempotent client request key;
- original media type and normalized WEBP metadata;
- normalized-byte SHA-256 digest, width, height, and size;
- private storage reference;
- processing and moderation state;
- unattached expiry, question binding, and deletion timestamps.

Upload sequence:

1. Authenticate the RateLoop-owned HttpOnly browser session or a policy-scoped workspace API key.
2. Verify active workspace membership before reading the upload body.
3. Enforce per-request and daily count/byte limits.
4. Decode rather than trust the filename or declared MIME type; accept only JPG, PNG, and WEBP; reject animation, multipage inputs, corrupt files, and pixel bombs.
5. Autorotate, strip metadata, normalize to WEBP, hash the normalized bytes, moderate the exact image, and store it privately.
6. Return only the canonical descriptor and same-origin owner-preview URL.
7. Delete staged assets that are not attached before their expiry.

Quote creation validates descriptor syntax but remains free and unauthenticated. Authenticated ask preparation is the ownership boundary: it verifies that every image belongs to the funding workspace and principal, matches the frozen digest, is approved and unattached, then atomically binds it to the deterministic question record. A retry may bind the same asset to the same question but never to a different question.

## Moderation and delivery

- Funding remains blocked until the question and every referenced image are approved.
- The moderation decision records the exact content hash and ordered image digests it covered.
- Rejection or delisting denies all associated media delivery and releases pre-round payment as today.
- A post-commit takedown stops new vouchers and media delivery but never cancels, reduces, or redirects accepted-work settlement.
- The public image route serves only a known normalized variant after joining the asset to an approved public question. Pending, unattached, blocked, deleted, private, or cross-workspace assets return an indistinguishable not-found response.
- Responses set the exact WEBP content type, `X-Content-Type-Options: nosniff`, an ETag derived from the committed digest, and a short/revalidated cache policy so takedowns remain effective.

## Agent and handoff boundary

The public MCP keeps exactly four tools: capabilities, create-browser-handoff, handoff-status, and result. It does not gain a raw upload tool.

- Authenticated SDK/CLI callers receive a workspace-scoped multipart upload method and put the returned descriptor into the normal quote request.
- Browser authors stage images from the public Ask form through their RateLoop session. Image bytes never enter an MCP payload, URL fragment, or model transcript.
- Existing version 1 browser handoffs carry text-only or YouTube drafts. API-key-staged images stay in the authenticated delegated lane; a future browser-claim grant must be designed before an agent-staged image can cross into a browser principal.

## Implementation commits

1. **Design:** update the design of record and add this restoration plan.
2. **Canonical schema:** add strict SDK, server, MCP, and handoff media normalization with backward-compatible text-only requests.
3. **Image staging:** add the media migration, private storage, decoding/normalization, quotas, authenticated upload, owner preview, cleanup, and ask-time atomic binding.
4. **Moderation:** cover ordered digests in moderation and deny delivery after rejection or takedown while preserving accepted work.
5. **Application:** add the Ask authoring controls, preview, accessible Answer gallery/lightbox, click-to-load YouTube renderer, and narrow CSP allowance.
6. **Agents:** restore authenticated SDK/CLI file-backed image staging without adding public MCP tools or overstating browser-claim support.

## Verification gates

- SDK/server/MCP/handoff validators accept text-only, images, and YouTube consistently and reject malformed or ambiguous inputs.
- Image tests cover MIME spoofing, corrupt input, size/pixel/animation limits, EXIF stripping, normalized digest binding, quotas, idempotency, cross-workspace access, moderation failure, orphan cleanup, and takedown.
- Product tests prove changing image order, digest, alt text, or YouTube ID changes the content hash and that ask preparation cannot alter the quoted descriptor.
- Renderer tests prove no raw storage references escape, images have meaningful alt text, and YouTube uses click-to-load privacy-enhanced embeds without autoplay.
- Browser verification covers upload → preview/remove → persisted submit → Answer rendering for images and YouTube on desktop and mobile.
- `rg` proves no legacy media contract, registry, wallet challenge, confidentiality, or local-signer imports returned.
- Run SDK, agents, and Next.js tests, type checks, lint, and production build before the guarded `tokenless` push.

## Rollout

Existing text-only records need no backfill. Apply the new media migration to the isolated tokenless database before enabling the controls. Deploy only to `rateloop-tokenless`; do not reuse legacy attachment tables, Blob paths, Vercel projects, domains, or production RateLoop services.
