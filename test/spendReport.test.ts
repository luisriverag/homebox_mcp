import assert from "node:assert/strict";
import { test } from "node:test";
import { homebox } from "../src/homebox/client.js";
import { computeSpendSummary } from "../src/homebox/spendReport.js";

const ITEMS: Record<string, any> = {
  drill: {
    id: "drill",
    name: "Drill",
    purchasePrice: 100,
    purchaseDate: "2024-01-15",
    purchaseFrom: "Home Depot",
    parent: { id: "garage" },
    tags: [{ id: "tools-tag" }],
  },
  saw: {
    id: "saw",
    name: "Saw",
    purchasePrice: 60,
    purchaseDate: "2024-02-10",
    purchaseFrom: "Home Depot",
    parent: { id: "garage" },
    tags: [{ id: "tools-tag" }, { id: "power-tag" }],
  },
  book: {
    id: "book",
    name: "Book",
    purchasePrice: 20,
    purchaseDate: "2024-01-05",
    purchaseFrom: "Amazon",
    parent: { id: "office" },
    tags: [],
  },
  freebie: {
    id: "freebie",
    name: "Freebie",
    // No purchase price -- should be excluded entirely.
    parent: { id: "garage" },
    tags: [],
  },
};

function mockHomebox() {
  const originalGet = homebox.get.bind(homebox);
  homebox.get = (async (path: string, query?: any) => {
    if (path === "/v1/entities") {
      if (query?.isLocation === true) {
        return { items: [{ id: "garage", name: "Garage" }, { id: "office", name: "Office" }] };
      }
      if (query?.page && query.page > 1) return { items: [] };
      return { items: Object.values(ITEMS).map(({ id, name }) => ({ id, name, entityType: { isLocation: false } })) };
    }
    if (path.startsWith("/v1/entities/")) {
      const id = path.split("/").pop()!;
      return ITEMS[id];
    }
    if (path === "/v1/tags") {
      return [{ id: "tools-tag", name: "Tools" }, { id: "power-tag", name: "Power" }];
    }
    throw new Error(`Unexpected request to ${path}`);
  }) as typeof homebox.get;
  return () => {
    homebox.get = originalGet;
  };
}

test("computeSpendSummary totals spend and excludes items with no purchase price", async () => {
  const restore = mockHomebox();
  try {
    const summary = await computeSpendSummary({});
    assert.equal(summary.scanned, 4);
    assert.equal(summary.matched, 3);
    assert.equal(summary.totalSpend, 180);
  } finally {
    restore();
  }
});

test("computeSpendSummary groups by vendor", async () => {
  const restore = mockHomebox();
  try {
    const summary = await computeSpendSummary({});
    const homeDepot = summary.byVendor.find((bucket) => bucket.label === "Home Depot");
    assert.ok(homeDepot);
    assert.equal(homeDepot!.total, 160);
    assert.equal(homeDepot!.count, 2);
  } finally {
    restore();
  }
});

test("computeSpendSummary groups by location using resolved names", async () => {
  const restore = mockHomebox();
  try {
    const summary = await computeSpendSummary({});
    const garage = summary.byLocation.find((bucket) => bucket.label === "Garage");
    assert.ok(garage);
    assert.equal(garage!.total, 160);
  } finally {
    restore();
  }
});

test("computeSpendSummary equal-splits spend across an item's multiple tags", async () => {
  const restore = mockHomebox();
  try {
    const summary = await computeSpendSummary({});
    const tools = summary.byTag.find((bucket) => bucket.label === "Tools");
    const power = summary.byTag.find((bucket) => bucket.label === "Power");
    // drill (100, 1 tag) contributes 100 to Tools.
    // saw (60, 2 tags) contributes 30 to each of Tools and Power.
    assert.equal(tools!.total, 130);
    assert.equal(power!.total, 30);
  } finally {
    restore();
  }
});

test("computeSpendSummary filters by date range", async () => {
  const restore = mockHomebox();
  try {
    const summary = await computeSpendSummary({ startDate: "2024-02-01" });
    assert.equal(summary.matched, 1);
    assert.equal(summary.totalSpend, 60);
  } finally {
    restore();
  }
});

test("computeSpendSummary buckets spend by month chronologically", async () => {
  const restore = mockHomebox();
  try {
    const summary = await computeSpendSummary({});
    assert.deepEqual(
      summary.byMonth.map((bucket) => bucket.key),
      ["2024-01", "2024-02"],
    );
    assert.equal(summary.byMonth[0].total, 120); // drill + book
    assert.equal(summary.byMonth[1].total, 60); // saw
  } finally {
    restore();
  }
});
