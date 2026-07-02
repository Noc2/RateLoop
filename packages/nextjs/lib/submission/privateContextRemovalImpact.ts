export type PrivateContextRemovalFieldKind = "contextUrl" | "videoUrl" | "imageUrls";

export type PrivateContextRemovalField = {
  kind: PrivateContextRemovalFieldKind;
  label: string;
  value: string;
};

type PrivateContextRemovalImpactInput = {
  contextUrl?: string | null;
  imageUrls?: readonly string[] | null;
  videoUrl?: string | null;
};

function trimOptionalString(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export function getPrivateContextRemovalImpact({
  contextUrl,
  imageUrls,
  videoUrl,
}: PrivateContextRemovalImpactInput): PrivateContextRemovalField[] {
  const fields: PrivateContextRemovalField[] = [];
  const normalizedContextUrl = trimOptionalString(contextUrl);
  const normalizedVideoUrl = trimOptionalString(videoUrl);
  const normalizedImageUrls = (imageUrls ?? []).map(url => url.trim()).filter(Boolean);

  if (normalizedContextUrl) {
    fields.push({
      kind: "contextUrl",
      label: "Context Source",
      value: normalizedContextUrl,
    });
  }

  if (normalizedVideoUrl) {
    fields.push({
      kind: "videoUrl",
      label: "Video URL",
      value: normalizedVideoUrl,
    });
  }

  if (normalizedImageUrls.length > 0) {
    fields.push({
      kind: "imageUrls",
      label: "Uploaded images",
      value:
        normalizedImageUrls.length === 1
          ? "1 uploaded image"
          : `${normalizedImageUrls.length.toLocaleString("en-US")} uploaded images`,
    });
  }

  return fields;
}

export function hasPrivateContextRemovalImpact(input: PrivateContextRemovalImpactInput) {
  return getPrivateContextRemovalImpact(input).length > 0;
}
