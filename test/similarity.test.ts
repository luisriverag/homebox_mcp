import assert from "node:assert/strict";
import { test } from "node:test";
import { findClosestId, levenshtein } from "../src/homebox/similarity.js";

test("levenshtein is zero for identical strings", () => {
  assert.equal(levenshtein("abc", "abc"), 0);
});

test("levenshtein counts a single substitution", () => {
  assert.equal(levenshtein("abcdef", "abcxef"), 1);
});

test("levenshtein counts a single deletion", () => {
  assert.equal(levenshtein("abcdefg", "abcdefg".slice(0, -1)), 1);
});

test("levenshtein counts a single digit substitution", () => {
  assert.equal(levenshtein("011b", "010b"), 1);
});

test("findClosestId returns the nearest real id within the distance budget", () => {
  const candidates = [
    { id: "fafa322e-e1a9-481c-b5b6-a32ffa5bf33f", name: "Nevera LG Electronics GSJ760PZUZ" },
    { id: "3ee1ea2a-2f7d-4d71-9c73-daf6c47da1b7", name: "Nevera Redbull" },
  ];

  const result = findClosestId("fafa322e-e1a9-481c-b5b6-a3tan5bf33f", candidates);

  assert.deepEqual(result, candidates[0]);
});

test("findClosestId matches a truncated id (missing trailing character)", () => {
  const candidates = [{ id: "3ee1ea2a-2f7d-4d71-9c73-daf6c47da1b7", name: "Nevera Redbull" }];

  const result = findClosestId("3ee1ea2a-2f7d-4d71-9c73-daf6c47da1b", candidates);

  assert.deepEqual(result, candidates[0]);
});

test("findClosestId returns undefined when nothing is close enough", () => {
  const candidates = [{ id: "fafa322e-e1a9-481c-b5b6-a32ffa5bf33f", name: "Nevera LG" }];

  // A completely unrelated/fabricated id -- not a plausible typo of the candidate.
  const result = findClosestId("946812d0-36dc-470e-bba4-e7c2842649ee", candidates);

  assert.equal(result, undefined);
});

test("findClosestId ignores an exact match (that id wouldn't be erroring)", () => {
  const candidates = [{ id: "fafa322e-e1a9-481c-b5b6-a32ffa5bf33f", name: "Nevera LG" }];

  const result = findClosestId("fafa322e-e1a9-481c-b5b6-a32ffa5bf33f", candidates);

  assert.equal(result, undefined);
});

test("findClosestId returns undefined for an empty candidate list", () => {
  assert.equal(findClosestId("anything", []), undefined);
});
