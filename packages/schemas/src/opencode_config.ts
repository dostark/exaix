/**
 * @module OpencodeConfigSchemas
 * @path packages/schemas/src/opencode_config.ts
 * @description Zod schemas for the OpenCode permission config structure
 *   (opencode.jsonc). Modelled on the OpenCode `agent.<agent-role>` permission
 *   block — tool-level `allow`/`ask`/`deny` with glob-pattern keys.
 * @architectural-layer Schemas
 * @related-files [packages/schemas/src/mod.ts, packages/session/src/opencode_permission_generator.ts]
 */

import { z } from "zod";

export const OpencodePermissionValueSchema = z.enum(["allow", "ask", "deny"]);
export type OpencodePermissionValue = z.infer<typeof OpencodePermissionValueSchema>;

export const OpencodeGlobPermissionSchema = z.record(
  z.string(),
  OpencodePermissionValueSchema,
);
export type OpencodeGlobPermission = z.infer<typeof OpencodeGlobPermissionSchema>;

export const OpencodeAgentPermissionSchema = z.object({
  edit: OpencodeGlobPermissionSchema,
  external_directory: OpencodeGlobPermissionSchema,
  bash: OpencodeGlobPermissionSchema,
});
export type OpencodeAgentPermission = z.infer<typeof OpencodeAgentPermissionSchema>;

export const OpencodeAgentSchema = z.record(
  z.string(),
  OpencodeAgentPermissionSchema,
);
export type OpencodeAgent = z.infer<typeof OpencodeAgentSchema>;

/** One remote MCP server entry — modelled on OpenCode's `mcp.<name>` config shape. The
 *  `headers` value is always an `{env:VAR}`-style reference, never a literal credential. */
export const OpencodeMcpRemoteServerSchema = z.object({
  type: z.literal("remote"),
  url: z.string(),
  oauth: z.literal(false),
  headers: z.record(z.string(), z.string()),
});
export type OpencodeMcpRemoteServer = z.infer<typeof OpencodeMcpRemoteServerSchema>;

export const OpencodeMcpSchema = z.record(z.string(), OpencodeMcpRemoteServerSchema);
export type OpencodeMcp = z.infer<typeof OpencodeMcpSchema>;

export const OpencodeConfigSchema = z.object({
  agent: OpencodeAgentSchema,
  mcp: OpencodeMcpSchema.optional(),
});
export type OpencodeConfig = z.infer<typeof OpencodeConfigSchema>;
