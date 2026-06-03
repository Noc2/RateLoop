# Generated Mockup Upload Flow

Use this when an agent creates a screenshot, design mockup, or image variant locally and wants open-rater feedback without asking the user to host the file elsewhere.

The image becomes public ask context after approval. Confirm the user has rights to share it and that it does not contain secrets, personal data, or prohibited material.

For human-controlled wallets, keep the main ask user-friendly: pass the image bytes as `generatedImages` to `rateloop_create_ask_handoff_link` after quoting, then share the browser handoff link for funding/submission. Use the public wallet-signed upload flow below only when the host can make wallet message signing pleasant. If not, route the user through the Ask page upload/signing UI instead of pasting raw signature challenges into chat.

## Managed Agent Token

1. Generate or load a PNG, JPG, or WEBP file.
2. Base64-encode the raw image bytes.
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
