import { homebox } from "./client.js";
import type { EntityOut } from "./entityMerge.js";

export interface SpendFilters {
  startDate?: string;
  endDate?: string;
  locationIds?: string[];
  tagIds?: string[];
}

export interface SpendBucket {
  key: string;
  label: string;
  total: number;
  count: number;
}

export interface SpendSummary {
  /** Items considered before purchase-price/date filtering. */
  scanned: number;
  /** Items with a positive purchase price (and within the date range, if given). */
  matched: number;
  totalSpend: number;
  byVendor: SpendBucket[];
  byLocation: SpendBucket[];
  byTag: SpendBucket[];
  /** Chronological, key = YYYY-MM. */
  byMonth: SpendBucket[];
}

async function paginateEntities(query: Record<string, unknown>): Promise<EntityOut[]> {
  const out: EntityOut[] = [];
  let page = 1;
  for (;;) {
    const response = await homebox.get<{ items?: EntityOut[] } | EntityOut[]>("/v1/entities", {
      ...query,
      page,
      pageSize: 200,
    });
    const batch = Array.isArray(response) ? response : (response.items ?? []);
    out.push(...batch);
    if (batch.length < 200) break;
    page += 1;
  }
  return out;
}

async function fetchCandidateIds(filters: SpendFilters): Promise<string[]> {
  const query: Record<string, unknown> = { isLocation: false };
  if (filters.tagIds?.length) query.tags = filters.tagIds;
  if (filters.locationIds?.length) query.parentIds = filters.locationIds;
  const entities = await paginateEntities(query);
  return entities.filter((entity) => entity.id && !entity.entityType?.isLocation).map((entity) => entity.id!);
}

async function fetchDetails(ids: string[]): Promise<EntityOut[]> {
  const details: EntityOut[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const fetched = await Promise.all(batch.map((id) => homebox.get<EntityOut>(`/v1/entities/${id}`)));
    details.push(...fetched);
  }
  return details;
}

async function fetchLocationNames(ids: Set<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.size === 0) return map;
  const locations = await paginateEntities({ isLocation: true });
  for (const location of locations) {
    if (location.id && ids.has(location.id)) map.set(location.id, location.name ?? location.id);
  }
  return map;
}

async function fetchTagNames(ids: Set<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.size === 0) return map;
  const response = await homebox.get<unknown>("/v1/tags");
  const tags = Array.isArray(response)
    ? response
    : Array.isArray((response as { items?: unknown })?.items)
      ? (response as { items: unknown[] }).items
      : [];
  for (const tag of tags as Array<{ id?: string; name?: string }>) {
    if (tag.id && ids.has(tag.id)) map.set(tag.id, tag.name ?? tag.id);
  }
  return map;
}

function parseDateMs(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function monthKey(iso: string): string | undefined {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return undefined;
  const date = new Date(parsed);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addToBucket(buckets: Map<string, SpendBucket>, key: string, label: string, amount: number): void {
  const existing = buckets.get(key);
  if (existing) {
    existing.total += amount;
    existing.count += 1;
  } else {
    buckets.set(key, { key, label, total: amount, count: 1 });
  }
}

function topBuckets(buckets: Map<string, SpendBucket>, topN: number): SpendBucket[] {
  return [...buckets.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, topN)
    .map((bucket) => ({ ...bucket, total: round2(bucket.total) }));
}

/**
 * Aggregate purchase spending across the inventory. Purchase price/date/
 * vendor aren't present on the /v1/entities list response (only on full
 * item detail, the same reason deepSearchItems fetches details in batches),
 * so this fetches every candidate item's full record -- slow on a large
 * inventory, which is why locationIds/tagIds narrow the candidate set
 * server-side before that fetch, while startDate/endDate can only filter
 * afterward once purchaseDate is known.
 */
export async function computeSpendSummary(filters: SpendFilters, topN = 20): Promise<SpendSummary> {
  const candidateIds = await fetchCandidateIds(filters);
  const details = await fetchDetails(candidateIds);

  const startMs = parseDateMs(filters.startDate);
  const endMs = parseDateMs(filters.endDate);

  const withPurchase = details.filter((item) => {
    if (typeof item.purchasePrice !== "number" || item.purchasePrice <= 0) return false;
    if (startMs === undefined && endMs === undefined) return true;
    const purchasedMs = parseDateMs(item.purchaseDate);
    if (purchasedMs === undefined) return false;
    if (startMs !== undefined && purchasedMs < startMs) return false;
    if (endMs !== undefined && purchasedMs > endMs) return false;
    return true;
  });

  const locationIdsWanted = new Set<string>();
  const tagIdsWanted = new Set<string>();
  for (const item of withPurchase) {
    if (item.parent?.id) locationIdsWanted.add(item.parent.id);
    for (const tag of item.tags ?? []) tagIdsWanted.add(tag.id);
  }
  const [locationNames, tagNames] = await Promise.all([
    fetchLocationNames(locationIdsWanted),
    fetchTagNames(tagIdsWanted),
  ]);

  const byVendor = new Map<string, SpendBucket>();
  const byLocation = new Map<string, SpendBucket>();
  const byTag = new Map<string, SpendBucket>();
  const byMonth = new Map<string, SpendBucket>();
  let totalSpend = 0;

  for (const item of withPurchase) {
    const amount = item.purchasePrice ?? 0;
    totalSpend += amount;

    const vendor = item.purchaseFrom?.trim() || "(unknown vendor)";
    addToBucket(byVendor, vendor, vendor, amount);

    const locationId = item.parent?.id;
    const locationKey = locationId ?? "(no location)";
    const locationLabel = locationId ? (locationNames.get(locationId) ?? locationId) : "(no location)";
    addToBucket(byLocation, locationKey, locationLabel, amount);

    const tags = item.tags ?? [];
    if (tags.length === 0) {
      addToBucket(byTag, "(no tag)", "(no tag)", amount);
    } else {
      // Equal-split allocation: an item with N tags contributes amount/N to
      // each, so a multi-tag item doesn't inflate every one of its tags'
      // totals by the item's full price.
      const share = amount / tags.length;
      for (const tag of tags) {
        addToBucket(byTag, tag.id, tagNames.get(tag.id) ?? tag.id, share);
      }
    }

    if (item.purchaseDate) {
      const key = monthKey(item.purchaseDate);
      if (key) addToBucket(byMonth, key, key, amount);
    }
  }

  return {
    scanned: candidateIds.length,
    matched: withPurchase.length,
    totalSpend: round2(totalSpend),
    byVendor: topBuckets(byVendor, topN),
    byLocation: topBuckets(byLocation, topN),
    byTag: topBuckets(byTag, topN),
    byMonth: [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)).map((bucket) => ({
      ...bucket,
      total: round2(bucket.total),
    })),
  };
}
