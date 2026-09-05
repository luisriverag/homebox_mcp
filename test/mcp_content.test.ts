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
