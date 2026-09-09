import { z } from "zod";
import { generateLabelSheetPdf, resolveEntityLabelEntries, urlLabelEntries, type LabelEntry } from "../homebox/labelSheet.js";
import { defineTool, safeId, type ToolContentResult, type ToolDef } from "./types.js";

export const labelTools: ToolDef<any>[] = [
  defineTool({
    name: "labels_generate_qr_sheet",
    description:
      "Generate a printable A4 PDF of QR-code labels, one per item/location/URL, laid out in a grid (default 5 per row, as many rows as fit the page). Each label shows a QR code linking to the entity's Homebox web page, a small glyph (circle=item, square=location), and its name as a caption. Supply itemIds and/or locationIds to resolve names automatically, or raw urls for a hand-picked list (e.g. from a prior search). Returns the PDF as native MCP document content alongside a JSON summary.",
    write: false,
    shape: {
      itemIds: z.array(safeId).max(500).optional().describe("Item UUIDs to include"),
      locationIds: z.array(safeId).max(500).optional().describe("Location UUIDs to include"),
      urls: z
        .array(z.string().url())
        .max(500)
        .optional()
        .describe("Raw Homebox web-UI URLs to include directly, in addition to itemIds/locationIds"),
      cols: z.number().int().min(1).max(10).optional().describe("Labels per row on the page. Default 5."),
      brandingText: z.string().max(120).optional().describe("Extra text appended to every label's caption, e.g. a household name"),
    },
    handler: async ({ itemIds = [], locationIds = [], urls = [], cols, brandingText }) => {
      const { entries: resolvedEntries, notFound } = await resolveEntityLabelEntries([
        ...itemIds,
        ...locationIds,
      ]);
      const entries: LabelEntry[] = [...resolvedEntries, ...urlLabelEntries(urls)];
      if (entries.length === 0) {
        throw new Error(
          notFound.length > 0
            ? `None of the given itemIds/locationIds exist anymore: ${notFound.join(", ")}`
            : "Provide at least one of itemIds, locationIds, or urls.",
        );
      }
      const pdfBytes = await generateLabelSheetPdf(entries, { cols, brandingText });
      const base64 = Buffer.from(pdfBytes).toString("base64");
      const result: ToolContentResult = {
        kind: "tool-content",
        value: {
          labelCount: entries.length,
          cols: cols ?? 5,
          sizeBytes: pdfBytes.byteLength,
          ...(notFound.length > 0 ? { skippedNotFound: notFound } : {}),
        },
        binaries: [
          {
            kind: "binary",
            data: base64,
            mimeType: "application/pdf",
            uri: "homebox-mcp://labels/qr-sheet.pdf",
          },
        ],
      };
      return result;
    },
  }),
];
