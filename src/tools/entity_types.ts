import { defineTool, type ToolDef } from "./types.js";
import { listEntityTypes } from "../homebox/entityTypes.js";

export const entityTypeTools: ToolDef<any>[] = [
  defineTool({
    name: "entity_types_list",
    description:
      "List the entity types (templates) this Homebox group has — the built-in \"Location\" and \"Item\" types plus any custom ones. Each has an isLocation flag. Useful for entityTypeId when creating an item/location of a custom type.",
    write: false,
    shape: {},
    handler: () => listEntityTypes(),
  }),
];
