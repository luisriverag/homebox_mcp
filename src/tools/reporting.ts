import { z } from "zod";
import { homebox } from "../homebox/client.js";
import { renderBarChartSvg, renderLineChartSvg, svgToPngBuffer } from "../homebox/charts.js";
import { computeSpendSummary, type SpendBucket } from "../homebox/spendReport.js";
import { defineTool, safeId, type ToolContentResult, type ToolDef } from "./types.js";

function toCsv(summary: Awaited<ReturnType<typeof computeSpendSummary>>): string {
  const lines = ["dimension,key,total,count"];
  const dimensions: Array<[string, SpendBucket[]]> = [
    ["vendor", summary.byVendor],
    ["location", summary.byLocation],
    ["tag", summary.byTag],
    ["month", summary.byMonth],
  ];
  for (const [dimension, buckets] of dimensions) {
    for (const bucket of buckets) {
      lines.push(`${dimension},"${bucket.label.replace(/"/g, '""')}",${bucket.total},${bucket.count}`);
    }
  }
  return lines.join("\n");
}

export const reportingTools: ToolDef<any>[] = [
  defineTool({
    name: "reporting_bill_of_materials",
    description: "Export a full bill-of-materials report of the inventory as a CSV string.",
    write: false,
    shape: {},
    handler: () => homebox.request("GET", "/v1/reporting/bill-of-materials", { raw: true }),
  }),

  defineTool({
    name: "reporting_spend_summary",
    description:
      "Analyze purchase spending across the inventory: totals by vendor, location, and tag (equal-split across an item's tags, so a multi-tag item doesn't inflate every one of its tags' totals), plus spend over time by month. Purchase price/date/vendor aren't on the item list endpoint, so this fetches every candidate item's full details -- can be slow on a large inventory; narrow scope with locationIds/tagIds when possible (startDate/endDate can only filter afterward, once purchaseDate is known). Returns structured JSON and a CSV string; unless charts=false, also renders bar charts (vendor/location/tag) and a line chart (spend over time) as native MCP image content.",
    write: false,
    shape: {
      startDate: z.string().optional().describe("ISO date (YYYY-MM-DD), inclusive lower bound on purchaseDate"),
      endDate: z.string().optional().describe("ISO date (YYYY-MM-DD), inclusive upper bound on purchaseDate"),
      locationIds: z.array(safeId).optional().describe("Restrict to items directly under these location IDs"),
      tagIds: z.array(safeId).optional().describe("Restrict to items carrying any of these tag IDs"),
      topN: z.number().int().min(1).max(50).optional().describe("Top N vendors/locations/tags to include. Default 20."),
      charts: z.boolean().optional().describe("Also render PNG bar/line chart images. Default true."),
    },
    handler: async ({ startDate, endDate, locationIds, tagIds, topN = 20, charts = true }: any) => {
      const summary = await computeSpendSummary({ startDate, endDate, locationIds, tagIds }, topN);
      const value = { ...summary, csv: toCsv(summary) };
      if (!charts) return value;

      const chartJobs: Array<{ title: string; svg: string }> = [];
      if (summary.byVendor.length) chartJobs.push({ title: "spend-by-vendor", svg: renderBarChartSvg("Spend by vendor", summary.byVendor) });
      if (summary.byLocation.length)
        chartJobs.push({ title: "spend-by-location", svg: renderBarChartSvg("Spend by location", summary.byLocation) });
      if (summary.byTag.length) chartJobs.push({ title: "spend-by-tag", svg: renderBarChartSvg("Spend by tag", summary.byTag) });
      if (summary.byMonth.length)
        chartJobs.push({ title: "spend-over-time", svg: renderLineChartSvg("Spend over time", summary.byMonth) });

      // The JSON/CSV summary above is already fully computed at this point;
      // a chart-rendering failure (e.g. sharp/fontconfig unavailable in this
      // environment) shouldn't throw it away -- return it chart-less with an
      // explanation instead of discarding a good report over an image step.
      let binaries: ToolContentResult["binaries"] = [];
      try {
        binaries = await Promise.all(
          chartJobs.map(async (job) => ({
            kind: "binary" as const,
            data: (await svgToPngBuffer(job.svg)).toString("base64"),
            mimeType: "image/png",
            uri: `homebox-mcp://reporting/${job.title}.png`,
          })),
        );
      } catch (err) {
        (value as any).chartsError = `Charts could not be rendered: ${err instanceof Error ? err.message : String(err)}`;
      }

      const result: ToolContentResult = { kind: "tool-content", value, binaries };
      return result;
    },
  }),
];
