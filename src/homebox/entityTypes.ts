import { homebox } from "./client.js";

export interface EntityTypeSummary {
  id: string;
  name: string;
  isLocation?: boolean;
  icon?: string;
  description?: string;
  createdAt?: string;
}

let cache: EntityTypeSummary[] | null = null;

/**
 * Homebox groups everything (items, locations, and any custom templates)
 * under one "entity" resource, distinguished by an entityTypeId. Every
 * group has a default location-type and a default non-location (item) type;
 * this caches the list for the life of the process to resolve those without
 * a round-trip on every create call.
 */
export async function listEntityTypes(): Promise<EntityTypeSummary[]> {
  if (!cache) {
    cache = await homebox.get<EntityTypeSummary[]>("/v1/entity-types");
  }
  return cache;
}

/**
 * Resolves the entityTypeId to use for a new item/location, matching what
 * Homebox itself does server-side when entityTypeId is omitted on create
 * (repo.EntityRepository.resolveDefaultEntityType): the earliest-created
 * entity type with the matching isLocation flag, not just the first one a
 * listing happens to return.
 */
export async function resolveEntityTypeId(
  kind: "item" | "location",
  explicitId?: string,
): Promise<string | undefined> {
  if (explicitId) return explicitId;
  const types = await listEntityTypes();
  const wantLocation = kind === "location";
  const matches = types
    .filter((t) => Boolean(t.isLocation) === wantLocation)
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  return matches[0]?.id;
}
