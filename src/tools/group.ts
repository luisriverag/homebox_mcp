import { z } from "zod";
import { homebox } from "../homebox/client.js";
import { defineTool, safeId, type ToolDef } from "./types.js";

export const groupTools: ToolDef<any>[] = [
  defineTool({
    name: "group_get",
    description: "Get the current Homebox group's settings (name, currency, etc).",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/groups"),
  }),

  defineTool({
    name: "group_update",
    description: "Update the current group's name or currency.",
    write: true,
    shape: { name: z.string().optional(), currency: z.string().optional().describe("Currency code, e.g. USD") },
    handler: (args) => homebox.put("/v1/groups", args),
  }),

  defineTool({
    name: "group_invitations_create",
    description: "Create an invitation token so a new user can register into this group.",
    write: true,
    shape: {
      uses: z.number().int().min(1).max(100).describe("How many times the invitation can be used"),
      expiresAt: z.string().optional().describe("ISO 8601 expiry date"),
    },
    handler: (args) => homebox.post("/v1/groups/invitations", args),
  }),

  defineTool({
    name: "group_invitations_list",
    description: "List outstanding group invitations.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/groups/invitations"),
  }),

  defineTool({
    name: "group_invitations_delete",
    description: "Revoke a group invitation.",
    write: true,
    shape: { id: safeId.describe("Invitation UUID") },
    handler: ({ id }) => homebox.delete(`/v1/groups/invitations/${id}`),
  }),

  defineTool({
    name: "group_members_list",
    description: "List all members of the current group.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/groups/members"),
  }),

  defineTool({
    name: "group_members_remove",
    description: "Remove a user from the group.",
    write: true,
    shape: { userId: safeId.describe("User UUID") },
    handler: ({ userId }) => homebox.delete(`/v1/groups/members/${userId}`),
  }),

  defineTool({
    name: "group_statistics",
    description: "Get high-level inventory statistics for the group (total items, total value, etc).",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/groups/statistics"),
  }),

  defineTool({
    name: "group_statistics_tags",
    description: "Get item-count statistics broken down by tag.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/groups/statistics/tags"),
  }),

  defineTool({
    name: "group_statistics_locations",
    description: "Get item-count statistics broken down by location.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/groups/statistics/locations"),
  }),

  defineTool({
    name: "group_statistics_purchase_price",
    description: "Get total purchase price statistics over time.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/groups/statistics/purchase-price"),
  }),
];
