export interface EntityOut {
  id?: string;
  archived?: boolean;
  assetId?: string;
  description?: string;
  entityTypeId?: string;
  fields?: unknown[];
  insured?: boolean;
  tags?: { id: string }[];
  lifetimeWarranty?: boolean;
  parent?: { id: string } | null;
  manufacturer?: string;
  modelNumber?: string;
  name?: string;
  notes?: string;
  purchaseFrom?: string;
  purchasePrice?: number;
  purchaseDate?: string;
  quantity?: number;
  serialNumber?: string;
  soldNotes?: string;
  soldPrice?: number;
  soldDate?: string;
  soldTo?: string;
  warrantyDetails?: string;
  warrantyExpires?: string;
  entityType?: { id?: string; isLocation?: boolean };
  attachments?: Array<{
    id: string;
    mimeType?: string;
    title?: string;
    type?: string;
  }>;
}

/**
 * Homebox's PUT /v1/entities/{id} replaces almost every scalar field
 * unconditionally (name, description, archived, insured, quantity,
 * purchase/sold info, etc — any field the request omits is reset to its
 * zero value), and treats tagIds as a diff against the entity's *current*
 * tags rather than a partial field: omit it entirely and every existing
 * tag is removed, since an absent JSON key and an explicit `[]` are
 * indistinguishable once unmarshaled. So a real partial update means
 * fetching the current entity and re-sending everything, overriding only
 * what the caller actually asked to change.
 */
export function entityUpdateBodyFromCurrent(current: EntityOut) {
  return {
    archived: current.archived,
    assetId: current.assetId,
    description: current.description,
    entityTypeId: current.entityType?.id,
    fields: current.fields,
    insured: current.insured,
    tagIds: current.tags?.map((tag) => tag.id) ?? [],
    lifetimeWarranty: current.lifetimeWarranty,
    manufacturer: current.manufacturer,
    modelNumber: current.modelNumber,
    name: current.name,
    notes: current.notes,
    parentId: current.parent?.id ?? null,
    purchaseFrom: current.purchaseFrom,
    purchasePrice: current.purchasePrice,
    purchaseDate: current.purchaseDate,
    quantity: current.quantity,
    serialNumber: current.serialNumber,
    soldNotes: current.soldNotes,
    soldPrice: current.soldPrice,
    soldDate: current.soldDate,
    soldTo: current.soldTo,
    warrantyDetails: current.warrantyDetails,
    warrantyExpires: current.warrantyExpires,
  };
}
