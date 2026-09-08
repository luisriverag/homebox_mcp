import assert from "node:assert/strict";
import { test } from "node:test";
import { homebox } from "../src/homebox/client.js";
import { reportingTools } from "../src/tools/reporting.js";
import { isToolContentResult } from "../src/tools/types.js";

function tool(name: string) {
  const found = reportingTools.find((t) => t.name === name);
  assert.ok(found, `tool ${name} not found`);
  return found!;
}

function mockHomebox() {
  const originalGet = homebox.get.bind(homebox);
  homebox.get = (async (path: string, query?: any) => {
    if (path === "/v1/entities") {
      if (query?.isLocation === true) return { items: [] };
      if (query?.page > 1) return { items: [] };
      return { items: [{ id: "item-1", name: "Drill", entityType: { isLocation: false } }] };
    }
    if (path === "/v1/entities/item-1") {
      return { id: "item-1", name: "Drill", purchasePrice: 42, purchaseDate: "2024-03-01", purchaseFrom: "Amazon", tags: [] };
    }
    if (path === "/v1/tags") return [];
    throw new Error(`Unexpected GET ${path}`);
  }) as typeof homebox.get;
  return () => {
    homebox.get = originalGet;
  };
}

test("reporting_bill_of_materials still works after moving out of misc.ts", async () => {
  const original = homebox.request.bind(homebox);
  homebox.request = (async (method: string, path: string) => {
    assert.equal(method, "GET");
    assert.equal(path, "/v1/reporting/bill-of-materials");
    return "id,name\n1,Drill";
  }) as typeof homebox.request;
  try {
    const result = await tool("reporting_bill_of_materials").handler({});
    assert.equal(result, "id,name\n1,Drill");
  } finally {
    homebox.request = original;
  }
});

test("reporting_spend_summary returns JSON, CSV, and chart images by default", async () => {
  const restore = mockHomebox();
  try {
    const result = await tool("reporting_spend_summary").handler({});
    assert.ok(isToolContentResult(result));
    const content = result as any;
    assert.equal(content.value.totalSpend, 42);
    assert.match(content.value.csv, /vendor,"Amazon",42,1/);
    assert.ok(content.binaries.length > 0);
    for (const binary of content.binaries) {
      assert.equal(binary.mimeType, "image/png");
    }
  } finally {
    restore();
  }
});

test("reporting_spend_summary skips chart rendering when charts=false", async () => {
  const restore = mockHomebox();
  try {
    const result = await tool("reporting_spend_summary").handler({ charts: false });
    assert.equal(isToolContentResult(result), false);
    assert.equal((result as any).totalSpend, 42);
  } finally {
    restore();
  }
});
