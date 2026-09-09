import assert from "node:assert/strict";
import test from "node:test";
import { homebox } from "../src/homebox/client.js";
import { itemTools } from "../src/tools/items.js";
import { locationTools } from "../src/tools/locations.js";

function itemTool(name: string) {
  const found = itemTools.find((t) => t.name === name);
  assert.ok(found, `item tool ${name} not found`);
  return found!;
}

function locationTool(name: string) {
  const found = locationTools.find((t) => t.name === name);
  assert.ok(found, `location tool ${name} not found`);
  return found!;
}

const LOCATION = { id: "loc-1", name: "Garage", entityType: { isLocation: true } };
const ITEM = { id: "item-1", name: "Drill", entityType: { isLocation: false } };

function withMockedGet(byId: Record<string, unknown>, run: () => Promise<void>) {
  const original = homebox.get.bind(homebox);
  homebox.get = (async (path: string) => {
    const id = path.replace("/v1/entities/", "");
    if (id in byId) return byId[id];
    throw new Error(`Unexpected GET ${path}`);
  }) as typeof homebox.get;
  return run().finally(() => {
    homebox.get = original;
  });
}

test("items_get refuses a location id", async () => {
  await withMockedGet({ "loc-1": LOCATION }, async () => {
    await assert.rejects(() => itemTool("items_get").handler({ id: "loc-1" }), /is an entity of type "location", not "item"/);
  });
});

test("items_patch refuses a location id and never patches it", async () => {
  const originalPatch = homebox.patch.bind(homebox);
  homebox.patch = (async () => {
    throw new Error("must not patch a location");
  }) as typeof homebox.patch;

  await withMockedGet({ "loc-1": LOCATION }, async () => {
    await assert.rejects(() => itemTool("items_patch").handler({ id: "loc-1" }), /is an entity of type "location", not "item"/);
  }).finally(() => {
    homebox.patch = originalPatch;
  });
});

test("items_delete refuses a location id and never deletes it", async () => {
  const originalDelete = homebox.delete.bind(homebox);
  homebox.delete = (async () => {
    throw new Error("must not delete a location");
  }) as typeof homebox.delete;

  await withMockedGet({ "loc-1": LOCATION }, async () => {
    await assert.rejects(() => itemTool("items_delete").handler({ id: "loc-1" }), /is an entity of type "location", not "item"/);
  }).finally(() => {
    homebox.delete = originalDelete;
  });
});

test("items_update refuses a location id", async () => {
  await withMockedGet({ "loc-1": LOCATION }, async () => {
    await assert.rejects(
      () => itemTool("items_update").handler({ id: "loc-1", name: "New name" }),
      /is an entity of type "location", not "item"/,
    );
  });
});

test("locations_get refuses an item id", async () => {
  await withMockedGet({ "item-1": ITEM }, async () => {
    await assert.rejects(() => locationTool("locations_get").handler({ id: "item-1" }), /is an entity of type "item", not "location"/);
  });
});

test("locations_delete refuses an item id and never deletes it", async () => {
  const originalDelete = homebox.delete.bind(homebox);
  homebox.delete = (async () => {
    throw new Error("must not delete an item");
  }) as typeof homebox.delete;

  await withMockedGet({ "item-1": ITEM }, async () => {
    await assert.rejects(
      () => locationTool("locations_delete").handler({ id: "item-1" }),
      /is an entity of type "item", not "location"/,
    );
  }).finally(() => {
    homebox.delete = originalDelete;
  });
});

test("locations_update refuses an item id", async () => {
  await withMockedGet({ "item-1": ITEM }, async () => {
    await assert.rejects(
      () => locationTool("locations_update").handler({ id: "item-1", name: "New name" }),
      /is an entity of type "item", not "location"/,
    );
  });
});

test("items_get accepts a real item id", async () => {
  await withMockedGet({ "item-1": ITEM }, async () => {
    const result = (await itemTool("items_get").handler({ id: "item-1" })) as any;
    assert.equal(result.id, "item-1");
  });
});

test("locations_get accepts a real location id", async () => {
  await withMockedGet({ "loc-1": LOCATION }, async () => {
    const result = (await locationTool("locations_get").handler({ id: "loc-1" })) as any;
    assert.equal(result.id, "loc-1");
  });
});
