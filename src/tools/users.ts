import { z } from "zod";
import { homebox } from "../homebox/client.js";
import { defineTool, type ToolDef } from "./types.js";

export const userTools: ToolDef<any>[] = [
  defineTool({
    name: "users_self_get",
    description: "Get the profile of the currently authenticated Homebox user.",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/users/self"),
  }),

  defineTool({
    name: "users_self_update",
    description: "Update the currently authenticated user's name or email.",
    write: true,
    shape: { name: z.string().optional(), email: z.string().optional() },
    handler: (args) => homebox.put("/v1/users/self", args),
  }),

  defineTool({
    name: "users_self_delete",
    description:
      "PERMANENTLY delete the currently authenticated user's account and all their data. Irreversible — only use when explicitly confirmed.",
    write: true,
    shape: {},
    handler: () => homebox.delete("/v1/users/self"),
  }),

  defineTool({
    name: "users_change_password",
    description: "Change the currently authenticated user's password.",
    write: true,
    shape: { current: z.string(), new: z.string() },
    handler: (args) => homebox.put("/v1/users/change-password", args),
  }),

  defineTool({
    name: "users_register",
    description:
      "Register a new Homebox user account using a group invitation token (see group_invitations_create).",
    write: true,
    shape: {
      name: z.string(),
      email: z.string(),
      password: z.string(),
      token: z.string().describe("Group invitation token"),
    },
    handler: (args) => homebox.post("/v1/users/register", args),
  }),
];
