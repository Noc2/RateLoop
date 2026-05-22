const path = require("path");

const buildNextEslintCommand = (filenames) =>
  `yarn next:lint --fix ${filenames
    .map((f) => path.relative(path.join("packages", "nextjs"), f))
    .join(" ")}`;

const checkTypesNextCommand = () => "yarn next:check-types";

// Backend TS-only packages don't have an eslint config wired through yarn, but they all
// expose `check-types` (tsc --noEmit). Run that whenever a TS file in those packages
// changes so the pre-commit hook catches type regressions before they reach CI.
const checkTypesForWorkspace = (workspace) => () => `yarn workspace ${workspace} check-types`;

module.exports = {
  "packages/nextjs/**/*.{ts,tsx}": [
    buildNextEslintCommand,
    checkTypesNextCommand,
  ],
  "packages/keeper/**/*.{ts,tsx}": [checkTypesForWorkspace("@rateloop/keeper")],
  "packages/ponder/**/*.{ts,tsx}": [checkTypesForWorkspace("@rateloop/ponder")],
  "packages/contracts/**/*.{ts,tsx}": [checkTypesForWorkspace("@rateloop/contracts")],
  "packages/agents/**/*.{ts,tsx}": [checkTypesForWorkspace("@rateloop/agents")],
  "packages/sdk/**/*.{ts,tsx}": [checkTypesForWorkspace("@rateloop/sdk")],
  "packages/node-utils/**/*.{ts,tsx}": [checkTypesForWorkspace("@rateloop/node-utils")],
};
