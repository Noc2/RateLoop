import { once } from "node:events";
import { run } from "node:test";
import { spec } from "node:test/reporters";

const [configuredConcurrency, ...files] = process.argv.slice(2);

if (configuredConcurrency === undefined || files.length === 0) {
  console.error(
    "Usage: node scripts/run-node-test-group.mjs <concurrency> <test-file> [test-file...]",
  );
  process.exit(1);
}

const concurrency = Number(configuredConcurrency);
if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
  console.error("Test concurrency must be a positive integer.");
  process.exit(1);
}

const testStream = run({
  concurrency,
  coverage: true,
  cwd: process.cwd(),
  execArgv: process.execArgv,
  files,
});

let observedTests = 0;
let failedTests = 0;

testStream.on("test:pass", () => {
  observedTests += 1;
});
testStream.on("test:fail", () => {
  observedTests += 1;
  failedTests += 1;
});

for await (const chunk of testStream.compose(spec)) {
  if (!process.stdout.write(chunk)) {
    await once(process.stdout, "drain");
  }
}

if (observedTests === 0) {
  console.error(
    `Node test runner executed zero tests for ${files.length} explicit test file(s).`,
  );
  process.exitCode = 1;
} else if (failedTests > 0) {
  process.exitCode = 1;
}
