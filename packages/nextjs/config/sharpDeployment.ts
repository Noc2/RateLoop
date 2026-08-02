import { createRequire } from "node:module";

export const SHARP_LINUX_X64_RUNTIME_PACKAGES = Object.freeze([
  {
    resolveSpecifier: "@img/sharp-linux-x64/package",
    traceGlob: "./node_modules/@img/sharp-linux-x64/**/*",
  },
  {
    resolveSpecifier: "@img/sharp-libvips-linux-x64/package",
    traceGlob: "./node_modules/@img/sharp-libvips-linux-x64/**/*",
  },
]);

export const SHARP_LINUX_X64_TRACE_GLOBS = Object.freeze([
  "./node_modules/sharp/**/*",
  ...SHARP_LINUX_X64_RUNTIME_PACKAGES.map(({ traceGlob }) => traceGlob),
]);

export function assertSharpLinuxX64RuntimePackages(
  resolvePackage: (specifier: string) => string = createRequire(import.meta.url).resolve,
) {
  const missingPackages = SHARP_LINUX_X64_RUNTIME_PACKAGES.flatMap(({ resolveSpecifier }) => {
    try {
      resolvePackage(resolveSpecifier);
      return [];
    } catch {
      return [resolveSpecifier];
    }
  });

  if (missingPackages.length > 0) {
    throw new Error(
      `The Vercel runtime requires Linux x64 sharp packages. Run yarn install before building. Missing: ${missingPackages.join(
        ", ",
      )}`,
    );
  }
}
