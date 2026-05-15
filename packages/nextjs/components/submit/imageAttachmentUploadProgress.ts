export type ImageAttachmentUploadPhase =
  | "preparing"
  | "requesting-challenge"
  | "waiting-for-signature"
  | "uploading"
  | "processing";

type ImageAttachmentUploadPhaseCopy = {
  description: string;
  label: string;
  progress: number;
};

export const IMAGE_ATTACHMENT_UPLOAD_PHASE_COPY: Record<ImageAttachmentUploadPhase, ImageAttachmentUploadPhaseCopy> = {
  preparing: {
    description: "Reading the file before the upload request is created.",
    label: "Preparing image",
    progress: 4,
  },
  "requesting-challenge": {
    description: "Creating the signed upload request.",
    label: "Creating upload request",
    progress: 10,
  },
  "waiting-for-signature": {
    description: "Check your wallet to sign. The file upload starts after the signature is approved.",
    label: "Waiting for wallet signature",
    progress: 18,
  },
  uploading: {
    description: "Sending the image to private storage.",
    label: "Uploading image",
    progress: 24,
  },
  processing: {
    description: "Converting, stripping metadata, and checking the image.",
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
