import { config, assertHomeboxConfigured } from "../config.js";
import { logActivity } from "../logger.js";

export class HomeboxApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: unknown,
  ) {
    super(`Homebox API error ${status} on ${path}: ${HomeboxApiError.describe(body)}`);
    this.name = "HomeboxApiError";
  }

  private static describe(body: unknown): string {
    if (typeof body === "string") return body.slice(0, 500);
    try {
      return JSON.stringify(body).slice(0, 500);
    } catch {
      return String(body);
    }
  }
}

export type Query = Record<string, string | number | boolean | string[] | undefined>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Send `body` as multipart/form-data. `body` must be a Record<string, string | Blob>. */
  multipart?: boolean;
  /** Parse the response as text instead of JSON (e.g. CSV exports). */
  raw?: boolean;
  /** Parse the response as raw bytes and return it base64-encoded (e.g. images). */
  binary?: boolean;
}

interface StoredToken {
  token: string;
  expiresAt: number; // epoch ms
}

/**
 * Thin client over the Homebox v1 REST API. Handles login and transparent
 * token refresh; callers just call request()/get()/post()/etc with paths
 * relative to /api/v1.
 */
export class HomeboxClient {
  private baseUrl: string;
  private token: StoredToken | null = null;
  private loginPromise: Promise<StoredToken> | null = null;

  constructor(baseUrl: string = config.homebox.url) {
    this.baseUrl = baseUrl;
  }

  private async login(): Promise<StoredToken> {
    assertHomeboxConfigured();
    const startedAt = Date.now();
    logActivity("Homebox authentication started", { homebox: this.baseUrl });
    const res = await fetch(`${this.baseUrl}/api/v1/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: config.homebox.username,
        password: config.homebox.password,
        stayLoggedIn: true,
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      logActivity("Homebox authentication failed", {
        status: res.status,
        durationMs: Date.now() - startedAt,
      });
      throw new HomeboxApiError(res.status, "/v1/users/login", data);
    }
    // Homebox's login response already returns the token prefixed with
    // "Bearer " (e.g. "Bearer abc123..."). Strip any such prefix here so we
    // always add exactly one when building the Authorization header below —
    // otherwise every subsequent request sends "Bearer Bearer <token>" and
    // Homebox rejects it with 401 "valid authorization token is required".
    const rawToken = typeof data.token === "string" ? data.token.replace(/^Bearer\s+/i, "").trim() : "";
    if (!rawToken) {
      throw new Error(
        `Homebox login returned HTTP ${res.status} but no usable token in the response body: ${JSON.stringify(data).slice(0, 500)}`,
      );
    }
    const parsedExpiresAt = data.expiresAt ? Date.parse(data.expiresAt) : NaN;
    const expiresAt = Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : Date.now() + 1000 * 60 * 60 * 12;
    logActivity("Homebox authentication completed", {
      status: res.status,
      durationMs: Date.now() - startedAt,
    });
    return { token: rawToken, expiresAt };
  }

  private async getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt - Date.now() > 30_000) {
      return this.token.token;
    }
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    this.token = await this.loginPromise;
    return this.token.token;
  }

  private buildUrl(path: string, query?: Query): string {
    const url = new URL(`${this.baseUrl}/api${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) url.searchParams.append(key, v);
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  /** path is relative to /api, e.g. "/v1/items" */
  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const attempt = async (retryOnAuthFailure: boolean): Promise<T> => {
      const token = await this.getToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      let body: BodyInit | undefined;

      if (options.multipart) {
        const form = new FormData();
        for (const [key, value] of Object.entries(options.body as Record<string, any>)) {
          form.append(key, value as any);
        }
        body = form;
      } else if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.body);
      }

      const startedAt = Date.now();
      logActivity("Homebox API request started", { method, path });
      let res: Response;
      try {
        res = await fetch(this.buildUrl(path, options.query), { method, headers, body });
      } catch (err) {
        logActivity("Homebox API request failed", {
          method,
          path,
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      logActivity("Homebox API request completed", {
        method,
        path,
        status: res.status,
        durationMs: Date.now() - startedAt,
      });

      if (res.status === 401 && retryOnAuthFailure) {
        logActivity("Homebox token rejected; refreshing and retrying", { method, path });
        this.token = null;
        return attempt(false);
      }

      if (res.status === 204) {
        return undefined as T;
      }

      if (options.raw) {
        const text = await res.text();
        if (!res.ok) throw new HomeboxApiError(res.status, path, text);
        return text as unknown as T;
      }

      if (options.binary) {
        if (!res.ok) throw new HomeboxApiError(res.status, path, await res.text());
        const buf = Buffer.from(await res.arrayBuffer());
        return {
          base64: buf.toString("base64"),
          contentType: res.headers.get("content-type") ?? "application/octet-stream",
        } as unknown as T;
      }

      const contentType = res.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json")
        ? await res.json().catch(() => undefined)
        : await res.text();

      if (!res.ok) {
        throw new HomeboxApiError(res.status, path, data);
      }
      return data as T;
    };

    return attempt(true);
  }

  get<T = unknown>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query });
  }
  post<T = unknown>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>("POST", path, { body, query });
  }
  put<T = unknown>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>("PUT", path, { body, query });
  }
  patch<T = unknown>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>("PATCH", path, { body, query });
  }
  delete<T = unknown>(path: string, query?: Query): Promise<T> {
    return this.request<T>("DELETE", path, { query });
  }
}

export const homebox = new HomeboxClient();
