import assert from "node:assert/strict";
import { test } from "node:test";
import { resultToContent } from "../src/mcp/server.js";

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
