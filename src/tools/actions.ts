import { homebox } from "../homebox/client.js";
import { defineTool, type ToolDef } from "./types.js";

export const actionTools: ToolDef<any>[] = [
  defineTool({
    name: "actions_ensure_asset_ids",
    description: "Bulk action: ensure every item in the inventory has an asset ID assigned.",
    write: true,
    shape: {},
    handler: () => homebox.post("/v1/actions/ensure-asset-ids"),
  }),

  defineTool({
    name: "actions_ensure_import_refs",
    description: "Bulk action: ensure every item in the inventory has an import reference assigned.",
    write: true,
    shape: {},
    handler: () => homebox.post("/v1/actions/ensure-import-refs"),
  }),

  defineTool({
    name: "actions_set_primary_photos",
    description: "Bulk action: set the first photo attachment of each item as its primary photo.",
    write: true,
    shape: {},
    handler: () => homebox.post("/v1/actions/set-primary-photos"),
  }),

  defineTool({
    name: "actions_zero_item_time_fields",
    description: "Bulk action: reset all item date/time fields to the start of their day.",
    write: true,
    shape: {},
    handler: () => homebox.post("/v1/actions/zero-item-time-fields"),
  }),

  defineTool({
    name: "actions_create_missing_thumbnails",
    description: "Bulk action: generate thumbnails for item photos that don't have one yet.",
    write: true,
    shape: {},
    handler: () => homebox.post("/v1/actions/create-missing-thumbnails"),
  }),
];
