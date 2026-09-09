import assert from "node:assert/strict";
import { test } from "node:test";
import { HomeboxApiError, homebox } from "../src/homebox/client.js";
import { labelTools } from "../src/tools/labels.js";
import { isToolContentResult } from "../src/tools/types.js";

function tool(name: string) {
  const found = labelTools.find((t) => t.name === name);
  assert.ok(found, `tool ${name} not found`);
  return found!;
}

test("labels_generate_qr_sheet resolves ids, renders a PDF, and reports a count", async () => {
  const original = homebox.get.bind(homebox);
  homebox.get = (async (path: string) => {
    if (path === "/v1/entities/item-1") return { id: "item-1", name: "Drill", entityType: { isLocation: false } };
    throw new Error(`Unexpected GET ${path}`);
  }) as typeof homebox.get;

  try {
    const result = await tool("labels_generate_qr_sheet").handler({
      itemIds: ["item-1"],
      urls: ["https://example.com/location/loc-2"],
    });
    assert.ok(isToolContentResult(result));
    const content = result as any;
    assert.equal(content.value.labelCount, 2);
    assert.equal(content.binaries.length, 1);
    assert.equal(content.binaries[0].mimeType, "application/pdf");
    const pdfHeader = Buffer.from(content.binaries[0].data, "base64").subarray(0, 5).toString("ascii");
    assert.equal(pdfHeader, "%PDF-");
  } finally {
    homebox.get = original;
  }
});

test("labels_generate_qr_sheet rejects a call with no items/locations/urls", async () => {
  await assert.rejects(
    () => tool("labels_generate_qr_sheet").handler({}),
    /Provide at least one/,
  );
});

test("labels_generate_qr_sheet skips a deleted id and still renders the rest", async () => {
  const original = homebox.get.bind(homebox);
  homebox.get = (async (path: string) => {
    if (path === "/v1/entities/item-1") return { id: "item-1", name: "Drill", entityType: { isLocation: false } };
    if (path === "/v1/entities/gone") throw new HomeboxApiError(404, path, { error: "not found" });
    throw new Error(`Unexpected GET ${path}`);
  }) as typeof homebox.get;

  try {
    const result = await tool("labels_generate_qr_sheet").handler({
      itemIds: ["item-1", "gone"],
    });
    assert.ok(isToolContentResult(result));
    const content = result as any;
    assert.equal(content.value.labelCount, 1);
    assert.deepEqual(content.value.skippedNotFound, ["gone"]);
  } finally {
    homebox.get = original;
  }
});
