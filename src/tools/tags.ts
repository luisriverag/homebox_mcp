import { z } from "zod";
import { homebox } from "../homebox/client.js";
import { defineTool, safeId, type ToolDef } from "./types.js";

const id = safeId.describe("Homebox tag UUID");

export const tagTools: ToolDef<any>[] = [
  defineTool({
    name: "tags_list",
    description: "List all tags (called \"Labels\" in older Homebox versions) used to categorize items.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/tags"),
  }),

  defineTool({
    name: "tags_get",
    description: "Get details of a single tag, including items tagged with it.",
    write: false,
    shape: { id },
    handler: ({ id }) => homebox.get(`/v1/tags/${id}`),
  }),

  defineTool({
    name: "tags_create",
    description: "Create a new tag.",
    write: true,
    shape: {
      name: z.string().min(1).max(255),
      description: z.string().max(1000).optional(),
      color: z.string().optional().describe("Hex color, e.g. #ff0000"),
      icon: z.string().optional(),
      parentId: safeId.optional().describe("Parent tag UUID, for nested tags"),
    },
    handler: (args) => homebox.post("/v1/tags", args),
  }),

  defineTool({
    name: "tags_update",
    description:
      "Update a tag's name, description, color, icon, or parent. Fetches the current tag first, so any field you omit is left unchanged.",
    write: true,
    shape: {
      id,
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(1000).optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      parentId: safeId.nullable().optional(),
    },
    handler: async ({ id, ...updates }) => {
      const current = await homebox.get<{
        name?: string;
        description?: string;
        color?: string;
        icon?: string;
        parentId?: string | null;
      }>(`/v1/tags/${id}`);
      const body = {
        name: current.name,
        description: current.description,
        color: current.color,
        icon: current.icon,
        parentId: current.parentId ?? null,
        ...updates,
      };
      return homebox.put(`/v1/tags/${id}`, body);
    },
  }),

  defineTool({
    name: "tags_delete",
    description: "Delete a tag. It is removed from all items that had it.",
    write: true,
    shape: { id },
    handler: ({ id }) => homebox.delete(`/v1/tags/${id}`),
  }),
];
