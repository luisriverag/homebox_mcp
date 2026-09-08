import { z } from "zod";
import { config } from "../config.js";
import { homebox } from "../homebox/client.js";
import type { EntityOut } from "../homebox/entityMerge.js";
import { discoverDescendants } from "../homebox/subtree.js";
import { resolveTagId } from "../homebox/tagResolve.js";
import { defineTool, safeId, type ToolDef } from "./types.js";

interface BulkItemResult {
  id: string;
  name?: string;
  status: string;
  error?: string;
}

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

  defineTool({
    name: "actions_tag_subtree",
    description:
      `Bulk action: add a tag to an item and everything nested under it (recursively, following the same parent/child relationship items_patch's parentId writes and items_list's parentIds filters read) -- e.g. tag a toolbox and every tool inside it. Pass tagId for an existing tag (from tags_list), or tagName to find-or-create one by name. Set dryRun to preview affected items without writing. Capped at ${config.maxBulkActionItems} items (MAX_BULK_ACTION_ITEMS); the result's truncated field is true if the subtree is larger, in which case only the first items discovered were processed.`,
    write: true,
    shape: {
      rootId: safeId.describe("Item UUID to tag, along with everything nested under it"),
      tagId: safeId.optional().describe("Existing tag UUID to add"),
      tagName: z.string().min(1).max(255).optional().describe("Tag name to find or create, used when tagId is not supplied"),
      dryRun: z.boolean().optional().describe("Preview affected items without making changes"),
    },
    handler: async ({ rootId, tagId, tagName, dryRun }: any) => {
      const resolvedTagId = await resolveTagId({ tagId, tagName });
      const { items, truncated } = await discoverDescendants(rootId);

      const results: BulkItemResult[] = [];
      for (const item of items) {
        if (!item.id) continue;
        const currentTagIds = (item.tags ?? []).map((tag) => tag.id);
        if (currentTagIds.includes(resolvedTagId)) {
          results.push({ id: item.id, name: item.name, status: "already-tagged" });
          continue;
        }
        if (dryRun) {
          results.push({ id: item.id, name: item.name, status: "would-tag" });
          continue;
        }
        try {
          await homebox.patch(`/v1/entities/${item.id}`, { tagIds: [...currentTagIds, resolvedTagId] });
          results.push({ id: item.id, name: item.name, status: "tagged" });
        } catch (err) {
          results.push({
            id: item.id,
            name: item.name,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { tagId: resolvedTagId, affectedCount: items.length, truncated, dryRun: Boolean(dryRun), results };
    },
  }),

  defineTool({
    name: "actions_attach_photo_by_tag",
    description:
      `Bulk action: upload the same photo to every item carrying a given tag. Skips items that already have a photo attachment unless force is set. Pass tagId for an existing tag (from tags_list), or tagName to find it by name. Capped at ${config.maxBulkActionItems} items (MAX_BULK_ACTION_ITEMS); the result's truncated field is true if more items carry the tag than that.`,
    write: true,
    shape: {
      tagId: safeId.optional().describe("Existing tag UUID"),
      tagName: z.string().min(1).max(255).optional().describe("Tag name, used when tagId is not supplied"),
      fileBase64: z.string().describe("Base64-encoded image content"),
      fileName: z.string().describe("File name including extension"),
      force: z.boolean().optional().describe("Upload even to items that already have a photo attachment"),
    },
    handler: async ({ tagId, tagName, fileBase64, fileName, force }: any) => {
      const resolvedTagId = await resolveTagId({ tagId, tagName });
      const tag = await homebox.get<{ items?: EntityOut[] }>(`/v1/tags/${resolvedTagId}`);
      const allItems = tag.items ?? [];
      const items = allItems.slice(0, config.maxBulkActionItems);
      const truncated = allItems.length > items.length;

      const results: BulkItemResult[] = [];
      for (const item of items) {
        if (!item.id) continue;
        if (!force) {
          const full = await homebox.get<EntityOut>(`/v1/entities/${item.id}`);
          if ((full.attachments ?? []).some((attachment) => attachment.type === "photo")) {
            results.push({ id: item.id, name: item.name, status: "skipped-has-photo" });
            continue;
          }
        }
        try {
          await homebox.request("POST", `/v1/entities/${item.id}/attachments`, {
            multipart: true,
            body: {
              file: new Blob([Buffer.from(fileBase64, "base64")]),
              name: fileName,
              type: "photo",
            },
          });
          results.push({ id: item.id, name: item.name, status: "uploaded" });
        } catch (err) {
          results.push({
            id: item.id,
            name: item.name,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { tagId: resolvedTagId, matchedCount: items.length, truncated, results };
    },
  }),
];
