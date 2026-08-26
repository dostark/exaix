#!/usr/bin/env -S deno run -A
/**
 * @module ValidateAciDocs
 * @path scripts/validate_aci_docs.ts
 * @description Phase 112 Step 5 — dedicated ACI (Agent-Computer Interface) authoring
 *   validator over `createCoreToolSchemas()`, distinct from the Markdown-only
 *   `validate_agents_docs.ts`. Default mode warns and exits `0`; `--strict` reports
 *   the same findings as errors and exits `2`; a catalog-load/internal error exits
 *   `1`; a compliant catalog exits `0` with a stable, tool-ID-sorted summary.
 * @architectural-layer Script
 * @related-files ["packages/tool-runtime/src/tool_schemas.ts", "packages/schemas/src/aci_doc.ts", "packages/tool-runtime/src/aci_example_validator.ts"]
 * Usage:
 *   deno run scripts/validate_aci_docs.ts
 *   deno run scripts/validate_aci_docs.ts --strict
 */

/**
 * The stable baseline is the complete CURRENT ReAct catalog, not repository history:
 * there is no Git diff, merge-base, or legacy allowlist. A renamed tool is simply a
 * current tool and must be compliant; a removed tool disappears from the input and is
 * never tracked; MCP `docs_visible` is an MCP-manifest-only concept this validator
 * never reads and cannot be influenced by. Output is sorted by tool name for
 * deterministic local/CI behavior.
 *
 * Actual required permissions are none (the deno.json tasks below run with zero
 * `--allow-*` flags) — the `-A` above only satisfies this repo's uniform
 * maintenance-script shebang convention (check:style's `[script-shebang]` rule).
 */
// Imports the specific source modules directly rather than the @exaix/tool-runtime
// and @exaix/schemas barrels: both barrels' mod.ts re-export files whose own import
// graphs pull in @db/sqlite (needed for tool *execution* and config *persistence*,
// never for pure catalog/ACI validation), which eagerly requires
// --allow-env/--allow-read/--allow-ffi at import time. None of aci_doc.ts,
// tool_schemas.ts, or aci_example_validator.ts import anything beyond @exaix/core, so
// this keeps the validator genuinely permission-free.
import { AciDocSchema } from "../packages/schemas/src/aci_doc.ts";
import { createCoreToolSchemas } from "../packages/tool-runtime/src/tool_schemas.ts";
import { validateAciExampleAgainstSchema } from "../packages/tool-runtime/src/aci_example_validator.ts";
import type { ITool } from "@exaix/core/types";

/** One authoring non-compliance finding for a single tool. */
export interface IAciDocIssue {
  tool: string;
  reason: string;
}

/** Result of validating a full tool catalog's ACI authoring compliance. */
export interface IAciDocsValidationResult {
  issues: IAciDocIssue[];
  checkedTools: number;
}

/**
 * Validates every tool's `aciDoc`: present, schema-valid (`AciDocSchema`), its worked
 * example is compatible with the tool's own `parameters` schema, and its anti-example
 * genuinely violates a named constraint of that same schema. Pure — no I/O, no Git,
 * no network. Issues are sorted by tool name for deterministic output.
 */
export function validateAciDocs(tools: ITool[]): IAciDocsValidationResult {
  const issues: IAciDocIssue[] = [];
  const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));

  for (const tool of sortedTools) {
    if (tool.aciDoc === undefined) {
      issues.push({ tool: tool.name, reason: "missing_aci_doc" });
      continue;
    }

    const parsed = AciDocSchema.safeParse(tool.aciDoc);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const detail = firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "invalid";
      issues.push({ tool: tool.name, reason: `invalid_aci_doc_schema: ${detail}` });
      continue;
    }

    const exampleCheck = validateAciExampleAgainstSchema(tool.parameters, parsed.data.example.input);
    if (!exampleCheck.compatible) {
      issues.push({
        tool: tool.name,
        reason: `example_incompatible_with_schema: ${exampleCheck.violations.join("; ")}`,
      });
    }

    const antiExampleCheck = validateAciExampleAgainstSchema(tool.parameters, parsed.data.anti_example.input);
    if (antiExampleCheck.compatible) {
      issues.push({ tool: tool.name, reason: "anti_example_not_a_violation" });
    }
  }

  return { issues, checkedTools: tools.length };
}

/**
 * Runs the validator against tools produced by `loadTools` and returns the process exit
 * code the CLI entrypoint should use, printing WARN/ERROR lines as a side effect.
 * `loadTools` is injectable so a catalog-load failure is testable without Git or a real
 * broken catalog. Does not call `Deno.exit()` itself, so it stays directly testable.
 */
export function runCli(loadTools: () => ITool[], strict: boolean): number {
  let tools: ITool[];
  try {
    tools = loadTools();
  } catch (error) {
    console.error(`ERROR [aci-doc] catalog load failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  let result: IAciDocsValidationResult;
  try {
    result = validateAciDocs(tools);
  } catch (error) {
    console.error(
      `ERROR [aci-doc] internal validator error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  if (result.issues.length === 0) {
    console.log(`OK [aci-doc] ${result.checkedTools}/${result.checkedTools} tools compliant`);
    return 0;
  }

  const level = strict ? "ERROR" : "WARN";
  const log = strict ? console.error : console.warn;
  for (const issue of result.issues) {
    log(`${level} [aci-doc] tool=${issue.tool} reason=${issue.reason}`);
  }
  return strict ? 2 : 0;
}

if (import.meta.main) {
  Deno.exit(runCli(createCoreToolSchemas, Deno.args.includes("--strict")));
}
