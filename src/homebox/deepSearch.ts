export type DeepSearchOperator = "contains" | "equals" | "gt" | "gte" | "lt" | "lte";

export interface DeepSearchFilter {
  field: string;
  operator: DeepSearchOperator;
  value: string | number | boolean;
}

export interface DeepSearchOptions {
  q?: string;
  filters?: DeepSearchFilter[];
  match?: "all" | "any";
  includeArchived?: boolean;
}

interface EntityReader {
  get<T = unknown>(path: string, query?: Record<string, unknown>): Promise<T>;
}

function normalize(value: unknown): string {
  return String(value).trim().toLocaleLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function scalarValues(value: unknown): Array<string | number | boolean> {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [value];
  if (Array.isArray(value)) return value.flatMap(scalarValues);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(scalarValues);
  return [];
}

function fieldValues(item: any, field: string): Array<string | number | boolean> {
  const direct = field.split(".").reduce<unknown>((value, key) => {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  }, item);
  if (direct !== undefined) return scalarValues(direct);

  const customField = Array.isArray(item?.fields)
    ? item.fields.find((candidate: any) => normalize(candidate?.name) === normalize(field))
    : undefined;
  if (!customField) return [];
  if (customField.type === "number") return scalarValues(customField.numberValue);
  if (customField.type === "boolean") return scalarValues(customField.booleanValue);
  if (customField.type === "text") return scalarValues(customField.textValue);
  return scalarValues([customField.textValue, customField.numberValue, customField.booleanValue]);
}

function comparable(value: unknown): number {
  if (typeof value === "number") return value;
  const numeric = Number(value);
  if (typeof value !== "string" || value.trim() === "" || Number.isFinite(numeric)) return numeric;
  return Date.parse(value);
}

function matchesFilter(item: unknown, filter: DeepSearchFilter): boolean {
  return fieldValues(item, filter.field).some((actual) => {
    if (filter.operator === "contains") return normalize(actual).includes(normalize(filter.value));
    if (filter.operator === "equals") return normalize(actual) === normalize(filter.value);
    const left = comparable(actual);
    const right = comparable(filter.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (filter.operator === "gt") return left > right;
    if (filter.operator === "gte") return left >= right;
    if (filter.operator === "lt") return left < right;
    return left <= right;
  });
}

/** Exhaustively retrieve entity details, filter locally, and paginate matches. */
export async function deepSearchItems(
  client: EntityReader,
  candidateFilters: Record<string, unknown>,
  options: DeepSearchOptions,
  requestedPage: number,
  requestedPageSize: number,
) {
  const ids = new Set<string>();
  let page = 1;
  let total = 0;
  do {
    const response: any = await client.get("/v1/entities", {
      ...candidateFilters,
      includeArchived: options.includeArchived || undefined,
      page,
      pageSize: 200,
    });
    const batch = Array.isArray(response?.items) ? response.items : [];
    for (const item of batch) {
      if (typeof item?.id === "string") ids.add(item.id);
    }
    total = typeof response?.total === "number" ? response.total : ids.size;
    if (!batch.length) break;
    page += 1;
  } while (ids.size < total);

  const details: any[] = [];
  const entityIds = [...ids];
  for (let index = 0; index < entityIds.length; index += 10) {
    details.push(
      ...(await Promise.all(
        entityIds.slice(index, index + 10).map((id) => client.get(`/v1/entities/${id}`)),
      )),
    );
  }
  const matches = details.filter(
    (item) =>
      !item?.entityType?.isLocation &&
      matchesDeepSearch(item, options.q, options.filters, options.match),
  );
  const start = (requestedPage - 1) * requestedPageSize;
  return {
    items: matches.slice(start, start + requestedPageSize),
    page: requestedPage,
    pageSize: requestedPageSize,
    total: matches.length,
    scanned: entityIds.length,
    deepSearch: true,
  };
}

export function matchesDeepSearch(
  item: unknown,
  query?: string,
  filters: DeepSearchFilter[] = [],
  match: "all" | "any" = "all",
): boolean {
  const queryMatches = !query || scalarValues(item).some((value) => normalize(value).includes(normalize(query)));
  const filterMatches = filters.map((filter) => matchesFilter(item, filter));
  const structuredMatches = !filterMatches.length || (match === "all" ? filterMatches.every(Boolean) : filterMatches.some(Boolean));
  return queryMatches && structuredMatches;
}
