import { z } from "zod";
import { homebox } from "../homebox/client.js";
import { defineTool, safeId, type ToolDef } from "./types.js";

const id = safeId.describe("Homebox notifier UUID");

export const notifierTools: ToolDef<any>[] = [
  defineTool({
    name: "notifiers_list",
    description: "List configured notifiers (e.g. Shoutrrr/Apprise notification URLs for maintenance reminders).",
    write: false,
    shape: {},
    handler: () => homebox.get("/v1/notifiers"),
  }),

  defineTool({
    name: "notifiers_create",
    description: "Create a new notifier target.",
    write: true,
    shape: {
      name: z.string().min(1).max(255),
      url: z.string().describe("Shoutrrr-format notification URL"),
      isActive: z.boolean().optional(),
    },
    handler: (args) => homebox.post("/v1/notifiers", args),
  }),

  defineTool({
    name: "notifiers_update",
    description:
      "Update a notifier's name, URL, or active state. Omitting url leaves it unchanged. Omitting isActive also leaves it unchanged (this tool looks up the notifier's current active state first, since Homebox's update endpoint otherwise defaults it to false).",
    write: true,
    shape: {
      id,
      name: z.string().min(1).max(255),
      url: z.string().optional().describe("Shoutrrr-format notification URL; omit to leave unchanged"),
      isActive: z.boolean().optional(),
    },
    handler: async ({ id, ...updates }) => {
      let currentIsActive: boolean | undefined;
      if (updates.isActive === undefined) {
        const list = await homebox.get<{ id: string; isActive?: boolean }[]>("/v1/notifiers");
        currentIsActive = list.find((n) => n.id === id)?.isActive;
      }
      const body = { isActive: currentIsActive, ...updates };
      return homebox.put(`/v1/notifiers/${id}`, body);
    },
  }),

  defineTool({
    name: "notifiers_delete",
    description: "Delete a notifier.",
    write: true,
    shape: { id },
    handler: ({ id }) => homebox.delete(`/v1/notifiers/${id}`),
  }),

  defineTool({
    name: "notifiers_test",
    description: "Send a test notification through a Shoutrrr URL to verify it works.",
    write: true,
    shape: { url: z.string() },
    handler: ({ url }) => homebox.post("/v1/notifiers/test", { url }),
  }),
];
