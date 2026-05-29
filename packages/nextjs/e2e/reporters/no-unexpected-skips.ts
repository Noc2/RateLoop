import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

type SkippedTest = {
  location: string;
  reason: string;
  title: string;
};

function formatLocation(test: TestCase): string {
  const { file, line, column } = test.location;
  return `${file}:${line}:${column}`;
}

export default class NoUnexpectedSkipsReporter implements Reporter {
  private skippedTests: SkippedTest[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status !== "skipped") return;

    const reason =
      result.annotations.find(annotation => annotation.type === "skip")?.description ??
      test.annotations.find(annotation => annotation.type === "skip")?.description ??
      "no reason provided";

    this.skippedTests.push({
      location: formatLocation(test),
      reason,
      title: test.titlePath().filter(Boolean).join(" > "),
    });
  }

  async onEnd(result: FullResult) {
    if (this.skippedTests.length === 0 || process.env.E2E_ALLOW_SKIPS === "1") {
      return;
    }

    const formattedSkips = this.skippedTests
      .map(({ location, reason, title }) => `  - ${title}\n    ${location}\n    ${reason}`)
      .join("\n");

    console.error(
      [
        "",
        `Unexpected Playwright skips detected (${this.skippedTests.length}).`,
        "Required E2E tests must either pass, fail, or move to an explicit optional command with E2E_ALLOW_SKIPS=1.",
        formattedSkips,
        "",
      ].join("\n"),
    );

    if (result.status === "passed") {
      return { status: "failed" as const };
    }
  }
}
