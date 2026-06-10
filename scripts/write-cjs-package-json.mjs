import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const targetDir = resolve(process.cwd(), process.argv[2] ?? "dist/cjs");

await mkdir(targetDir, { recursive: true });
await writeFile(`${targetDir}/package.json`, `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
