import { z } from "zod";
import { homebox } from "../homebox/client.js";
import { defineTool, safeId, type ToolDef } from "./types.js";

export const miscTools: ToolDef<any>[] = [
  defineTool({
    name: "status_get",
    description: "Get the Homebox server status/version/health info.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/status"),
  }),

  defineTool({
    name: "currency_list",
    description: "List the currencies Homebox supports.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/currencies"),
  }),

  defineTool({
    name: "assets_get_by_id",
    description: "Look up an item by its short numeric asset ID (as printed on asset labels/QR codes).",
    write: false,
    shape: { assetId: safeId.describe("Asset ID, e.g. \"000-001\"") },
    handler: ({ assetId }) => homebox.get(`/v1/assets/${assetId}`),
  }),

  defineTool({
    name: "qrcode_generate",
    description: "Generate a QR code image encoding the given data. Returns native MCP image content.",
    write: false,
    shape: { data: z.string().describe("Data to encode, e.g. a Homebox item URL") },
    handler: ({ data }) => homebox.request("GET", "/v1/qrcode", { query: { data }, binary: true }),
  }),

  defineTool({
    name: "reporting_bill_of_materials",
    description: "Export a full bill-of-materials report of the inventory as a CSV string.",
    write: false,
    shape: {},
    handler: () => homebox.request("GET", "/v1/reporting/bill-of-materials", { raw: true }),
  }),
];
