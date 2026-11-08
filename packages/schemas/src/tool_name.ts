/**
 * @module ToolNameSchema
 * @path packages/schemas/src/tool_name.ts
 * @description The zod schema of one tool name that a flow step or a skill sidecar may declare. It canonicalizes the alias first and names the replacement for a retired tool.
 * @architectural-layer Schemas
 * @dependencies [zod, @exaix/core]
 * @related-files [packages/schemas/src/flow.ts, packages/schemas/src/skill_folder.ts, packages/core/src/types/tool_aliases.ts]
 */

import { z } from "zod";
import { canonicalizeToolName, McpToolName, retiredToolRenameHint, ToolName } from "@exaix/core";

/** One declared tool name: an alias becomes its canonical name, and a retired name fails with the replacement. */
export const DeclaredToolNameSchema = z.preprocess(
  (value) => typeof value === "string" ? canonicalizeToolName(value) : value,
  z.union([z.nativeEnum(McpToolName), z.nativeEnum(ToolName)], {
    error: (issue) => retiredToolRenameHint(`${issue.input}`),
  }),
);
