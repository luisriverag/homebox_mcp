import assert from "node:assert/strict";
import { test } from "node:test";
import { homebox } from "../src/homebox/client.js";
import { resultToContent } from "../src/mcp/server.js";
import { itemTools } from "../src/tools/items.js";

test("binary images become native MCP image content", () => {
  assert.deepEqual(
    resultToContent({
      kind: "binary",
      data: "aW1hZ2U=",
      mimeType: "image/jpeg",
      uri: "homebox://api/v1/entities/item/attachments/photo",
    }),
    [{ type: "image", data: "aW1hZ2U=", mimeType: "image/jpeg" }],
  );
});

test("binary documents become embedded MCP resources", () => {
  assert.deepEqual(
    resultToContent({
      kind: "binary",
      data: "ZG9jdW1lbnQ=",
      mimeType: "application/pdf",
      uri: "homebox://api/v1/entities/item/attachments/manual",
    }),
    [
      {
        type: "resource",
        resource: {
          uri: "homebox://api/v1/entities/item/attachments/manual",
          blob: "ZG9jdW1lbnQ=",
          mimeType: "application/pdf",
        },
      },
    ],
  );
});

test("structured tool results retain JSON details and append binary content", () => {
  const result = resultToContent({
    kind: "tool-content",
    value: { id: "item", name: "Camera" },
    binaries: [
      {
        kind: "binary",
        data: "aW1hZ2U=",
        mimeType: "image/png",
        uri: "homebox://api/v1/entities/item/attachments/photo",
      },
    ],
  });

  assert.deepEqual(result, [
    { type: "text", text: '{\n  "id": "item",\n  "name": "Camera"\n}' },
    { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
  ]);
});

test("items_photo_get downloads the primary photo and restores its image MIME type", async () => {
  const photoGet = itemTools.find((tool) => tool.name === "items_photo_get");
  assert.ok(photoGet);

  const originalGet = homebox.get.bind(homebox);
  const originalRequest = homebox.request.bind(homebox);
  homebox.get = (async () => ({
    id: "bow",
    attachments: [
      { id: "first", type: "photo", mimeType: "image/jpeg", primary: false },
      { id: "primary", type: "photo", mimeType: "image/png", primary: true },
    ],
  })) as typeof homebox.get;
  homebox.request = (async (_method: string, path: string) => {
    assert.equal(path, "/v1/entities/bow/attachments/primary");
    return {
      kind: "binary",
      data: "aW1hZ2U=",
      mimeType: "application/octet-stream",
      uri: `homebox://api${path}`,
    };
  }) as typeof homebox.request;

  try {
    const result = await photoGet.handler({ id: "bow" });
    assert.deepEqual(resultToContent(result), [
      {
        type: "text",
        text: JSON.stringify(
          {
            itemId: "bow",
            attachmentId: "primary",
            delivery:
              "The photo is included as native image content in this tool result. Do not emit an attachment: Markdown link; acknowledge briefly without reproducing the image URL.",
          },
          null,
          2,
        ),
      },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ]);
  } finally {
    homebox.get = originalGet;
    homebox.request = originalRequest;
  }
});

test("items_photo_get reports when an item has no photo", async () => {
  const photoGet = itemTools.find((tool) => tool.name === "items_photo_get");
  assert.ok(photoGet);

  const originalGet = homebox.get.bind(homebox);
  homebox.get = (async () => ({
    id: "bow",
    attachments: [{ id: "manual", type: "manual", mimeType: "application/pdf" }],
  })) as typeof homebox.get;

  try {
    await assert.rejects(photoGet.handler({ id: "bow" }), /Item bow has no photo attachments/);
  } finally {
    homebox.get = originalGet;
  }
});

test("items_get restores image MIME type for attachments served as octet-stream", async () => {
  const itemsGet = itemTools.find((tool) => tool.name === "items_get");
  assert.ok(itemsGet);

  const originalGet = homebox.get.bind(homebox);
  const originalRequest = homebox.request.bind(homebox);
  homebox.get = (async () => ({
    id: "camera",
    attachments: [{ id: "photo-1", type: "photo", mimeType: "image/jpeg", primary: true }],
  })) as typeof homebox.get;
  homebox.request = (async (_method: string, path: string) => ({
    kind: "binary",
    data: "aW1hZ2U=",
    mimeType: "application/octet-stream",
    uri: `homebox://api${path}`,
  })) as typeof homebox.request;

  try {
    const result: any = await itemsGet.handler({ id: "camera", includeAttachments: "photos" });
    assert.deepEqual(resultToContent(result), [
      { type: "text", text: JSON.stringify(result.value, null, 2) },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/jpeg" },
    ]);
  } finally {
    homebox.get = originalGet;
    homebox.request = originalRequest;
  }
});

test("items_attachment_get restores image MIME type using the item's attachment metadata", async () => {
  const attachmentGet = itemTools.find((tool) => tool.name === "items_attachment_get");
  assert.ok(attachmentGet);

  const originalGet = homebox.get.bind(homebox);
  const originalRequest = homebox.request.bind(homebox);
  homebox.get = (async () => ({
    id: "camera",
    attachments: [{ id: "photo-1", type: "photo", mimeType: "image/png", primary: true }],
  })) as typeof homebox.get;
  homebox.request = (async (_method: string, path: string) => {
    assert.equal(path, "/v1/entities/camera/attachments/photo-1");
    return {
      kind: "binary",
      data: "aW1hZ2U=",
      mimeType: "application/octet-stream",
      uri: `homebox://api${path}`,
    };
  }) as typeof homebox.request;

  try {
    const result = await attachmentGet.handler({ id: "camera", attachmentId: "photo-1" });
    assert.deepEqual(resultToContent(result), [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }]);
  } finally {
    homebox.get = originalGet;
    homebox.request = originalRequest;
  }
});

test("items_attachment_get leaves non-image MIME types untouched", async () => {
  const attachmentGet = itemTools.find((tool) => tool.name === "items_attachment_get");
  assert.ok(attachmentGet);

  const originalGet = homebox.get.bind(homebox);
  const originalRequest = homebox.request.bind(homebox);
  homebox.get = (async () => ({
    id: "camera",
    attachments: [{ id: "manual-1", type: "manual", mimeType: "application/pdf" }],
  })) as typeof homebox.get;
  homebox.request = (async (_method: string, path: string) => ({
    kind: "binary",
    data: "ZG9jdW1lbnQ=",
    mimeType: "application/pdf",
    uri: `homebox://api${path}`,
  })) as typeof homebox.request;

  try {
    const result = await attachmentGet.handler({ id: "camera", attachmentId: "manual-1" });
    assert.deepEqual(resultToContent(result), [
      {
        type: "resource",
        resource: {
          uri: "homebox://api/v1/entities/camera/attachments/manual-1",
          blob: "ZG9jdW1lbnQ=",
          mimeType: "application/pdf",
        },
      },
    ]);
  } finally {
    homebox.get = originalGet;
    homebox.request = originalRequest;
  }
});
