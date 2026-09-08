import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { config } from "../src/config.js";
import { homebox } from "../src/homebox/client.js";
import { generateLabelSheetPdf, resolveEntityLabelEntries, urlLabelEntries } from "../src/homebox/labelSheet.js";

test("urlLabelEntries infers kind from the URL path and ignores blank lines", () => {
  const entries = urlLabelEntries([
    "https://example.com/item/abc",
    "https://example.com/location/def",
    "https://example.com/other/ghi",
    "  ",
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["item", "location", "url"],
  );
  assert.equal(entries.length, 3);
});

test("resolveEntityLabelEntries builds web URLs and uses the entity name as caption", async () => {
  const original = homebox.get.bind(homebox);
  homebox.get = (async (path: string) => {
    if (path === "/v1/entities/item-1") return { id: "item-1", name: "Drill", entityType: { isLocation: false } };
    if (path === "/v1/entities/loc-1") return { id: "loc-1", name: "Garage", entityType: { isLocation: true } };
    throw new Error(`Unexpected path ${path}`);
  }) as typeof homebox.get;

  try {
    const entries = await resolveEntityLabelEntries(["item-1", "loc-1"]);
    assert.deepEqual(entries, [
      { url: `${config.homebox.webUrl}/item/item-1`, caption: "Drill", kind: "item" },
      { url: `${config.homebox.webUrl}/location/loc-1`, caption: "Garage", kind: "location" },
    ]);
  } finally {
    homebox.get = original;
  }
});

test("generateLabelSheetPdf produces valid PDF bytes for a handful of entries", async () => {
  const bytes = await generateLabelSheetPdf(
    [
      { url: "https://example.com/item/a", caption: "Item A", kind: "item" },
      { url: "https://example.com/location/b", caption: "Location B", kind: "location" },
    ],
    { cols: 5, brandingText: "Test Household" },
  );
  const header = Buffer.from(bytes.slice(0, 5)).toString("ascii");
  assert.equal(header, "%PDF-");
  assert.ok(bytes.byteLength > 500);
});

test("generateLabelSheetPdf rejects an empty entry list", async () => {
  await assert.rejects(() => generateLabelSheetPdf([]), /No label entries/);
});

test("generateLabelSheetPdf spans multiple pages once entries exceed one page's capacity", async () => {
  const manyEntries = Array.from({ length: 60 }, (_, i) => ({
    url: `https://example.com/item/${i}`,
    caption: `Item ${i}`,
    kind: "item" as const,
  }));
  const bytes = await generateLabelSheetPdf(manyEntries, { cols: 5 });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2);
});
