export type ImageAttachmentUploadPhase =
  | "preparing"
  | "requesting-challenge"
  | "waiting-for-signature"
  | "uploading"
  | "processing";

type ImageAttachmentUploadPhaseCopy = {
  label: string;
  progress: number;
};

export const IMAGE_ATTACHMENT_UPLOAD_PHASE_COPY: Record<ImageAttachmentUploadPhase, ImageAttachmentUploadPhaseCopy> = {
  preparing: {
    label: "Preparing image",
    progress: 4,
  },
  "requesting-challenge": {
    label: "Creating upload request",
    progress: 10,
  },
  "waiting-for-signature": {
    label: "Waiting for wallet signature",
    progress: 18,
  },
  uploading: {
    label: "Uploading image",
    progress: 24,
  },
  processing: {
    label: "Processing image",
    progress: 88,
  },
};

const UPLOAD_PROGRESS_END = 82;

export function getImageAttachmentUploadProgress(phase: ImageAttachmentUploadPhase) {
  return IMAGE_ATTACHMENT_UPLOAD_PHASE_COPY[phase].progress;
}

export function getBlobUploadProgress(percentage: number) {
  const start = IMAGE_ATTACHMENT_UPLOAD_PHASE_COPY.uploading.progress;
  const boundedPercentage = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0;
  return Math.round(start + ((UPLOAD_PROGRESS_END - start) * boundedPercentage) / 100);
}
