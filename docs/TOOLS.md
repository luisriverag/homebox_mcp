# Tool reference

homebox-mcp exposes 65 tools when `READONLY=N`. With `READONLY=Y`, only the
tools marked **Read** below are registered; write tools are absent from MCP tool
discovery entirely. A tool marked **Write** may create, modify, delete, upload,
send, or run an inventory-wide action.

The connected MCP client receives the full input schema and description for
each registered tool. This page is a compact index for operators deciding what
the server can do; the TypeScript definitions in [`src/tools`](../src/tools)
remain the source of truth for individual parameters.

## Items and attachments

| Access | Tool | Purpose |
|---|---|---|
| Read | `items_list` | Search every supplied alternate name and discovered related-tag ID, then combine unique inventory items. |
| Read | `items_get` | Get one item's details, optionally with photo/document content (`includeAttachments`). |
| Read | `items_photo_get` | Return an item's primary (or first) photo as native MCP image content. |
| Read | `items_path` | Get an item's ancestor-location breadcrumb. |
| Read | `items_fields` | List custom-field names in use. |
| Read | `items_field_values` | List values used by one custom field. |
| Read | `items_export` | Export the inventory as CSV. |
| Write | `items_create` | Create an item. |
| Write | `items_update` | Update item details while preserving omitted fields. |
| Write | `items_patch` | Patch quantity, tags, parent, or entity type. |
| Write | `items_delete` | Permanently delete an item. |
| Write | `items_import` | Import Homebox-format CSV data. |
| Write | `items_attachment_add` | Upload a file attachment. |
| Write | `items_attachment_add_external` | Add an external document or URL. |
| Read | `items_attachment_get` | Return a photo as MCP image content (MIME-corrected) or a document as an embedded MCP resource. |
| Write | `items_attachment_update` | Update attachment metadata or primary-photo status. |
| Write | `items_attachment_delete` | Delete an attachment. |

`items_get` (with `includeAttachments`), `items_photo_get`, and
`items_attachment_get` share a `restoreImageMimeType` helper
(`src/tools/items.ts`) that restores an attachment's declared image MIME type
on the binary they return whenever Homebox's own download response reports a
generic type instead — otherwise the MCP client falls back to an embedded
resource block instead of a native photo.

### `items_list` search inputs

| Input | Behavior |
|---|---|
| `q` | The user's original free-text query. |
| `alternateNames` | Additional translations, singular/plural forms, synonyms, and abbreviations. Each is searched independently. |
| `relatedTagIds` | Tag IDs selected semantically from `tags_list`. Each tag is searched independently and its results are added to the text results. This is the preferred tag-discovery input. |
| `tagNames` | Relevant tag names when IDs are unavailable. The server resolves complete tag names case- and accent-insensitively, then performs the same additive searches. |
| `tags` | A strict Homebox tag filter. Unlike `relatedTagIds`, this narrows text searches and disables additive tag searches. |
| `parentIds` | Restricts searches to the supplied parent item/location IDs. |
| `deepSearch` | Opt-in exhaustive search over complete item details. Its `q` searches every scalar value; structured `filters` support top-level fields, dotted paths, and custom-field names with `contains`, `equals`, numeric/date comparison operators, and optional archived-item inclusion. |

Deep search retrieves all candidate pages and then fetches complete item details
in batches of ten before filtering locally. It can therefore find values that
Homebox's normal text search does not index, including `purchaseFrom`, purchase
or sale amounts, warranty data, and custom fields. Use ordinary `q` search when
possible because deep search can be slow on large inventories.
The result reports `scanned` so callers can explain the scope of the search.

For a request such as “find all my motorbike things,” a client should first
call `tags_list`. If the inventory contains a `Motorcycle` tag, call
`items_list` with approximately:

```json
{
  "q": "motorbike",
  "alternateNames": ["motorcycle", "moto", "motocicleta"],
  "relatedTagIds": ["the-motorcycle-tag-id"]
}
```

The returned `items` are deduplicated across all searches. `searchTerms` shows
the text queries attempted, `searchedTagIds` shows all additive tag IDs used,
and `matchedTags` contains the tag records resolved from `tagNames` (or from
literal tag names found in the text terms). Pagination options are sent to each
individual Homebox search, so the merged result count can exceed `pageSize`.

## Maintenance

| Access | Tool | Purpose |
|---|---|---|
| Read | `items_maintenance_list` | List maintenance entries for one item. |
| Read | `maintenance_list_all` | List maintenance entries across inventory. |
| Write | `items_maintenance_create` | Add a maintenance entry. |
| Write | `items_maintenance_update` | Update a maintenance entry. |
| Write | `items_maintenance_delete` | Delete a maintenance entry. |

## Locations, tags, and entity types

| Access | Tool | Purpose |
|---|---|---|
| Read | `locations_list` | List locations as a flat collection. |
| Read | `locations_tree` | Get the nested location tree. |
| Read | `locations_get` | Get a location and its children. |
| Write | `locations_create` | Create a location. |
| Write | `locations_update` | Update or move a location. |
| Write | `locations_delete` | Delete a location; contained items become unassigned. |
| Read | `tags_list` | List tags for browsing and semantic discovery before an item search. |
| Read | `tags_get` | Get a tag and its tagged items. |
| Write | `tags_create` | Create a tag. |
| Write | `tags_update` | Update a tag. |
| Write | `tags_delete` | Delete a tag and remove it from items. |
| Read | `entity_types_list` | List item/location templates and IDs. |

## Notifiers

| Access | Tool | Purpose |
|---|---|---|
| Read | `notifiers_list` | List notifier targets. |
| Write | `notifiers_create` | Create a notifier target. |
| Write | `notifiers_update` | Update a notifier target. |
| Write | `notifiers_delete` | Delete a notifier target. |
| Write | `notifiers_test` | Send a test notification to a supplied URL. |

## Users and groups

| Access | Tool | Purpose |
|---|---|---|
| Read | `users_self_get` | Get the authenticated user's profile. |
| Write | `users_self_update` | Update the authenticated user's profile. |
| Write | `users_self_delete` | Permanently delete the authenticated account and its data. |
| Write | `users_change_password` | Change the authenticated user's password. |
| Write | `users_register` | Register a user with an invitation token. |
| Read | `group_get` | Get group settings. |
| Write | `group_update` | Update group settings. |
| Write | `group_invitations_create` | Create an invitation. |
| Read | `group_invitations_list` | List outstanding invitations. |
| Write | `group_invitations_delete` | Revoke an invitation. |
| Read | `group_members_list` | List group members. |
| Write | `group_members_remove` | Remove a member from the group. |
| Read | `group_statistics` | Get high-level inventory statistics. |
| Read | `group_statistics_tags` | Get statistics grouped by tag. |
| Read | `group_statistics_locations` | Get statistics grouped by location. |
| Read | `group_statistics_purchase_price` | Get purchase-price statistics over time. |

## Bulk actions

These write tools operate across the inventory rather than on a single item.

| Access | Tool | Purpose |
|---|---|---|
| Write | `actions_ensure_asset_ids` | Assign missing asset IDs. |
| Write | `actions_ensure_import_refs` | Assign missing import references. |
| Write | `actions_set_primary_photos` | Set first photos as primary photos. |
| Write | `actions_zero_item_time_fields` | Reset item timestamps to the start of their day. |
| Write | `actions_create_missing_thumbnails` | Generate missing photo thumbnails. |

## Status, lookup, and reporting

| Access | Tool | Purpose |
|---|---|---|
| Read | `status_get` | Get Homebox status, health, and version data. |
| Read | `currency_list` | List supported currencies. |
| Read | `assets_get_by_id` | Find an item by its numeric asset ID. |
| Read | `qrcode_generate` | Return a QR code as base64-encoded JPEG data. |
| Read | `reporting_bill_of_materials` | Export a bill-of-materials report as CSV. |

## Typical lookup flow

Most entity relationships use UUIDs rather than display names. A client can
resolve those IDs before a write operation:

1. Call `locations_tree` to find the destination location ID.
2. Call `tags_list` to find any tag IDs.
3. Call `entity_types_list` if a custom item or location template is needed.
4. Call `items_create` or `items_update` with the resolved IDs.
5. Call `items_get` to verify the resulting record.

For safety, clients should retrieve the current object before destructive or
broad changes and request explicit user confirmation before calling deletion,
member-removal, account-deletion, import, or bulk-action tools.

If a call instead references an entity id that no longer exists (or was
mistyped/fabricated while being reused across calls), the resulting error
names the closest real id when one is a confident-enough match — see
[Requests return `404`](../README.md#requests-return-404) in the README.
