export function assertNextConfigBuildGuards(env: Record<string, string | undefined> = process.env) {
  if (env.NEXT_PUBLIC_IGNORE_BUILD_ERROR?.trim() === "true") {
    throw new Error("NEXT_PUBLIC_IGNORE_BUILD_ERROR is no longer supported. Fix build errors before deploying.");
  }
}
