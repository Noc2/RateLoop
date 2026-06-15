/** Browser-only helpers for question detail ids and content hashing (submit + handoff flows). */
import { questionDetailsHashInput } from "~~/lib/attachments/questionDetails.shared";

export function createQuestionDetailsId() {
  const bytes = new Uint8Array(18);
  window.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `det_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function questionDetailsSha256Hex(params: {
  detailsId: string;
  normalizedText: string;
  requiresGatedAccess?: boolean;
}) {
  return sha256Hex(questionDetailsHashInput(params));
}
