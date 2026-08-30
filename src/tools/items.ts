import { z } from "zod";
import { homebox } from "../homebox/client.js";
import { defineTool, safeId, type ToolDef } from "./types.js";

const id = safeId.describe("Homebox item UUID");

interface ItemOut {
  archived?: boolean;
  assetId?: string;
  description?: string;
  fields?: unknown[];
  insured?: boolean;
  labels?: { id: string }[];
  lifetimeWarranty?: boolean;
  location?: { id: string } | null;
  manufacturer?: string;
  modelNumber?: string;
  name?: string;
  notes?: string;
  parent?: { id: string } | null;
  purchaseFrom?: string;
  purchasePrice?: string;
  purchaseTime?: string;
  quantity?: number;
  serialNumber?: string;
  soldNotes?: string;
  soldPrice?: string;
  soldTime?: string;
  soldTo?: string;
  warrantyDetails?: string;
  warrantyExpires?: string;
}

/** Homebox's PUT /v1/items/{id} replaces the whole item, so build a full body from the current item first. */
function itemUpdateBodyFromCurrent(current: ItemOut) {
  return {
    archived: current.archived,
    assetId: current.assetId,
    description: current.description,
    fields: current.fields,
    insured: current.insured,
    labelIds: current.labels?.map((label) => label.id) ?? [],
    lifetimeWarranty: current.lifetimeWarranty,
    locationId: current.location?.id,
    manufacturer: current.manufacturer,
    modelNumber: current.modelNumber,
    name: current.name,
    notes: current.notes,
    parentId: current.parent?.id ?? null,
    purchaseFrom: current.purchaseFrom,
    purchasePrice: current.purchasePrice,
    purchaseTime: current.purchaseTime,
    quantity: current.quantity,
    serialNumber: current.serialNumber,
    soldNotes: current.soldNotes,
    soldPrice: current.soldPrice,
    soldTime: current.soldTime,
    soldTo: current.soldTo,
    warrantyDetails: current.warrantyDetails,
    warrantyExpires: current.warrantyExpires,
  };
}

export const itemTools: ToolDef<any>[] = [
  defineTool({
    name: "items_list",
    description:
      "List/search items in the Homebox inventory. Supports free-text search and filtering by label, location, or parent item.",
    write: false,
    shape: {
      q: z.string().optional().describe("Free-text search string"),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
      labels: z.array(z.string()).optional().describe("Filter by label IDs"),
      locations: z.array(z.string()).optional().describe("Filter by location IDs"),
      parentIds: z.array(z.string()).optional().describe("Filter by parent item IDs"),
    },
    handler: (args) => homebox.get("/v1/items", args as any),
  }),

  defineTool({
    name: "items_get",
    description: "Get full details of a single item by ID.",
    write: false,
    shape: { id },
    handler: ({ id }) => homebox.get(`/v1/items/${id}`),
  }),

  defineTool({
    name: "items_path",
    description: "Get the breadcrumb path (ancestor locations) of an item.",
    write: false,
    shape: { id },
    handler: ({ id }) => homebox.get(`/v1/items/${id}/path`),
  }),

  defineTool({
    name: "items_fields",
    description: "List the distinct custom field names used across all items.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/items/fields"),
  }),

  defineTool({
    name: "items_field_values",
    description: "List the distinct values used for a given custom field name.",
    write: false,
    shape: { field: z.string().optional() },
    handler: (args) => homebox.get("/v1/items/fields/values", args as any),
  }),

  defineTool({
    name: "items_export",
    description: "Export the full inventory as a CSV string.",
    write: false,
    shape: {},
    handler: () => homebox.request("GET", "/v1/items/export", { raw: true }),
  }),

  defineTool({
    name: "items_create",
    description: "Create a new item in the inventory.",
    write: true,
    shape: {
      name: z.string().min(1).max(255),
      description: z.string().max(1000).optional(),
      locationId: z.string().describe("Location UUID the item lives in"),
      labelIds: z.array(z.string()).optional(),
      parentId: z.string().optional().describe("Parent item UUID, if this is a sub-item"),
    },
    handler: (args) => homebox.post("/v1/items", args),
  }),

  defineTool({
    name: "items_update",
    description:
      "Update an item's details (name, description, location, labels, purchase/warranty/sale info, custom fields, etc). Fetches the current item first, so any field you omit is left unchanged.",
    write: true,
    shape: {
      id,
      name: z.string().optional(),
      description: z.string().optional(),
      quantity: z.number().int().optional(),
      locationId: z.string().optional(),
      labelIds: z.array(z.string()).optional(),
      parentId: z.string().nullable().optional(),
      archived: z.boolean().optional(),
      insured: z.boolean().optional(),
      assetId: z.string().optional(),
      manufacturer: z.string().optional(),
      modelNumber: z.string().optional(),
      serialNumber: z.string().optional(),
      notes: z.string().optional(),
      purchaseFrom: z.string().optional(),
      purchasePrice: z.string().optional().describe("Decimal amount as a string, e.g. \"19.99\""),
      purchaseTime: z.string().optional().describe("ISO 8601 date"),
      soldTo: z.string().optional(),
      soldPrice: z.string().optional(),
      soldTime: z.string().optional().describe("ISO 8601 date"),
      soldNotes: z.string().optional(),
      lifetimeWarranty: z.boolean().optional(),
      warrantyExpires: z.string().optional().describe("ISO 8601 date"),
      warrantyDetails: z.string().optional(),
      fields: z
        .array(z.object({ id: z.string().optional(), name: z.string(), type: z.string().optional(), textValue: z.string().optional() }))
        .optional()
        .describe("Custom fields for the item"),
    },
    handler: async ({ id, ...updates }) => {
      const current = await homebox.get<ItemOut>(`/v1/items/${id}`);
      const body = { ...itemUpdateBodyFromCurrent(current), ...updates };
      return homebox.put(`/v1/items/${id}`, body);
    },
  }),

  defineTool({
    name: "items_patch",
    description: "Partially update an item. Currently only supports changing quantity.",
    write: true,
    shape: { id, quantity: z.number().int() },
    handler: ({ id, ...body }) => homebox.patch(`/v1/items/${id}`, body),
  }),

  defineTool({
    name: "items_delete",
    description: "Permanently delete an item.",
    write: true,
    shape: { id },
    handler: ({ id }) => homebox.delete(`/v1/items/${id}`),
  }),

  defineTool({
    name: "items_import",
    description: "Bulk-import items from a Homebox-format CSV string.",
    write: true,
    shape: { csv: z.string().describe("CSV file content") },
    handler: ({ csv }) =>
      homebox.request("POST", "/v1/items/import", {
        multipart: true,
        body: { file: new Blob([csv], { type: "text/csv" }) },
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
    },
    handler: ({ id, fileBase64, fileName, type }) =>
      homebox.request("POST", `/v1/items/${id}/attachments`, {
        multipart: true,
        body: {
          file: new Blob([Buffer.from(fileBase64, "base64")]),
          name: fileName,
          type,
        },
      }),
  }),

  defineTool({
    name: "items_attachment_get",
    description: "Get metadata for a single item attachment.",
    write: false,
    shape: { id, attachmentId: safeId },
    handler: ({ id, attachmentId }) => homebox.get(`/v1/items/${id}/attachments/${attachmentId}`),
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
      homebox.put(`/v1/items/${id}/attachments/${attachmentId}`, body),
  }),

  defineTool({
    name: "items_attachment_delete",
    description: "Delete an attachment from an item.",
    write: true,
    shape: { id, attachmentId: safeId },
    handler: ({ id, attachmentId }) => homebox.delete(`/v1/items/${id}/attachments/${attachmentId}`),
  }),

  defineTool({
    name: "items_maintenance_list",
    description: "List maintenance log entries for an item.",
    write: false,
    shape: { id },
    handler: ({ id }) => homebox.get(`/v1/items/${id}/maintenance`),
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
    handler: ({ id, ...body }) => homebox.post(`/v1/items/${id}/maintenance`, body),
  }),

  defineTool({
    name: "items_maintenance_update",
    description: "Update a maintenance log entry (e.g. mark it completed).",
    write: true,
    shape: {
      id,
      entryId: safeId,
      name: z.string().optional(),
      description: z.string().optional(),
      cost: z.string().optional(),
      scheduledDate: z.string().optional(),
      completedDate: z.string().optional(),
    },
    handler: ({ id, entryId, ...body }) => homebox.put(`/v1/items/${id}/maintenance/${entryId}`, body),
  }),

  defineTool({
    name: "items_maintenance_delete",
    description: "Delete a maintenance log entry from an item.",
    write: true,
    shape: { id, entryId: safeId },
    handler: ({ id, entryId }) => homebox.delete(`/v1/items/${id}/maintenance/${entryId}`),
  }),
];
