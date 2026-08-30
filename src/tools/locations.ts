import { z } from "zod";
import { homebox } from "../homebox/client.js";
import { defineTool, type ToolDef } from "./types.js";

const id = z.string().describe("Homebox location UUID");

export const locationTools: ToolDef<any>[] = [
  defineTool({
    name: "locations_list",
    description: "List all storage locations.",
    write: false,
    shape: { filterChildren: z.boolean().optional().describe("Only return top-level locations") },
    handler: (args) => homebox.get("/v1/locations", args as any),
  }),

  defineTool({
    name: "locations_tree",
    description: "Get the full nested tree of locations (and optionally items within them).",
    write: false,
    shape: { withItems: z.boolean().optional() },
    handler: (args) => homebox.get("/v1/locations/tree", args as any),
  }),

  defineTool({
    name: "locations_get",
    description: "Get details of a single location, including items stored in it.",
    write: false,
    shape: { id },
    handler: ({ id }) => homebox.get(`/v1/locations/${id}`),
  }),

  defineTool({
    name: "locations_create",
    description: "Create a new storage location, optionally nested under a parent location.",
    write: true,
    shape: {
      name: z.string().min(1),
      description: z.string().optional(),
      parentId: z.string().optional().describe("Parent location UUID"),
    },
    handler: (args) => homebox.post("/v1/locations", args),
  }),

  defineTool({
    name: "locations_update",
    description: "Update a location's name, description, or parent.",
    write: true,
    shape: {
      id,
      name: z.string().optional(),
      description: z.string().optional(),
      parentId: z.string().nullable().optional(),
    },
    handler: ({ id, ...body }) => homebox.put(`/v1/locations/${id}`, body),
  }),

  defineTool({
    name: "locations_delete",
    description: "Delete a location. Items inside it are not deleted but become unassigned.",
    write: true,
    shape: { id },
    handler: ({ id }) => homebox.delete(`/v1/locations/${id}`),
  }),
];
