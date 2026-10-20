/**
 * @module PortTablesTestHelper
 * @path packages/lint-policy/tests/helpers/port_tables.ts
 * @description Loads the committed port table and scans the checkers for the rule ids they emit.
 * @architectural-layer Test
 * @dependencies [zod]
 * @related-files [packages/lint-policy/port_tables.json, packages/lint-policy/src/checkers/check_code_style.ts]
 */

import { z } from "zod";

export const PORT_ORIGIN = { catalog: "catalog", emitted: "emitted", plugin: "plugin", checker: "checker" } as const;
export const PORT_OUTCOME = { generic: "generic", deno: "deno", exaix: "exaix", split: "split", zone: "zone" } as const;
export const OVERLAP_KIND = {
  duplicate: "duplicate",
  related: "related",
  incidental: "incidental",
  none: "none",
} as const;

const PACKS = ["typescript", "deno", "exaix"] as const;
const MECHANISMS = ["options", "compose", "none"] as const;
const SCOPE_DECISIONS = ["extend-scripts-run", "accept-loss", "unchanged", "not-applicable"] as const;
const COUNTERPART_TOOLS = ["eslint", "typescript-eslint", "eslint-plugin-import", "oxlint"] as const;
const COUNTERPART_KINDS = ["duplicate", "related"] as const;
const CHECKER_SOURCES = [
  "src/checkers/check_code_style.ts",
  "src/checkers/check_magic_values.ts",
] as const;
const LOGGED_ID_PATTERN = /\[([a-z][a-z0-9-]+)\]\s+\$\{/g;
const COMMENT_VIOLATION_PATTERN = /reportCommentViolation\(\s*"([a-z-]+)"/g;
const RULE_TABLE_NAME_PATTERN = /^\s*name:\s*"([a-z-]+)",/gm;

const PartSchema = z.object({
  part: z.enum(["generic", "exaix"]),
  pack: z.enum(PACKS),
  key: z.string().min(1),
  step: z.number().int().min(1).max(12).optional(),
}).strict();

const PositiveSchema = z.object({ path: z.string().min(1), code: z.string().min(1) }).strict();

const CounterpartSchema = z.object({
  tool: z.enum(COUNTERPART_TOOLS),
  rule: z.string().min(1),
  kind: z.enum(COUNTERPART_KINDS),
}).strict();

const RuleRowSchema = z.object({
  id: z.string().min(1),
  origin: z.enum([PORT_ORIGIN.catalog, PORT_ORIGIN.emitted, PORT_ORIGIN.plugin, PORT_ORIGIN.checker]),
  outcome: z.enum([PORT_OUTCOME.generic, PORT_OUTCOME.deno, PORT_OUTCOME.exaix, PORT_OUTCOME.split, PORT_OUTCOME.zone]),
  parts: z.array(PartSchema),
  mechanism: z.enum(MECHANISMS),
  zoneForm: z.string().min(1).optional(),
  coupling: z.array(z.string()),
  options: z.array(z.string()),
  overlap: z.object({
    kind: z.enum([OVERLAP_KIND.duplicate, OVERLAP_KIND.related, OVERLAP_KIND.incidental, OVERLAP_KIND.none]),
    builtins: z.array(z.string()),
    related: z.array(z.string()),
    outcome: z.string().optional(),
  }).strict(),
  counterparts: z.array(CounterpartSchema),
  scope: z.object({
    script: z.string(),
    decision: z.enum(SCOPE_DECISIONS),
    dropped: z.array(z.string()),
  }).strict(),
  positive: z.array(PositiveSchema),
  ported: z.boolean(),
  note: z.string(),
}).strict();

const PortTablesSchema = z.object({
  version: z.literal(1),
  scope: z.object({
    scriptExtensions: z.array(z.string()),
    commentExtensions: z.array(z.string()),
    pluginRoots: z.array(z.string()),
    scriptsRunRules: z.array(z.string()),
  }).strict(),
  rules: z.array(RuleRowSchema),
}).strict();

export type IPortTables = z.infer<typeof PortTablesSchema>;
export type IPortRule = z.infer<typeof RuleRowSchema>;

const POLICY_ROOT = new URL("../../", import.meta.url);

/** Reads and validates the committed port table. */
export async function loadPortTables(): Promise<IPortTables> {
  const text = await Deno.readTextFile(new URL("port_tables.json", POLICY_ROOT));
  return PortTablesSchema.parse(JSON.parse(text));
}

/** The sorted, unique rule ids that the style checkers can report. */
export async function emittedRuleIds(): Promise<string[]> {
  const ids = new Set<string>();
  for (const relative of CHECKER_SOURCES) {
    const text = await Deno.readTextFile(new URL(relative, POLICY_ROOT));
    for (const pattern of [LOGGED_ID_PATTERN, COMMENT_VIOLATION_PATTERN, RULE_TABLE_NAME_PATTERN]) {
      for (const match of text.matchAll(pattern)) ids.add(match[1]);
    }
  }
  return [...ids].sort();
}
