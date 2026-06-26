const RECOMMENDED_IMAGE_ASPECT_RATIO_LABEL = "16:9";
const RECOMMENDED_IMAGE_MIN_SIZE_LABEL = "1280x720 px";
const RECOMMENDED_IMAGE_IDEAL_SIZE_LABEL = "1920x1080 px";

export const IMAGE_DISPLAY_GUIDANCE_SENTENCE = `For best voting-feed layout, use a ${RECOMMENDED_IMAGE_ASPECT_RATIO_LABEL} landscape image and aim for at least ${RECOMMENDED_IMAGE_MIN_SIZE_LABEL}.`;
export const GENERATED_IMAGE_DISPLAY_GUIDANCE_SENTENCE = `${IMAGE_DISPLAY_GUIDANCE_SENTENCE} For generated images, ${RECOMMENDED_IMAGE_IDEAL_SIZE_LABEL} is ideal when practical.`;
export const IMAGE_UPLOAD_CONTEXT_HINT = `Add at least one image when there is no context link. Upload up to four JPG, PNG, or WEBP files for RateLoop-hosted, moderated image context. ${IMAGE_DISPLAY_GUIDANCE_SENTENCE}`;
export const IMAGE_PREVIEW_FIT_HINT =
  "16:9 recommended for the voting feed. This preview uses contain, so non-16:9 images may show empty space.";
