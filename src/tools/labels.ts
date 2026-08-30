import { z } from "zod";
import { homebox } from "../homebox/client.js";
import { defineTool, safeId, type ToolDef } from "./types.js";

const id = safeId.describe("Homebox label UUID");

export const labelTools: ToolDef<any>[] = [
  defineTool({
    name: "labels_list",
    description: "List all labels/tags.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/labels"),
  }),

  defineTool({
    name: "labels_get",
    description: "Get details of a single label, including items tagged with it.",
    write: false,
    shape: { id },
    handler: ({ id }) => homebox.get(`/v1/labels/${id}`),
  }),

  defineTool({
    name: "labels_create",
    description: "Create a new label/tag.",
    write: true,
    shape: {
      name: z.string().min(1).max(255),
      description: z.string().max(255).optional(),
      color: z.string().optional().describe("Hex color, e.g. #ff0000"),
    },
    handler: (args) => homebox.post("/v1/labels", args),
  }),

  defineTool({
    name: "labels_update",
    description:
      "Update a label's name, description, or color. Fetches the current label first, so an omitted name/description is left unchanged. Exception: Homebox never returns a label's current color via its API, so color can't be preserved automatically — pass it explicitly (even if unchanged) or it will be cleared.",
    write: true,
    shape: {
      id,
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(255).optional(),
      color: z.string().optional().describe("Hex color, e.g. #ff0000. Omitting this clears the label's color — Homebox's API can't report the current color back to preserve it."),
    },
    handler: async ({ id, ...updates }) => {
      const current = await homebox.get<{ name?: string; description?: string }>(`/v1/labels/${id}`);
      const body = {
        name: current.name,
        description: current.description,
        ...updates,
      };
      return homebox.put(`/v1/labels/${id}`, body);
    },
  }),

  defineTool({
    name: "labels_delete",
    description: "Delete a label. It is removed from all items that had it.",
    write: true,
    shape: { id },
    handler: ({ id }) => homebox.delete(`/v1/labels/${id}`),
  }),
];
