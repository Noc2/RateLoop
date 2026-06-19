# Generated Mockup Upload Flow

Use this when an agent creates a screenshot, design mockup, or image variant locally and wants open-rater feedback without asking the user to host the file elsewhere.

The image becomes public ask context after approval. Confirm the user has rights to share it and that it does not contain secrets, personal data, or prohibited material.

For human-controlled wallets, keep the main ask user-friendly: pass the image bytes as `generatedImages` to `rateloop_create_ask_handoff_link`, then share the browser handoff link for funding/submission. Quote first when the ask already has public URLs or uploaded RateLoop `imageUrls`; for generated-image-only handoffs, create the handoff directly and let the browser prepare step price the ask before payment. JPG, PNG, and WEBP inputs can be up to 10 MB per image. Do not shrink an under-limit mockup just because base64 output is too large for a terminal or chat transcript; that is a transport problem, not an upload-limit problem.

For local files, prefer the file-backed CLI helper:

```bash
yarn workspace @rateloop/agents handoff --file ask.json --image outputs/mockup.png
```

It reads the image from disk, computes `sha256` and `sizeBytes`, and prints only the handoff response. Large local files
are staged through a handoff-scoped blob upload instead of being forced through one JSON request. Use the public
wallet-signed upload flow below only when the host can make wallet message signing pleasant. If not, route the user
through the Ask page upload/signing UI instead of pasting raw signature challenges into chat.

## Managed Agent Token

1. Generate or load a PNG, JPG, or WEBP file.
2. Base64-encode the raw image bytes inside the request process; do not print the bytes through a terminal.
3. Call `rateloop_upload_image` with the managed MCP token.
4. Put the returned `imageUrl` into `question.imageUrls`.
5. Call `rateloop_quote_question`, then use a browser handoff link or local signer for funding/submission.

```json
{
  "name": "rateloop_upload_image",
  "arguments": {
    "walletAddress": "0x1111111111111111111111111111111111111111",
    "filename": "generated-mockup.png",
    "mimeType": "image/png",
    "imageBase64": "<base64 image bytes>"
  }
}
```

## Public Wallet-Signed MCP

Public MCP uploads use the same wallet that will fund the ask.

1. Compute the raw image byte length and lowercase SHA-256 hash.
2. Call `rateloop_prepare_image_upload`.
3. Ask the wallet to sign the returned `message`.
4. Call `rateloop_upload_image` with `challengeId`, `signature`, and the image bytes.
5. Use the returned `imageUrl` in `question.imageUrls`.

```json
{
  "name": "rateloop_prepare_image_upload",
  "arguments": {
    "walletAddress": "0x1111111111111111111111111111111111111111",
    "filename": "generated-mockup.png",
    "mimeType": "image/png",
    "sizeBytes": 102400,
    "sha256": "<lowercase sha256>"
  }
}
```

```json
{
  "name": "rateloop_upload_image",
  "arguments": {
    "walletAddress": "0x1111111111111111111111111111111111111111",
    "attachmentId": "att_...",
    "challengeId": "...",
    "signature": "0x...",
    "filename": "generated-mockup.png",
    "mimeType": "image/png",
    "sizeBytes": 102400,
    "sha256": "<lowercase sha256>",
    "imageBase64": "<base64 image bytes>"
  }
}
```

If `status` is `approved`, the response includes a public `imageUrl`. If moderation blocks or fails the image, revise the artifact and upload a new one instead of reusing the attachment id.
