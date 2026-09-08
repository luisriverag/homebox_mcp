import { homebox } from "./client.js";

interface TagRecord {
  id: string;
  name: string;
}

function normalizeTagsResponse(response: unknown): TagRecord[] {
  const candidates = Array.isArray(response)
    ? response
    : Array.isArray((response as { items?: unknown })?.items)
      ? (response as { items: unknown[] }).items
      : [];
  return candidates.filter(
    (tag): tag is TagRecord =>
      typeof (tag as TagRecord)?.id === "string" && typeof (tag as TagRecord)?.name === "string",
  );
}

/**
 * Find an existing tag by case-insensitive name, or create one if none
 * matches. Shared by bulk actions that accept a tag by name for convenience;
 * tagId (from tags_list) is still preferred when the caller already has it,
 * since it can't collide with an unrelated same-named tag.
 */
export async function findOrCreateTagId(tagName: string): Promise<string> {
  const tags = normalizeTagsResponse(await homebox.get("/v1/tags"));
  const wanted = tagName.trim().toLowerCase();
  const existing = tags.find((tag) => tag.name.trim().toLowerCase() === wanted);
  if (existing) return existing.id;

  const created = await homebox.post<TagRecord>("/v1/tags", { name: tagName.trim() });
  if (!created?.id) {
    throw new Error(`Homebox did not return an id for the newly created tag "${tagName}".`);
  }
  return created.id;
}

/** Resolve a tool input's tagId/tagName pair to a concrete tag id, creating the tag by name if needed. */
export async function resolveTagId(input: { tagId?: string; tagName?: string }): Promise<string> {
  if (input.tagId) return input.tagId;
  if (input.tagName) return findOrCreateTagId(input.tagName);
  throw new Error("Provide either tagId or tagName.");
}
