import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseExpertiseCoveredPanel,
  normalizeExpertiseSeatRequirements,
  panelSatisfiesExpertiseCoverage,
  summarizeExpertiseCoverage,
} from "~~/lib/tokenless/reviewerExpertiseCoverage";

test("one reviewer can cover overlapping expertise requirements", () => {
  const candidates = [
    { id: "reviewer_a", expertiseKeys: ["typescript", "security"] },
    { id: "reviewer_b", expertiseKeys: [] },
  ];
  const requirements = [
    { key: "security", minimumSeats: 1 },
    { key: "typescript", minimumSeats: 1 },
  ];
  assert.deepEqual(chooseExpertiseCoveredPanel(candidates, 2, requirements), ["reviewer_a", "reviewer_b"]);
  assert.equal(panelSatisfiesExpertiseCoverage(["reviewer_a", "reviewer_b"], candidates, requirements), true);
});

test("per-requirement supply does not create a false-positive panel", () => {
  const candidates = [
    { id: "typescript_a", expertiseKeys: ["typescript"] },
    { id: "typescript_b", expertiseKeys: ["typescript"] },
    { id: "security_a", expertiseKeys: ["security"] },
    { id: "security_b", expertiseKeys: ["security"] },
  ];
  assert.equal(
    chooseExpertiseCoveredPanel(candidates, 2, [
      { key: "typescript", minimumSeats: 2 },
      { key: "security", minimumSeats: 2 },
    ]),
    null,
  );
});

test("minimum seat requirements count distinct reviewers", () => {
  const candidates = [
    { id: "reviewer_a", expertiseKeys: ["security", "security"] },
    { id: "reviewer_b", expertiseKeys: ["security"] },
    { id: "reviewer_c", expertiseKeys: [] },
  ];
  const requirements = [{ key: "security", minimumSeats: 2 }];
  assert.deepEqual(chooseExpertiseCoveredPanel(candidates, 2, requirements), ["reviewer_a", "reviewer_b"]);
  assert.deepEqual(summarizeExpertiseCoverage(["reviewer_a", "reviewer_b"], candidates, requirements), [
    { key: "security", minimumSeats: 2, coveredSeats: 2, satisfied: true },
  ]);
});

test("insufficient specialist supply fails closed", () => {
  assert.equal(
    chooseExpertiseCoveredPanel(
      [
        { id: "reviewer_a", expertiseKeys: ["privacy"] },
        { id: "reviewer_b", expertiseKeys: [] },
      ],
      2,
      [{ key: "privacy", minimumSeats: 2 }],
    ),
    null,
  );
});

test("general seats are filled deterministically after specialist coverage", () => {
  const candidates = [
    { id: "reviewer_d", expertiseKeys: [] },
    { id: "reviewer_c", expertiseKeys: ["typescript"] },
    { id: "reviewer_b", expertiseKeys: [] },
    { id: "reviewer_a", expertiseKeys: [] },
  ];
  assert.deepEqual(chooseExpertiseCoveredPanel(candidates, 3, [{ key: "typescript", minimumSeats: 1 }]), [
    "reviewer_a",
    "reviewer_b",
    "reviewer_c",
  ]);
});

test("requirements normalize by key and reject duplicate or invalid seat rules", () => {
  assert.deepEqual(
    normalizeExpertiseSeatRequirements(
      [
        { key: " typescript ", minimumSeats: 1 },
        { key: "security", minimumSeats: 2 },
      ],
      2,
    ),
    [
      { key: "security", minimumSeats: 2 },
      { key: "typescript", minimumSeats: 1 },
    ],
  );
  assert.throws(
    () =>
      normalizeExpertiseSeatRequirements(
        [
          { key: "security", minimumSeats: 1 },
          { key: " security ", minimumSeats: 1 },
        ],
        2,
      ),
    /unique/u,
  );
  assert.throws(() => normalizeExpertiseSeatRequirements([{ key: "security", minimumSeats: 3 }], 2), /1 to 2/u);
});
