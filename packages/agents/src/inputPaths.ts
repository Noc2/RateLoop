import { existsSync } from "node:fs";
import { resolve } from "node:path";

type InputPathOptions = {
  invocationCwd?: string;
  label?: string;
  packagePrefix?: string;
  packageRoot?: string;
  processCwd?: string;
};

function commandInvocationCwd() {
  return process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : process.cwd();
}

export function inputPathCandidates(
  path: string,
  options: InputPathOptions = {},
) {
  const invocationCwd = options.invocationCwd
    ? resolve(options.invocationCwd)
    : commandInvocationCwd();
  const processCwd = options.processCwd
    ? resolve(options.processCwd)
    : process.cwd();
  const candidates = [resolve(invocationCwd, path), resolve(processCwd, path)];
  if (
    options.packageRoot &&
    options.packagePrefix &&
    path.startsWith(options.packagePrefix)
  ) {
    candidates.push(
      resolve(
        options.packageRoot,
        path.slice(options.packagePrefix.length).replace(/^\/+/, ""),
      ),
    );
  }
  return [...new Set(candidates)];
}

export function resolveExistingInputPath(
  path: string,
  options: InputPathOptions = {},
) {
  for (const candidate of inputPathCandidates(path, options)) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${options.label ?? "Input file"} not found: ${path}`);
}
