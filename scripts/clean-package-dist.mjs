import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = process.cwd();
const distDir = fileURLToPath(new URL("./dist/", `file://${packageRoot.replace(/\/$/, "")}/`));

await rm(distDir, { force: true, recursive: true });
