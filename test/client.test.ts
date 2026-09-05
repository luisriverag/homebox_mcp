import assert from "node:assert/strict";
import { test } from "node:test";
import { HomeboxClient } from "../src/homebox/client.js";

/** Skips the real login handshake by seeding a token directly. */
function withFakeToken(client: HomeboxClient): void {
  (client as any).token = { token: "fake-token", expiresAt: Date.now() + 60_000 };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function withMockedFetch<T>(handler: (url: string) => Promise<Response>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string) => handler(url)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const CANDIDATES = [
  { id: "fafa322e-e1a9-481c-b5b6-a32ffa5bf33f", name: "Nevera LG Electronics GSJ760PZUZ" },
  { id: "3ee1ea2a-2f7d-4d71-9c73-daf6c47da1b7", name: "Nevera Redbull" },
];

test("enriches a 400 invalid-route-key error with a fuzzy-matched suggestion", async () => {
  const client = new HomeboxClient("http://fake-homebox.test");
  withFakeToken(client);

  await withMockedFetch(
    async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/v1/entities") return jsonResponse({ items: CANDIDATES }, 200);
      return jsonResponse({ error: "invalid route key: id" }, 400);
    },
    async () => {
      await assert.rejects(client.get("/v1/entities/fafa322e-e1a9-481c-b5b6-a3tan5bf33f"), (err: any) => {
        assert.match(
          err.message,
          /Did you mean "fafa322e-e1a9-481c-b5b6-a32ffa5bf33f" \("Nevera LG Electronics GSJ760PZUZ"\)/,
        );
        return true;
      });
    },
  );
});

test("enriches a 404 not-found error with a fuzzy-matched suggestion", async () => {
  const client = new HomeboxClient("http://fake-homebox.test");
  withFakeToken(client);

  await withMockedFetch(
    async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/v1/entities") return jsonResponse({ items: CANDIDATES }, 200);
      return jsonResponse({ error: "Not Found" }, 404);
    },
    async () => {
      await assert.rejects(
        client.get("/v1/entities/3ee1ea2a-2f7d-4d71-9c73-daf6c47da1b"), // missing trailing "7"
        (err: any) => {
          assert.match(err.message, /Did you mean "3ee1ea2a-2f7d-4d71-9c73-daf6c47da1b7" \("Nevera Redbull"\)/);
          return true;
        },
      );
    },
  );
});

test("leaves the error unchanged when no candidate is close enough", async () => {
  const client = new HomeboxClient("http://fake-homebox.test");
  withFakeToken(client);

  await withMockedFetch(
    async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/v1/entities") return jsonResponse({ items: CANDIDATES }, 200);
      return jsonResponse({ error: "Not Found" }, 404);
    },
    async () => {
      await assert.rejects(client.get("/v1/entities/00000000-0000-0000-0000-000000000000"), (err: any) => {
        assert.doesNotMatch(err.message, /Did you mean/);
        return true;
      });
    },
  );
});

test("leaves the error unchanged when a real validation error occurs (not an unknown id)", async () => {
  const client = new HomeboxClient("http://fake-homebox.test");
  withFakeToken(client);

  await withMockedFetch(
    async () => jsonResponse({ error: "name is required" }, 400),
    async () => {
      await assert.rejects(client.patch("/v1/entities/fafa322e-e1a9-481c-b5b6-a32ffa5bf33f", {}), (err: any) => {
        assert.doesNotMatch(err.message, /Did you mean/);
        return true;
      });
    },
  );
});

test("falls back to the original error if the candidate list itself can't be fetched", async () => {
  const client = new HomeboxClient("http://fake-homebox.test");
  withFakeToken(client);

  await withMockedFetch(
    async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/v1/entities") throw new Error("network down");
      return jsonResponse({ error: "Not Found" }, 404);
    },
    async () => {
      await assert.rejects(client.get("/v1/entities/fafa322e-e1a9-481c-b5b6-a3tan5bf33f"), (err: any) => {
        assert.doesNotMatch(err.message, /Did you mean/);
        assert.match(err.message, /Homebox API error 404/);
        return true;
      });
    },
  );
});

test("does not enrich errors on unrelated (non-entity) paths", async () => {
  const client = new HomeboxClient("http://fake-homebox.test");
  withFakeToken(client);

  await withMockedFetch(
    async () => jsonResponse({ error: "Not Found" }, 404),
    async () => {
      await assert.rejects(client.get("/v1/tags"), (err: any) => {
        assert.doesNotMatch(err.message, /Did you mean/);
        return true;
      });
    },
  );
});
