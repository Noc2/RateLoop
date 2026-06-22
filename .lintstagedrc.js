const path = require("path");

const toRepoRelativePath = (filename) =>
  path.isAbsolute(filename) ? path.relative(process.cwd(), filename) : filename;

const buildNextEslintCommand = (filenames) =>
  `yarn next:lint --fix ${filenames
    .map((f) => path.relative(path.join("packages", "nextjs"), f))
    .join(" ")}`;

const checkTypesNextCommand = () => "yarn next:check-types";
const buildContractsCommand = () => "yarn workspace @rateloop/contracts build";

// Backend TS-only packages don't have an eslint config wired through yarn, but they all
// expose `check-types` (tsc --noEmit). Run that whenever a TS file in those packages
// changes so the pre-commit hook catches type regressions before they reach CI.
const checkTypesForWorkspace = (workspace) => () => `yarn workspace ${workspace} check-types`;

const workspaceTypecheckGlobs = [
  ["packages/keeper/", "@rateloop/keeper"],
  ["packages/ponder/", "@rateloop/ponder"],
  ["packages/contracts/", "@rateloop/contracts"],
  ["packages/agents/", "@rateloop/agents"],
  ["packages/sdk/", "@rateloop/sdk"],
  ["packages/node-utils/", "@rateloop/node-utils"],
];

const buildPackageTypecheckCommands = (filenames) => {
  const repoRelativeFiles = filenames.map(toRepoRelativePath);
  const commands = [];
  const nextjsFiles = repoRelativeFiles.filter((filename) =>
    filename.startsWith("packages/nextjs/"),
  );

  if (nextjsFiles.length > 0) {
    commands.push(buildNextEslintCommand(nextjsFiles));
    commands.push(buildContractsCommand());
    commands.push(checkTypesNextCommand());
  }

  for (const [packagePrefix, workspace] of workspaceTypecheckGlobs) {
    if (repoRelativeFiles.some((filename) => filename.startsWith(packagePrefix))) {
      commands.push(checkTypesForWorkspace(workspace)());
    }
  }

  return commands;
};

module.exports = {
  "packages/**/*.{ts,tsx}": [buildPackageTypecheckCommands],
};
