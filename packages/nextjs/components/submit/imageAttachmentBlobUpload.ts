import { put } from "@vercel/blob/client";

export const IMAGE_ATTACHMENT_HANDLE_UPLOAD_URL = "/api/attachments/images/upload";

type ImageUploadTokenResponse = {
  clientToken?: unknown;
  error?: unknown;
};

type UploadProgressEvent = {
  loaded: number;
  percentage: number;
  total: number;
};

type RequestImageUploadClientTokenParams = {
  clientPayload: string;
  handleUploadUrl?: string;
  multipart: boolean;
  pathname: string;
};

type UploadImageAttachmentToBlobParams = RequestImageUploadClientTokenParams & {
  contentType: string;
  file: File;
  onUploadProgress?: (event: UploadProgressEvent) => void;
};

function getTokenRouteErrorMessage(response: ImageUploadTokenResponse | null) {
  return typeof response?.error === "string" && response.error.trim() ? response.error : null;
}

async function readTokenRouteResponse(response: Response): Promise<ImageUploadTokenResponse | null> {
  return (await response.json().catch(() => null)) as ImageUploadTokenResponse | null;
}

export async function requestImageUploadClientToken({
  clientPayload,
  handleUploadUrl = IMAGE_ATTACHMENT_HANDLE_UPLOAD_URL,
  multipart,
  pathname,
}: RequestImageUploadClientTokenParams) {
  const response = await fetch(handleUploadUrl, {
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: {
        clientPayload,
        multipart,
        pathname,
      },
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = await readTokenRouteResponse(response);

  if (!response.ok) {
    throw new Error(getTokenRouteErrorMessage(body) ?? "Image upload failed before the file could be sent.");
  }
  if (typeof body?.clientToken !== "string" || !body.clientToken) {
    throw new Error("Image upload failed before the file could be sent.");
  }

  return body.clientToken;
}

export async function uploadImageAttachmentToBlob({
  clientPayload,
  contentType,
  file,
  handleUploadUrl,
  multipart,
  onUploadProgress,
  pathname,
}: UploadImageAttachmentToBlobParams) {
  const token = await requestImageUploadClientToken({
    clientPayload,
    handleUploadUrl,
    multipart,
    pathname,
  });

  return put(pathname, file, {
    access: "private",
    contentType,
    multipart,
    onUploadProgress,
    token,
  });
}
