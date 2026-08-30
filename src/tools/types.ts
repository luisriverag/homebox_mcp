import { z } from "zod";

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

export function defineTool<Shape extends z.ZodRawShape>(def: ToolDef<Shape>): ToolDef<Shape> {
  return def;
}
