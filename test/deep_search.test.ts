import assert from "node:assert/strict";
import { test } from "node:test";
import { deepSearchItems, matchesDeepSearch } from "../src/homebox/deepSearch.js";

const item = {
  name: "Camera",
  purchaseFrom: "Downtown Photo Shop",
  purchasePrice: 749.99,
  insured: true,
  fields: [{ name: "Sensor Format", type: "text", textValue: "Full Frame", numberValue: 0 }],
};

test("deep text search inspects standard and custom field values", () => {
  assert.equal(matchesDeepSearch(item, "downtown"), true);
  assert.equal(matchesDeepSearch(item, "full frame"), true);
  assert.equal(matchesDeepSearch(item, "missing"), false);
});

test("numeric comparisons also accept ISO dates", () => {
  assert.equal(
    matchesDeepSearch(
      { purchaseDate: "2025-06-15" },
      undefined,
      [{ field: "purchaseDate", operator: "gte", value: "2025-01-01" }],
    ),
    true,
  );
});

test("deep inventory scan deduplicates IDs, batches details, and paginates matches", async () => {
  const detailRequests: string[] = [];
  const client = {
    async get(path: string, query?: Record<string, unknown>): Promise<any> {
      if (path === "/v1/entities") {
        assert.equal(query?.includeArchived, true);
        return { items: [{ id: "one" }, { id: "one" }, { id: "two" }], total: 2 };
      }
      detailRequests.push(path);
      return path.endsWith("one")
        ? { id: "one", purchaseFrom: "Shop", entityType: { isLocation: false } }
        : { id: "two", purchaseFrom: "Elsewhere", entityType: { isLocation: false } };
    },
  };

  const result = await deepSearchItems(
    client,
    {},
    { includeArchived: true, filters: [{ field: "purchaseFrom", operator: "contains", value: "shop" }] },
    1,
    25,
  );
  assert.deepEqual(detailRequests.sort(), ["/v1/entities/one", "/v1/entities/two"]);
  assert.deepEqual(result, {
    items: [{ id: "one", purchaseFrom: "Shop", entityType: { isLocation: false } }],
    page: 1,
    pageSize: 25,
    total: 1,
    scanned: 2,
    deepSearch: true,
  });
});

test("deep filters support numeric comparisons and custom field names", () => {
  assert.equal(
    matchesDeepSearch(item, undefined, [
      { field: "purchasePrice", operator: "gte", value: 700 },
      { field: "Sensor Format", operator: "equals", value: "full frame" },
    ]),
    true,
  );
  assert.equal(
    matchesDeepSearch(item, undefined, [{ field: "purchasePrice", operator: "lt", value: 500 }]),
    false,
  );
});

test("deep filters can use any-match semantics", () => {
  assert.equal(
    matchesDeepSearch(
      item,
      undefined,
      [
        { field: "purchaseFrom", operator: "contains", value: "unknown" },
        { field: "insured", operator: "equals", value: true },
      ],
      "any",
    ),
    true,
  );
});
