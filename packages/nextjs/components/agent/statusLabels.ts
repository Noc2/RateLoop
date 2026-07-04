const STATUS_LABELS: Record<string, string> = {
  awaiting_image_signatures: "Awaiting image signatures",
  confirmed: "Confirmed",
  delivered: "Delivered",
  delivering: "Delivering",
  expired: "Expired",
  failed: "Needs attention",
  failed_confirmation: "Confirmation failed",
  pending: "Pending",
  pending_confirmation: "Pending confirmation",
  prepared: "Prepared",
  retrying: "Retrying",
  sent: "Sent",
  staged: "Ready to upload",
  submitted: "Submitted",
  uploaded: "Uploaded",
  uploading: "Uploading",
  uploading_images: "Uploading images",
};

function titleCaseStatus(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, character => character.toUpperCase())
    .replace(/\bX402\b/g, "x402");
}

export function formatAgentStatusLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return STATUS_LABELS[value] ?? titleCaseStatus(value);
}
