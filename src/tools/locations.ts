import { z } from "zod";
import { homebox } from "../homebox/client.js";
import { resolveEntityTypeId } from "../homebox/entityTypes.js";
import { entityUpdateBodyFromCurrent, type EntityOut } from "../homebox/entityMerge.js";
import { defineTool, safeId, type ToolDef } from "./types.js";

const id = safeId.describe("Homebox location UUID");

interface TreeItem {
  id: string;
  name: string;
  type?: string;
  children?: TreeItem[];
}

function flattenLocationTree(nodes: TreeItem[] | undefined, parentId: string | null = null): unknown[] {
  if (!nodes) return [];
  const out: unknown[] = [];
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, parentId });
    out.push(...flattenLocationTree(node.children, node.id));
  }
  return out;
}

export const locationTools: ToolDef<any>[] = [
  defineTool({
    name: "locations_list",
    description: "List all storage locations (flattened from the location tree).",
    write: false,
    shape: {},
    handler: async () => {
      const tree = await homebox.get<TreeItem[]>("/v1/entities/tree", { withItems: false });
      return flattenLocationTree(tree);
    },
  }),

  defineTool({
    name: "locations_tree",
    description: "Get the full nested tree of locations, optionally including items within them.",
    write: false,
    shape: { withItems: z.boolean().optional() },
    handler: (args) => homebox.get("/v1/entities/tree", args as any),
  }),

  defineTool({
    name: "locations_get",
    description: "Get details of a single location, including its child locations/items and item count.",
    write: false,
    shape: { id },
    handler: ({ id }) => homebox.get(`/v1/entities/${id}`),
  }),

  defineTool({
    name: "locations_create",
    description: "Create a new storage location, optionally nested under a parent location.",
    write: true,
    shape: {
      name: z.string().min(1),
      description: z.string().optional(),
      parentId: safeId.optional().describe("Parent location UUID"),
      entityTypeId: safeId
        .optional()
        .describe(
          "Custom location-type UUID (see entity_types_list). Omit to use the group's default location type.",
        ),
    },
    handler: async ({ entityTypeId, ...body }) => {
      const resolvedTypeId = await resolveEntityTypeId("location", entityTypeId);
      if (!resolvedTypeId) {
        // Unlike items, Homebox has no server-side fallback for a missing
        // location entity type on create — omitting entityTypeId here would
        // silently create a regular item instead of a location.
        throw new Error(
          "Could not find a location entity type in this group (see entity_types_list). Pass entityTypeId explicitly.",
        );
      }
      return homebox.post("/v1/entities", { ...body, entityTypeId: resolvedTypeId });
    },
  }),

  defineTool({
    name: "locations_update",
    description:
      "Update a location's name, description, or parent. Fetches the current location first, so any field you omit (including parent) is left unchanged.",
    write: true,
    shape: {
      id,
      name: z.string().optional(),
      description: z.string().optional(),
      parentId: safeId.nullable().optional().describe("Parent location UUID, or null to un-nest"),
    },
    handler: async ({ id, ...updates }) => {
      const current = await homebox.get<EntityOut>(`/v1/entities/${id}`);
      const body = { ...entityUpdateBodyFromCurrent(current), ...updates };
      return homebox.put(`/v1/entities/${id}`, body);
    },
  }),

  defineTool({
    name: "locations_delete",
    description: "Delete a location. Items inside it are not deleted but become unassigned.",
    write: true,
    shape: { id },
    handler: ({ id }) => homebox.delete(`/v1/entities/${id}`),
  }),
];
