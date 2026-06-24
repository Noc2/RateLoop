import { describe, expect, it } from "vitest";
import {
  buildHeadToHeadAbTitle,
  getHeadToHeadAbTitleLengthError,
  getHeadToHeadAbTitleValidationError,
  isHeadToHeadAbAutoTitle,
} from "../headToHeadTitle.js";

describe("headToHeadTitle", () => {
  it("builds the canonical A/B question title", () => {
    expect(buildHeadToHeadAbTitle("Codex", "Claude")).toBe("Do you prefer A = Codex or B = Claude?");
  });

  it("validates the canonical title", () => {
    expect(getHeadToHeadAbTitleValidationError("Do you prefer A = Codex or B = Claude?", "Codex", "Claude")).toBeNull();
  });

  it("accepts open wording when both option markers are present", () => {
    expect(getHeadToHeadAbTitleValidationError("Do you A = Hermes or B = OpenClaw?", "Hermes", "OpenClaw")).toBeNull();
    expect(
      getHeadToHeadAbTitleValidationError(
        "For coding work, do you prefer A = Codex or B = Claude?",
        "Codex",
        "Claude",
      ),
    ).toBeNull();
  });

  it("rejects titles that omit one or both option markers", () => {
    expect(getHeadToHeadAbTitleValidationError("Which agent do you prefer for coding work?", "Codex", "Claude")).toBe(
      "Include both option names in the question, e.g. A = Codex and B = Claude.",
    );
    expect(getHeadToHeadAbTitleValidationError("Do you prefer A = Codex?", "Codex", "Claude")).toBe(
      "Include both option names in the question, e.g. A = Codex and B = Claude.",
    );
  });

  it("rejects vote-up-if phrasing", () => {
    expect(getHeadToHeadAbTitleValidationError("Vote up if you prefer Codex", "Codex", "Claude")).toBe(
      "Head-to-head titles should ask which option voters prefer. Avoid vote-up-if phrasing.",
    );
  });

  it("returns null for labels within platform limits", () => {
    expect(getHeadToHeadAbTitleLengthError("A".repeat(32), "B".repeat(32))).toBeNull();
  });

  it("flags canonical titles that exceed the max length", () => {
    expect(getHeadToHeadAbTitleLengthError("A".repeat(50), "B".repeat(50))).toMatch(/shorten option names/);
  });

  it("treats empty or canonical titles as auto-fill candidates", () => {
    expect(isHeadToHeadAbAutoTitle("", "Codex", "Claude")).toBe(true);
    expect(isHeadToHeadAbAutoTitle("Do you prefer A = Codex or B = Claude?", "Codex", "Claude")).toBe(true);
    expect(isHeadToHeadAbAutoTitle("Do you A = Codex or B = Claude?", "Codex", "Claude")).toBe(false);
  });
});
