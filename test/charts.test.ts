import assert from "node:assert/strict";
import { test } from "node:test";
import { renderBarChartSvg, renderLineChartSvg, svgToPngBuffer } from "../src/homebox/charts.js";
import type { SpendBucket } from "../src/homebox/spendReport.js";

const BUCKETS: SpendBucket[] = [
  { key: "a", label: "Home Depot", total: 160, count: 2 },
  { key: "b", label: "Amazon", total: 20, count: 1 },
];

test("renderBarChartSvg includes the title and bucket labels", () => {
  const svg = renderBarChartSvg("Spend by vendor", BUCKETS);
  assert.match(svg, /<svg/);
  assert.match(svg, /Spend by vendor/);
  assert.match(svg, /Home Depot/);
  assert.match(svg, /Amazon/);
});

test("renderBarChartSvg escapes label text to avoid breaking the XML", () => {
  const svg = renderBarChartSvg("Title", [{ key: "x", label: "A & B <script>", total: 1, count: 1 }]);
  assert.doesNotMatch(svg, /A & B <script>/);
  assert.match(svg, /A &amp; B/);
});

test("renderLineChartSvg includes the title and chronological points", () => {
  const svg = renderLineChartSvg("Spend over time", [
    { key: "2024-01", label: "2024-01", total: 120, count: 2 },
    { key: "2024-02", label: "2024-02", total: 60, count: 1 },
  ]);
  assert.match(svg, /Spend over time/);
  assert.match(svg, /<path /);
});

test("svgToPngBuffer produces a valid PNG", async () => {
  const svg = renderBarChartSvg("Test", BUCKETS);
  const png = await svgToPngBuffer(svg);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});
