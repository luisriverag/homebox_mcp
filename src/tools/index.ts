import { config } from "../config.js";
import type { ToolDef } from "./types.js";
import { itemTools } from "./items.js";
import { locationTools } from "./locations.js";
import { labelTools } from "./labels.js";
import { notifierTools } from "./notifiers.js";
import { userTools } from "./users.js";
import { groupTools } from "./group.js";
import { actionTools } from "./actions.js";
import { miscTools } from "./misc.js";

export const allTools: ToolDef<any>[] = [
  ...itemTools,
  ...locationTools,
  ...labelTools,
  ...notifierTools,
  ...userTools,
  ...groupTools,
  ...actionTools,
  ...miscTools,
];

/** Tools available given the current READONLY setting: write tools are dropped entirely when READONLY=Y. */
export function activeTools(): ToolDef<any>[] {
  return config.readonly ? allTools.filter((t) => !t.write) : allTools;
}

export { type ToolDef };
