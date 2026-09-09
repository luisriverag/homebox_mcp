import { config } from "../config.js";
import { homebox } from "./client.js";
import type { EntityOut } from "./entityMerge.js";

export interface SubtreeResult {
  /** The root item and every descendant discovered, deduplicated. */
  items: EntityOut[];
  /** True when discovery stopped early because it hit maxItems. */
  truncated: boolean;
}

async function fetchChildrenPage(parentIds: string[], page: number): Promise<EntityOut[]> {
  const response = await homebox.get<{ items?: EntityOut[] } | EntityOut[]>("/v1/entities", {
    parentIds,
    page,
    pageSize: 200,
  });
  return Array.isArray(response) ? response : (response.items ?? []);
}

/**
 * Breadth-first discovery of everything nested under an item, following the
 * same parent/child relationship items_patch's parentId writes and
 * items_list's parentIds filters read. Stops at maxItems and reports
 * truncation instead of continuing indefinitely on an unexpectedly large
 * (or cyclic) tree.
 */
export async function discoverDescendants(
  rootId: string,
  maxItems: number = config.maxBulkActionItems,
): Promise<SubtreeResult> {
  const root = await homebox.get<EntityOut>(`/v1/entities/${rootId}`);
  const collected = new Map<string, EntityOut>();
  if (root.id) collected.set(root.id, root);

  let frontier = [rootId];
  let truncated = false;

  while (frontier.length > 0 && !truncated) {
    const nextFrontier: string[] = [];
    let page = 1;
    for (;;) {
      const children = await fetchChildrenPage(frontier, page);
      if (children.length === 0) break;
      for (const child of children) {
        if (!child.id || collected.has(child.id)) continue;
        if (collected.size >= maxItems) {
          truncated = true;
          break;
        }
        collected.set(child.id, child);
        nextFrontier.push(child.id);
      }
      if (truncated || children.length < 200) break;
      page += 1;
    }
    frontier = nextFrontier;
  }

  // Items and locations share this same /v1/entities endpoint (a location is
  // just an entity whose entityType.isLocation is true), the same reason
  // items_list filters them out of its own results. A location isn't
  // taggable the way an item is, so it's excluded from the returned set --
  // but still traversed through above, in case a real item is nested
  // beneath one.
  const items = [...collected.values()].filter((entity) => !entity.entityType?.isLocation);
  return { items, truncated };
}
