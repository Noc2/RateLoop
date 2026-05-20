import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));

async function* walk(dir) {
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry);
    const stats = await stat(path);
    if (stats.isDirectory()) {
      yield* walk(path);
    } else if (stats.isFile() && path.endsWith(".js")) {
      yield path;
    }
  }
}

function withJsExtension(specifier) {
  if (!specifier.startsWith(".")) return specifier;
  if (specifier.endsWith("/")) return specifier;
  return extname(specifier) ? specifier : `${specifier}.js`;
}

function rewriteRelativeSpecifiers(source) {
  return source
    .replace(
      /(\b(?:import|export)\b[^"'`]*\bfrom\s*["'])(\.[^"']+)(["'])/g,
      (_match, prefix, specifier, suffix) =>
        `${prefix}${withJsExtension(specifier)}${suffix}`,
    )
    .replace(
      /(\bimport\s*\(\s*["'])(\.[^"']+)(["']\s*\))/g,
      (_match, prefix, specifier, suffix) =>
        `${prefix}${withJsExtension(specifier)}${suffix}`,
    );
}

for await (const path of walk(distDir)) {
  const source = await readFile(path, "utf8");
  const rewritten = rewriteRelativeSpecifiers(source);
  if (rewritten !== source) {
    await writeFile(path, rewritten);
  }
}
