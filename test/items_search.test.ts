import assert from "node:assert/strict";
import test from "node:test";
import { homebox } from "../src/homebox/client.js";
import { itemTools } from "../src/tools/items.js";

test("items_list searches discovered tag IDs independently without listing tags again", async () => {
  const calls: Array<{ path: string; query: any }> = [];
  const originalGet = homebox.get.bind(homebox);
  homebox.get = (async (path: string, query?: any) => {
    calls.push({ path, query });
    if (path === "/v1/tags") return [{ id: "helmet-tag", name: "Helmet" }];
    if (query?.q) return { items: [{ id: "text-result", entityType: { isLocation: false } }] };
    if (query?.tags) return { items: [{ id: "tag-result", entityType: { isLocation: false } }] };
    throw new Error(`Unexpected request to ${path}`);
  }) as typeof homebox.get;

  try {
    const itemsList = itemTools.find((tool) => tool.name === "items_list");
    assert.ok(itemsList);
    const result = (await itemsList.handler({
      q: "motorbike",
      relatedTagIds: ["motorcycle-tag"],
    })) as any;

    assert.deepEqual(calls, [
      { path: "/v1/entities", query: { q: "motorbike" } },
      { path: "/v1/entities", query: { tags: ["motorcycle-tag"] } },
    ]);
    assert.deepEqual(result.items.map((item: any) => item.id), ["text-result", "tag-result"]);
    assert.deepEqual(result.searchedTagIds, ["motorcycle-tag"]);
    assert.deepEqual(result.matchedTags, []);

    calls.length = 0;
    const filtered = (await itemsList.handler({
      q: "motorbike",
      tags: ["strict-tag"],
      relatedTagIds: ["ignored-related-tag"],
    })) as any;
    assert.deepEqual(calls, [
      { path: "/v1/entities", query: { q: "motorbike", tags: ["strict-tag"] } },
    ]);
    assert.deepEqual(filtered.searchedTagIds, []);

    calls.length = 0;
    const combined = (await itemsList.handler({
      relatedTagIds: ["motorcycle-tag"],
      tagNames: ["helmet"],
    })) as any;
    assert.deepEqual(calls, [
      { path: "/v1/tags", query: undefined },
      { path: "/v1/entities", query: { tags: ["motorcycle-tag"] } },
      { path: "/v1/entities", query: { tags: ["helmet-tag"] } },
    ]);
    assert.deepEqual(combined.searchedTagIds, ["motorcycle-tag", "helmet-tag"]);
    assert.deepEqual(combined.matchedTags, [{ id: "helmet-tag", name: "Helmet" }]);
  } finally {
    homebox.get = originalGet;
  }
});
