/**
 * Common English/Spanish inventory names that are useful even when an MCP
 * client supplies only the user's original wording. Keep groups deliberately
 * small: every term causes another Homebox request.
 */
const ALIAS_GROUPS = [
  ["bike", "bicycle", "bici", "bicicleta"],
  ["car", "automobile", "coche", "auto", "automóvil"],
  ["computer", "pc", "computadora", "ordenador"],
  ["cellphone", "mobile phone", "phone", "celular", "móvil", "teléfono"],
  ["television", "tv", "televisor", "televisión"],
] as const;

export interface SearchTag {
  id?: unknown;
  name?: unknown;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function words(value: string): string[] {
  return normalized(value).split(/[^\p{Letter}\p{Number}]+/u).filter(Boolean);
}

function replaceStandaloneTerm(value: string, term: string, replacement: string): string | undefined {
  const words = value.split(/(\s+)/);
  const termKey = normalized(term);
  let changed = false;
  const replaced = words.map((word) => {
    if (normalized(word) !== termKey) return word;
    changed = true;
    return replacement;
  });
  return changed ? replaced.join("") : undefined;
}

/** Build a bounded, case/accent-insensitive set of searches, original first. */
export function buildSearchTerms(query: string, alternateNames: string[] = []): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    const trimmed = term.trim();
    const key = normalized(trimmed);
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      terms.push(trimmed);
    }
  };

  add(query);
  for (const alternate of alternateNames) add(alternate);

  // Expand a group if either the original query or a caller-provided name
  // identifies it. Also replace aliases within a multi-word query, so
  // "red bike" searches for "red bicycle", "red bici", and so on.
  for (const group of ALIAS_GROUPS) {
    const seeds = [...terms];
    const matchedAlias = group.find((alias) =>
      seeds.some(
        (seed) =>
          normalized(seed) === normalized(alias) || replaceStandaloneTerm(seed, alias, alias) !== undefined,
      ),
    );
    if (!matchedAlias) continue;

    for (const seed of seeds) {
      for (const alias of group) {
        if (normalized(seed) === normalized(matchedAlias)) add(alias);
        else {
          const expanded = replaceStandaloneTerm(seed, matchedAlias, alias);
          if (expanded) add(expanded);
        }
      }
    }
  }

  return terms;
}

/**
 * Find tags whose complete name occurs in one of the expanded search terms.
 * Matching whole words avoids treating short tag names as arbitrary substrings
 * (for example, an "art" tag must not match "cart").
 */
export function findRelevantTags(tagsResponse: unknown, searchTerms: string[]): Array<{ id: string; name: string }> {
  const response = tagsResponse as { items?: unknown };
  const tags = Array.isArray(tagsResponse)
    ? tagsResponse
    : Array.isArray(response?.items)
      ? response.items
      : [];
  const termWords = searchTerms.map(words);
  const relevant: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();

  for (const candidate of tags as SearchTag[]) {
    if (typeof candidate?.id !== "string" || typeof candidate?.name !== "string") continue;
    const tagWords = words(candidate.name);
    if (!tagWords.length) continue;
    const matches = termWords.some((term) =>
      term.some((_, index) =>
        term.slice(index, index + tagWords.length).every((word, offset) => word === tagWords[offset]),
      ),
    );
    if (matches && !seen.has(candidate.id)) {
      seen.add(candidate.id);
      relevant.push({ id: candidate.id, name: candidate.name });
    }
  }
  return relevant;
}

/** Combine Homebox result pages without returning the same entity twice. */
export function mergeEntitySearchResults(results: any[], searchTerms: string[]): any {
  const first = results[0] ?? { items: [] };
  const items: any[] = [];
  const seenIds = new Set<string>();

  for (const result of results) {
    if (!Array.isArray(result?.items)) continue;
    for (const item of result.items) {
      const entityId = typeof item?.id === "string" ? item.id : undefined;
      if (entityId && seenIds.has(entityId)) continue;
      if (entityId) seenIds.add(entityId);
      items.push(item);
    }
  }

  return { ...first, items, searchTerms };
}
