import assert from "node:assert/strict";
import { test } from "node:test";
import { homebox } from "../src/homebox/client.js";
import { actionTools } from "../src/tools/actions.js";

function tool(name: string) {
  const found = actionTools.find((t) => t.name === name);
  assert.ok(found, `tool ${name} not found`);
  return found!;
}

test("actions_tag_subtree tags the root and every discovered descendant", async () => {
  const originalGet = homebox.get.bind(homebox);
  const originalPatch = homebox.patch.bind(homebox);
  const patched: Array<{ id: string; body: any }> = [];

  homebox.get = (async (path: string, query?: any) => {
    if (path === "/v1/tags") return [{ id: "tag-1", name: "Donated" }];
    if (path === "/v1/entities/root") return { id: "root", name: "Box", tags: [] };
    if (path === "/v1/entities") {
      if (query?.page > 1) return { items: [] };
      const parentIds: string[] = query.parentIds ?? [];
      if (parentIds.includes("root")) return { items: [{ id: "child-1", name: "Widget", tags: [{ id: "other-tag" }] }] };
      return { items: [] };
    }
    throw new Error(`Unexpected GET ${path}`);
  }) as typeof homebox.get;

  homebox.patch = (async (path: string, body?: any) => {
    patched.push({ id: path, body });
    return {};
  }) as typeof homebox.patch;

  try {
    const result = (await tool("actions_tag_subtree").handler({ rootId: "root", tagName: "Donated" })) as any;

    assert.equal(result.tagId, "tag-1");
    assert.equal(result.affectedCount, 2);
    assert.equal(result.truncated, false);
    assert.deepEqual(
      result.results.map((r: any) => r.status),
      ["tagged", "tagged"],
    );
    assert.deepEqual(patched, [
      { id: "/v1/entities/root", body: { tagIds: ["tag-1"] } },
      { id: "/v1/entities/child-1", body: { tagIds: ["other-tag", "tag-1"] } },
    ]);
  } finally {
    homebox.get = originalGet;
    homebox.patch = originalPatch;
  }
});

test("actions_tag_subtree skips items that already carry the tag and honors dryRun", async () => {
  const originalGet = homebox.get.bind(homebox);
  const originalPatch = homebox.patch.bind(homebox);

  homebox.get = (async (path: string, query?: any) => {
    if (path === "/v1/entities/root") return { id: "root", name: "Box", tags: [{ id: "tag-1" }] };
    if (path === "/v1/entities") {
      if (query?.page > 1) return { items: [] };
      const parentIds: string[] = query.parentIds ?? [];
      if (parentIds.includes("root")) return { items: [{ id: "child-1", name: "Widget", tags: [] }] };
      return { items: [] };
    }
    throw new Error(`Unexpected GET ${path}`);
  }) as typeof homebox.get;

  homebox.patch = (async () => {
    throw new Error("dryRun/already-tagged items must not call patch");
  }) as typeof homebox.patch;

  try {
    const result = (await tool("actions_tag_subtree").handler({ rootId: "root", tagId: "tag-1", dryRun: true })) as any;
    assert.deepEqual(
      result.results.map((r: any) => r.status),
      ["already-tagged", "would-tag"],
    );
  } finally {
    homebox.get = originalGet;
    homebox.patch = originalPatch;
  }
});

test("actions_attach_photo_by_tag skips items that already have a photo unless force is set", async () => {
  const originalGet = homebox.get.bind(homebox);
  const originalRequest = homebox.request.bind(homebox);
  const uploaded: string[] = [];

  homebox.get = (async (path: string) => {
    if (path === "/v1/tags/tag-1") {
      return { items: [{ id: "has-photo", name: "A" }, { id: "no-photo", name: "B" }] };
    }
    if (path === "/v1/entities/has-photo") return { attachments: [{ id: "att-1", type: "photo" }] };
    if (path === "/v1/entities/no-photo") return { attachments: [] };
    throw new Error(`Unexpected GET ${path}`);
  }) as typeof homebox.get;

  homebox.request = (async (method: string, path: string) => {
    if (method === "POST" && path.endsWith("/attachments")) {
      uploaded.push(path);
      return {};
    }
    throw new Error(`Unexpected ${method} ${path}`);
  }) as typeof homebox.request;

  try {
    const result = (await tool("actions_attach_photo_by_tag").handler({
      tagId: "tag-1",
      fileBase64: Buffer.from("fake-image").toString("base64"),
      fileName: "photo.jpg",
    })) as any;

    assert.equal(result.matchedCount, 2);
    assert.deepEqual(
      result.results.map((r: any) => [r.id, r.status]),
      [
        ["has-photo", "skipped-has-photo"],
        ["no-photo", "uploaded"],
      ],
    );
    assert.deepEqual(uploaded, ["/v1/entities/no-photo/attachments"]);
  } finally {
    homebox.get = originalGet;
    homebox.request = originalRequest;
  }
});

test("actions_attach_photo_by_tag excludes locations from a tag's items", async () => {
  const originalGet = homebox.get.bind(homebox);
  const originalRequest = homebox.request.bind(homebox);
  const uploaded: string[] = [];

  homebox.get = (async (path: string) => {
    if (path === "/v1/tags/tag-1") {
      return {
        items: [
          { id: "loc-1", name: "Garage", entityType: { isLocation: true } },
          { id: "item-1", name: "Drill", attachments: [] },
        ],
      };
    }
    if (path === "/v1/entities/item-1") return { attachments: [] };
    throw new Error(`Unexpected GET ${path} -- a location must never be fetched/uploaded to`);
  }) as typeof homebox.get;

  homebox.request = (async (method: string, path: string) => {
    uploaded.push(path);
    return {};
  }) as typeof homebox.request;

  try {
    const result = (await tool("actions_attach_photo_by_tag").handler({
      tagId: "tag-1",
      fileBase64: Buffer.from("fake-image").toString("base64"),
      fileName: "photo.jpg",
    })) as any;

    assert.equal(result.matchedCount, 1);
    assert.deepEqual(result.results.map((r: any) => r.id), ["item-1"]);
    assert.deepEqual(uploaded, ["/v1/entities/item-1/attachments"]);
  } finally {
    homebox.get = originalGet;
    homebox.request = originalRequest;
  }
});

test("actions_attach_photo_by_tag uploads to every matching item when force is set", async () => {
  const originalGet = homebox.get.bind(homebox);
  const originalRequest = homebox.request.bind(homebox);
  const uploaded: string[] = [];

  homebox.get = (async (path: string) => {
    if (path === "/v1/tags/tag-1") return { items: [{ id: "has-photo", name: "A" }] };
    throw new Error(`Unexpected GET ${path} (force=true must not check attachments)`);
  }) as typeof homebox.get;

  homebox.request = (async (method: string, path: string) => {
    uploaded.push(path);
    return {};
  }) as typeof homebox.request;

  try {
    const result = (await tool("actions_attach_photo_by_tag").handler({
      tagId: "tag-1",
      fileBase64: Buffer.from("fake-image").toString("base64"),
      fileName: "photo.jpg",
      force: true,
    })) as any;
    assert.deepEqual(
      result.results.map((r: any) => r.status),
      ["uploaded"],
    );
    assert.deepEqual(uploaded, ["/v1/entities/has-photo/attachments"]);
  } finally {
    homebox.get = originalGet;
    homebox.request = originalRequest;
  }
});
