import assert from "node:assert/strict";
import { test } from "node:test";
import { homebox } from "../src/homebox/client.js";
import { findOrCreateTagId, resolveTagId } from "../src/homebox/tagResolve.js";

test("resolveTagId returns tagId directly when supplied", async () => {
  assert.equal(await resolveTagId({ tagId: "abc" }), "abc");
});

test("resolveTagId throws when neither tagId nor tagName is supplied", async () => {
  await assert.rejects(() => resolveTagId({}), /Provide either tagId or tagName/);
});

test("findOrCreateTagId matches an existing tag case-insensitively", async () => {
  const originalGet = homebox.get.bind(homebox);
  const originalPost = homebox.post.bind(homebox);
  homebox.get = (async () => [{ id: "tag-1", name: "Books" }]) as typeof homebox.get;
  homebox.post = (async () => {
    throw new Error("should not create a tag that already exists");
  }) as typeof homebox.post;

  try {
    assert.equal(await findOrCreateTagId("books"), "tag-1");
  } finally {
    homebox.get = originalGet;
    homebox.post = originalPost;
  }
});

test("findOrCreateTagId creates a tag when no match exists", async () => {
  const originalGet = homebox.get.bind(homebox);
  const originalPost = homebox.post.bind(homebox);
  const posted: unknown[] = [];
  homebox.get = (async () => ({ items: [{ id: "tag-1", name: "Books" }] })) as typeof homebox.get;
  homebox.post = (async (_path: string, body?: unknown) => {
    posted.push(body);
    return { id: "tag-2", name: "Electronics" };
  }) as typeof homebox.post;

  try {
    assert.equal(await findOrCreateTagId("Electronics"), "tag-2");
    assert.deepEqual(posted, [{ name: "Electronics" }]);
  } finally {
    homebox.get = originalGet;
    homebox.post = originalPost;
  }
});
