import { z } from "zod";
import type { BinaryResponse } from "../homebox/client.js";

/**
 * A Homebox resource ID as it appears in a URL path segment (UUID, or an
 * asset ID like "000-001"). Rejects '/', '..', '#', etc. so a malformed or
 * malicious ID can't inject extra path segments or alter which endpoint a
 * request actually hits once interpolated into a request path.
 */
export const safeId = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9-]+$/, "must be a plain Homebox ID (letters, digits, '-'), with no path separators");

export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** Tool name, e.g. "items_create". */
  name: string;
  description: string;
  /** True for any tool that creates/modifies/deletes data in Homebox. */
  write: boolean;
  /** Zod raw shape describing the input arguments. */
  shape: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
}

/** A JSON result accompanied by binary MCP content blocks. */
export interface ToolContentResult {
  kind: "tool-content";
  value: unknown;
  binaries: BinaryResponse[];
}

export function isToolContentResult(value: unknown): value is ToolContentResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ToolContentResult>;
  return candidate.kind === "tool-content" && Array.isArray(candidate.binaries);
}

export function defineTool<Shape extends z.ZodRawShape>(def: ToolDef<Shape>): ToolDef<Shape> {
  return def;
}
