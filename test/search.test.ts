import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchTerms, findRelevantTags, mergeEntitySearchResults } from "../src/homebox/search.js";

test("expands bicycle names in both English and Spanish", () => {
  assert.deepEqual(buildSearchTerms("bici"), ["bici", "bike", "bicycle", "bicicleta"]);
  assert.deepEqual(buildSearchTerms("bike"), ["bike", "bicycle", "bici", "bicicleta"]);
});

test("combines supplied names without case or accent duplicates", () => {
  assert.deepEqual(buildSearchTerms("lámpara", ["lamp", "LAMP", "lampara"]), ["lámpara", "lamp"]);
});

test("expands known aliases found in phrases", () => {
  assert.deepEqual(buildSearchTerms("red bike"), [
    "red bike",
    "red bicycle",
    "red bici",
    "red bicicleta",
  ]);
});

test("finds discovered tags by complete names in supplied search terms", () => {
  const tags = [
    { id: "1", name: "Motorcycle" },
    { id: "2", name: "Art" },
    { id: "3", name: "Bike Parts" },
    { id: 4, name: "invalid" },
  ];
  assert.deepEqual(findRelevantTags(tags, ["motorbike", "Motorcycle"]), [
    { id: "1", name: "Motorcycle" },
  ]);
  assert.deepEqual(findRelevantTags({ items: tags }, ["cart"]), []);
});

test("expands a known caller-provided translation", () => {
  assert.deepEqual(buildSearchTerms("vélo", ["bici"]), [
    "vélo",
    "bici",
    "bike",
    "bicycle",
    "bicicleta",
  ]);
});

test("merges result pages by entity ID and records the attempted terms", () => {
  const merged = mergeEntitySearchResults(
    [{ items: [{ id: "1" }, { id: "2" }] }, { items: [{ id: "2" }, { id: "3" }] }],
    ["bike", "bici"],
  );
  assert.deepEqual(merged.items.map((item: any) => item.id), ["1", "2", "3"]);
  assert.deepEqual(merged.searchTerms, ["bike", "bici"]);
});
