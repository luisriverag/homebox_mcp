import { z } from "zod";
import { homebox, type BinaryResponse } from "../homebox/client.js";
import { resolveEntityTypeId } from "../homebox/entityTypes.js";
import { entityUpdateBodyFromCurrent, type EntityOut } from "../homebox/entityMerge.js";
import { buildSearchTerms, findRelevantTags, mergeEntitySearchResults } from "../homebox/search.js";
import { deepSearchItems } from "../homebox/deepSearch.js";
import { defineTool, safeId, type ToolContentResult, type ToolDef } from "./types.js";

const id = safeId.describe("Homebox entity (item) UUID");

export const itemTools: ToolDef<any>[] = [
  defineTool({
    name: "items_list",
    description:
      "List/search items in the Homebox inventory. Use deepSearch for exhaustive queries over fields that Homebox does not normally index, such as bought-from, amounts, warranty data, and custom fields. Before a normal search, use tags_list to discover inventory-specific tags that may express the user's meaning, then pass their IDs in relatedTagIds (for example, a motorbike request may match a Motorcycle tag). Related tags are searched independently from item text so tagged items are not missed. tagNames is also available when only names are known. Include translations, singular/plural forms, synonyms, abbreviations, and alternate names in alternateNames. The tool combines all unique results. The tags parameter is a strict filter rather than an additional discovery search. Supports filtering by parent item/location ID (there's no direct \"only show items in location X\" filter — use parentIds with that location's ID, or items_get/locations_get to see an entity's direct children). Homebox's search endpoint returns items and locations/containers mixed together (there's no server-side type filter); this tool drops results that are themselves locations, so a page may come back with fewer than pageSize items per search variation — use locations_list/locations_tree to browse locations specifically.",
    write: false,
    shape: {
      q: z.string().optional().describe("The user's original free-text search string"),
      alternateNames: z
        .array(z.string().min(1))
        .max(12)
        .optional()
        .describe(
          "English/Spanish translations, singular/plural forms, synonyms, abbreviations, and other names for q",
        ),
      tagNames: z
        .array(z.string().min(1))
        .max(12)
        .optional()
        .describe("Relevant tag names discovered with tags_list; these are searched in addition to q"),
      relatedTagIds: z
        .array(safeId)
        .max(12)
        .optional()
        .describe("Relevant tag IDs discovered with tags_list; searched independently in addition to q"),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
      tags: z.array(z.string()).optional().describe("Filter by tag IDs"),
      parentIds: z.array(z.string()).optional().describe("Filter by parent item/location IDs"),
      deepSearch: z
        .object({
          q: z.string().min(1).optional().describe("Text to find in any scalar item or custom-field value"),
          filters: z
            .array(
              z.object({
                field: z
                  .string()
                  .min(1)
                  .describe("Top-level field, dotted path, or custom-field name (for example purchaseFrom)"),
                operator: z.enum(["contains", "equals", "gt", "gte", "lt", "lte"]),
                value: z.union([z.string(), z.number(), z.boolean()]),
              }),
            )
            .max(20)
            .optional(),
          match: z.enum(["all", "any"]).optional().describe("How to combine filters; defaults to all"),
          includeArchived: z.boolean().optional().describe("Include archived items in the exhaustive scan"),
        })
        .refine((value) => Boolean(value.q || value.filters?.length), {
          message: "deepSearch requires q or at least one filter",
        })
        .optional()
        .describe(
          "Opt-in exhaustive search across complete item details, including purchase/sale amounts, bought-from, warranty, and custom fields. This fetches every matching inventory item's details and can be slow.",
        ),
    },
    handler: async ({ alternateNames, tagNames = [], relatedTagIds = [], deepSearch, ...args }: any) => {
      if (deepSearch) {
        const requestedPage = args.page ?? 1;
        const requestedPageSize = args.pageSize ?? 50;
        const { q: _q, page: _page, pageSize: _pageSize, ...filters } = args;
        return deepSearchItems(homebox, filters, deepSearch, requestedPage, requestedPageSize);
      }
      const searchTerms = args.q ? buildSearchTerms(args.q, alternateNames) : [];
      let relevantTags: Array<{ id: string; name: string }> = [];
      if ((tagNames.length || (!relatedTagIds.length && searchTerms.length)) && !args.tags?.length) {
        const tagCandidates = relatedTagIds.length ? tagNames : [...searchTerms, ...tagNames];
        relevantTags = findRelevantTags(await homebox.get("/v1/tags"), tagCandidates);
      }
      const searchedTagIds = args.tags?.length
        ? []
        : [...new Set<string>([...relatedTagIds, ...relevantTags.map((tag) => tag.id)])];
      const textSearches = searchTerms.map((q) => homebox.get("/v1/entities", { ...args, q }));
      const { q: _q, tags: _tags, ...tagSearchArgs } = args;
      const tagSearches = searchedTagIds.map((tagId) =>
        homebox.get("/v1/entities", { ...tagSearchArgs, tags: [tagId] }),
      );
      const results = searchTerms.length || searchedTagIds.length
        ? await Promise.all([...textSearches, ...tagSearches])
        : [await homebox.get("/v1/entities", args)];
      const result: any = mergeEntitySearchResults(results, searchTerms);
      result.matchedTags = relevantTags;
      result.searchedTagIds = searchedTagIds;
      result.items = result.items.filter((entity: EntityOut) => !entity.entityType?.isLocation);
      return result;
    },
  }),

  defineTool({
    name: "items_get",
    description:
      "Get full details of a single item by ID. Optionally include its photos, documents, or all attachment contents directly in the MCP response.",
    write: false,
    shape: {
      id,
      includeAttachments: z
        .enum(["photos", "documents", "all"])
        .optional()
        .describe("Also return matching attachment contents; omit to return item details and attachment metadata only"),
    },
    handler: async ({ id, includeAttachments }) => {
      const item = await homebox.get<EntityOut>(`/v1/entities/${id}`);
      if (!includeAttachments) return item;

      const attachments = (item.attachments ?? []).filter((attachment) => {
        const isPhoto = attachment.type === "photo" || attachment.mimeType?.startsWith("image/");
        if (includeAttachments === "photos") return isPhoto;
        if (includeAttachments === "documents") return !isPhoto;
        return true;
      });
      const binaries = await Promise.all(
        attachments.map((attachment) =>
          homebox.request<BinaryResponse>("GET", `/v1/entities/${id}/attachments/${attachment.id}`, {
            binary: true,
          }),
        ),
      );
      return { kind: "tool-content", value: item, binaries } satisfies ToolContentResult;
    },
  }),

  defineTool({
    name: "items_path",
    description: "Get the breadcrumb path (ancestor locations) of an item.",
    write: false,
    shape: { id },
    handler: ({ id }) => homebox.get(`/v1/entities/${id}/path`),
  }),

  defineTool({
    name: "items_fields",
    description: "List the distinct custom field names used across all items.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/entities/fields"),
  }),

  defineTool({
    name: "items_field_values",
    description: "List the distinct values used for a given custom field name.",
    write: false,
    shape: { field: z.string() },
    handler: (args) => homebox.get("/v1/entities/fields/values", args as any),
  }),

  defineTool({
    name: "items_export",
    description: "Export the full inventory as a CSV string.",
    write: false,
    shape: {},
    handler: () => homebox.request("GET", "/v1/entities/export", { raw: true }),
  }),

  defineTool({
    name: "items_create",
    description: "Create a new item in the inventory.",
    write: true,
    shape: {
      name: z.string().min(1).max(255),
      description: z.string().max(1000).optional(),
      parentId: safeId.optional().describe("Location or parent item UUID the item lives in"),
      tagIds: z.array(z.string()).optional(),
      quantity: z.number().optional(),
      manufacturer: z.string().optional(),
      modelNumber: z.string().optional(),
      entityTypeId: safeId
        .optional()
        .describe(
          "Custom entity-type/template UUID (see entity_types_list). Omit to use the group's default item type.",
        ),
    },
    handler: async ({ entityTypeId, ...body }) => {
      const resolvedTypeId = await resolveEntityTypeId("item", entityTypeId);
      return homebox.post("/v1/entities", { ...body, entityTypeId: resolvedTypeId });
    },
  }),

  defineTool({
    name: "items_update",
    description:
      "Update an item's details (name, description, tags, purchase/warranty/sale info, custom fields, etc). Fetches the current item first, so any field you omit is left unchanged. To move an item, change its parentId.",
    write: true,
    shape: {
      id,
      name: z.string().optional(),
      description: z.string().optional(),
      quantity: z.number().optional(),
      parentId: safeId.nullable().optional().describe("Location or parent item UUID, or null to un-nest"),
      tagIds: z.array(z.string()).optional(),
      entityTypeId: safeId.optional(),
      archived: z.boolean().optional(),
      insured: z.boolean().optional(),
      assetId: z.string().optional(),
      manufacturer: z.string().optional(),
      modelNumber: z.string().optional(),
      serialNumber: z.string().optional(),
      notes: z.string().optional(),
      purchaseFrom: z.string().optional(),
      purchasePrice: z.number().optional(),
      purchaseDate: z.string().optional().describe("ISO 8601 date"),
      soldTo: z.string().optional(),
      soldPrice: z.number().optional(),
      soldDate: z.string().optional().describe("ISO 8601 date"),
      soldNotes: z.string().optional(),
      lifetimeWarranty: z.boolean().optional(),
      warrantyExpires: z.string().optional().describe("ISO 8601 date"),
      warrantyDetails: z.string().optional(),
      fields: z
        .array(
          z.object({
            id: z.string().optional(),
            name: z.string(),
            type: z.string().optional(),
            textValue: z.string().optional(),
            numberValue: z.number().optional(),
            booleanValue: z.boolean().optional(),
          }),
        )
        .optional()
        .describe("Custom fields for the item"),
    },
    handler: async ({ id, ...updates }) => {
      const current = await homebox.get<EntityOut>(`/v1/entities/${id}`);
      const body = { ...entityUpdateBodyFromCurrent(current), ...updates };
      return homebox.put(`/v1/entities/${id}`, body);
    },
  }),

  defineTool({
    name: "items_patch",
    description: "Partially update an item: quantity, tags, parent, or entity type.",
    write: true,
    shape: {
      id,
      quantity: z.number().optional(),
      tagIds: z.array(z.string()).optional(),
      parentId: safeId.nullable().optional(),
      entityTypeId: safeId.optional(),
    },
    handler: ({ id, ...body }) => homebox.patch(`/v1/entities/${id}`, body),
  }),

  defineTool({
    name: "items_delete",
    description: "Permanently delete an item.",
    write: true,
    shape: { id },
    handler: ({ id }) => homebox.delete(`/v1/entities/${id}`),
  }),

  defineTool({
    name: "items_import",
    description: "Bulk-import items from a Homebox-format CSV string.",
    write: true,
    shape: { csv: z.string().describe("CSV file content") },
    handler: ({ csv }) =>
      homebox.request("POST", "/v1/entities/import", {
        multipart: true,
        body: { csv: new Blob([csv], { type: "text/csv" }) },
      }),
  }),

  defineTool({
    name: "items_attachment_add",
    description: "Attach a file (photo, manual, warranty, receipt, or other) to an item.",
    write: true,
    shape: {
      id,
      fileBase64: z.string().describe("Base64-encoded file content"),
      fileName: z.string().describe("File name including extension"),
      type: z
        .enum(["photo", "manual", "warranty", "attachment", "receipt"])
        .describe("Attachment type"),
      primary: z.boolean().optional().describe("Set as the item's primary photo"),
    },
    handler: ({ id, fileBase64, fileName, type, primary }) =>
      homebox.request("POST", `/v1/entities/${id}/attachments`, {
        multipart: true,
        body: {
          file: new Blob([Buffer.from(fileBase64, "base64")]),
          name: fileName,
          type,
          ...(primary !== undefined ? { primary: String(primary) } : {}),
        },
      }),
  }),

  defineTool({
    name: "items_attachment_add_external",
    description: "Link an item to a document or URL in an external system, without uploading the file itself.",
    write: true,
    shape: {
      id,
      externalId: z.string().describe("ID/URL of the external document"),
      sourceType: z.string().describe("What kind of external system this is, e.g. \"url\""),
      attachmentType: z
        .enum(["photo", "manual", "warranty", "attachment", "receipt"])
        .describe("Attachment type"),
      title: z.string().optional(),
    },
    handler: ({ id, externalId, sourceType, attachmentType, title }) =>
      homebox.post(`/v1/entities/${id}/attachments/external`, {
        external_id: externalId,
        source_type: sourceType,
        attachment_type: attachmentType,
        title,
      }),
  }),

  defineTool({
    name: "items_attachment_get",
    description:
      "Return an item's attachment contents. Photos are returned as MCP image content; manuals, receipts, warranties, and other documents are returned as embedded MCP resources.",
    write: false,
    shape: { id, attachmentId: safeId },
    handler: ({ id, attachmentId }) =>
      homebox.request("GET", `/v1/entities/${id}/attachments/${attachmentId}`, { binary: true }),
  }),

  defineTool({
    name: "items_attachment_update",
    description: "Update an attachment's title, type, or whether it is the item's primary photo.",
    write: true,
    shape: {
      id,
      attachmentId: safeId,
      title: z.string().optional(),
      type: z.string().optional(),
      primary: z.boolean().optional(),
    },
    handler: ({ id, attachmentId, ...body }) =>
      homebox.put(`/v1/entities/${id}/attachments/${attachmentId}`, body),
  }),

  defineTool({
    name: "items_attachment_delete",
    description: "Delete an attachment from an item.",
    write: true,
    shape: { id, attachmentId: safeId },
    handler: ({ id, attachmentId }) => homebox.delete(`/v1/entities/${id}/attachments/${attachmentId}`),
  }),

  defineTool({
    name: "items_maintenance_list",
    description: "List maintenance log entries for an item.",
    write: false,
    shape: {
      id,
      status: z.enum(["scheduled", "completed", "both"]).optional(),
    },
    handler: ({ id, ...query }) => homebox.get(`/v1/entities/${id}/maintenance`, query as any),
  }),

  defineTool({
    name: "maintenance_list_all",
    description: "List maintenance log entries across every item in the inventory.",
    write: false,
    shape: { status: z.enum(["scheduled", "completed", "both"]).optional() },
    handler: (args) => homebox.get("/v1/maintenance", args as any),
  }),

  defineTool({
    name: "items_maintenance_create",
    description: "Add a maintenance log entry to an item.",
    write: true,
    shape: {
      id,
      name: z.string().min(1),
      description: z.string().optional(),
      cost: z.string().optional().describe("Decimal amount as a string, e.g. \"25.00\""),
      scheduledDate: z.string().optional().describe("ISO 8601 date"),
      completedDate: z.string().optional().describe("ISO 8601 date"),
    },
    handler: ({ id, ...body }) => homebox.post(`/v1/entities/${id}/maintenance`, body),
  }),

  defineTool({
    name: "items_maintenance_update",
    description: "Update a maintenance log entry (e.g. mark it completed).",
    write: true,
    shape: {
      entryId: safeId.describe("Maintenance entry UUID"),
      name: z.string().optional(),
      description: z.string().optional(),
      cost: z.string().optional(),
      scheduledDate: z.string().optional(),
      completedDate: z.string().optional(),
    },
    handler: ({ entryId, ...body }) => homebox.put(`/v1/maintenance/${entryId}`, body),
  }),

  defineTool({
    name: "items_maintenance_delete",
    description: "Delete a maintenance log entry.",
    write: true,
    shape: { entryId: safeId.describe("Maintenance entry UUID") },
    handler: ({ entryId }) => homebox.delete(`/v1/maintenance/${entryId}`),
  }),
];
