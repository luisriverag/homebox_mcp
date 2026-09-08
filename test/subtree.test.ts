import assert from "node:assert/strict";
import { test } from "node:test";
import { homebox } from "../src/homebox/client.js";
import { discoverDescendants } from "../src/homebox/subtree.js";

function withMockedGet(handler: (path: string, query?: any) => unknown, run: () => Promise<void>) {
  const original = homebox.get.bind(homebox);
  homebox.get = (async (path: string, query?: any) => handler(path, query)) as typeof homebox.get;
  return run().finally(() => {
    homebox.get = original;
  });
}

test("discoverDescendants walks nested parents breadth-first and dedupes", async () => {
  await withMockedGet((path, query) => {
    if (path === "/v1/entities/root") return { id: "root", name: "Toolbox" };
    if (path === "/v1/entities") {
      const parentIds: string[] = query.parentIds;
      if (query.page > 1) return { items: [] };
      if (parentIds.includes("root")) return { items: [{ id: "drill", name: "Drill" }, { id: "saw", name: "Saw" }] };
      if (parentIds.includes("drill")) return { items: [{ id: "drill-bit", name: "Drill bit" }] };
      return { items: [] };
    }
    throw new Error(`Unexpected request to ${path}`);
  }, async () => {
    const { items, truncated } = await discoverDescendants("root");
    assert.equal(truncated, false);
    assert.deepEqual(
      items.map((item) => item.id).sort(),
      ["drill", "drill-bit", "root", "saw"],
    );
  });
});

test("discoverDescendants stops and reports truncation past maxItems", async () => {
  await withMockedGet((path, query) => {
    if (path === "/v1/entities/root") return { id: "root", name: "Root" };
    if (path === "/v1/entities") {
      if (query.page > 1) return { items: [] };
      const parentIds: string[] = query.parentIds;
      // Every discovered node has exactly one child, forming a long chain.
      return { items: parentIds.map((id: string) => ({ id: `${id}-child`, name: `${id}-child` })) };
    }
    throw new Error(`Unexpected request to ${path}`);
  }, async () => {
    const { items, truncated } = await discoverDescendants("root", 3);
    assert.equal(truncated, true);
    assert.ok(items.length <= 3);
  });
});

test("discoverDescendants returns just the root when it has no children", async () => {
  await withMockedGet((path, query) => {
    if (path === "/v1/entities/root") return { id: "root", name: "Lonely item" };
    if (path === "/v1/entities") return { items: [] };
    throw new Error(`Unexpected request to ${path}`);
  }, async () => {
    const { items, truncated } = await discoverDescendants("root");
    assert.equal(truncated, false);
    assert.deepEqual(items.map((item) => item.id), ["root"]);
  });
});
