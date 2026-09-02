/**
 * @module ScenarioFrameworkPackMutations
 * @path tests/scenario_framework/runner/pack_mutations.ts
 * @description Phase 142 Step 7 — for each subsystem pack, a mutation that must turn it red.
 *
 * A green pack means something only if it is known to go red. Nothing enforced that property, and
 * this phase repeatedly found packs that could not fail for the right reason: the skills pack sat
 * at mean 0.714 with three "green" scenarios while asserting nothing at all (Step 17), and the
 * identity smokes asserted `frontmatter-field-exists: identity_id` — a field `PlanWriter` stamps
 * unconditionally — so all fourteen would have passed with the WRONG identity (Step 11).
 *
 * Each entry names a real source edit that breaks the mechanism the pack exists to test. Declaring
 * them here rather than in prose makes them checkable: `pack_mutation_coverage_test.ts` verifies
 * every pack has one and that its anchor still resolves, so a refactor that moves the code fails
 * loudly instead of silently retiring the pack's only evidence of sensitivity.
 *
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/pack_mutation_coverage_test.ts, tests/scenario_framework/runner/scoring.ts]
 */

import { EDITION_TEAM } from "@exaix/core";
import { editionEnv } from "./modes.ts";

/** Explicit union rather than derived from SUBSYSTEM_TAGS, so this type can precede that value declaration (style gate requirement). */
export type SubsystemTag =
  | "subsystem:tools"
  | "subsystem:mcp-server"
  | "subsystem:mcp-client"
  | "subsystem:identities"
  | "subsystem:skills"
  | "subsystem:flows"
  | "subsystem:memory";

export interface IPackMutation {
  /** The subsystem whose pack this mutation must turn red. */
  subsystem: SubsystemTag;
  /** Repo-relative source file to edit. */
  file: string;
  /** Exact text to replace — the anchor, verified to still exist. */
  find: string;
  /** What to replace it with, reproducing a plausible regression. */
  replace: string;
  /** The mechanism this breaks, in one line. */
  breaks: string;
}

/** Subsystems whose pack is edition-gated and selects nothing without a Team build. */
export const EDITION_GATED_SUBSYSTEMS: ReadonlySet<SubsystemTag> = new Set(["subsystem:mcp-server"]);

/** Every subsystem must carry at least one mutation; `pack_mutation_coverage_test.ts` enforces it. */
export const SUBSYSTEM_TAGS: readonly SubsystemTag[] = [
  "subsystem:tools",
  "subsystem:mcp-server",
  "subsystem:mcp-client",
  "subsystem:identities",
  "subsystem:skills",
  "subsystem:flows",
  "subsystem:memory",
] as const;

export const PACK_MUTATIONS: readonly IPackMutation[] = [
  {
    subsystem: "subsystem:flows",
    file: "packages/flow/src/step_output_formatter.ts",
    find: '      const result = stepResults.get(stepId);\n      return result?.result?.content || "";',
    replace: '      const result = stepResults.get(stepId);\n      return result ? "" : "";',
    breaks:
      "flow output aggregation — every flow aggregates to the empty string, exactly the state Step 13 found when all 32 fixture flows used the wrong output shape",
  },
  {
    subsystem: "subsystem:mcp-client",
    file: "packages/flow/src/flow_loader.ts",
    find: "      if (WRITE_TOOLS.has(tool as McpToolName)) {",
    replace: "      if (false && WRITE_TOOLS.has(tool as McpToolName)) {",
    breaks:
      "the dynamic-step write-tool boundary — a dynamic step could be granted write tools, which `dynamic-permission-boundary` exists to refuse",
  },
  {
    subsystem: "subsystem:skills",
    file: "packages/execution/src/agent_runner.ts",
    find: "      const pinned = request.skills ?? [];",
    replace: "      const pinned: string[] = [];",
    breaks:
      "pinned-skill injection — reproduces exactly the Step 17 regression where every pinned skill was dropped and the pack still scored 0.800",
  },
  {
    subsystem: "subsystem:identities",
    file: "packages/core/src/planning/plan_writer.ts",
    find: "identity_id",
    replace: "identity_id_MUTATED",
    breaks:
      "the identity stamped onto a written plan — the `frontmatter-field-equals` assertion Step 11 introduced after finding the previous check passed with the wrong identity",
  },
  {
    subsystem: "subsystem:tools",
    file: "packages/tool-runtime/src/tool_registry.ts",
    find: "export class ToolRegistry",
    replace: "export class ToolRegistry_MUTATED",
    breaks: "tool registration — no tool resolves, so every round-trip scenario in the tools pack fails",
  },
  {
    subsystem: "subsystem:mcp-server",
    file: "packages/mcp/server/tool_handler.ts",
    find: "export abstract class ToolHandler {",
    replace: "export abstract class ToolHandler_MUTATED {",
    breaks: "MCP tool dispatch — the external-client contract the mcp-server pack asserts over stdio",
  },
  {
    subsystem: "subsystem:memory",
    file: "packages/tool-runtime/src/tool_registry.ts",
    find: "return store.appendNote(this.traceId ?? DEFAULT_TOOL_REGISTRY_TRACE_ID, content, tags);",
    replace: "return Promise.resolve({ success: true });",
    breaks:
      "remember_fact capture — the tool reports success but never appends a note, so scratchpad_entries stays 0 and every downstream memory-full-loop/scratchpad-extraction criterion (extraction, approval, retrieval, reflection) fails with nothing to act on",
  },
] as const;

/** Mutations declared for a subsystem. */
export function mutationsFor(subsystem: SubsystemTag): IPackMutation[] {
  return PACK_MUTATIONS.filter((mutation) => mutation.subsystem === subsystem);
}

/** Restores from the ORIGINAL bytes in a `finally` (not by reversing the edit) so an aborted run can't leave a half-reverted file; replaces only the first occurrence, mirroring the coverage test's no-op check. */
export async function withMutation<T>(
  repoRoot: string,
  mutation: IPackMutation,
  run: () => Promise<T>,
): Promise<T> {
  const path = `${repoRoot}/${mutation.file}`;
  const original = await Deno.readTextFile(path);
  if (!original.includes(mutation.find)) {
    throw new Error(
      `mutation anchor for ${mutation.subsystem} no longer resolves in ${mutation.file}: ${mutation.find.slice(0, 60)}`,
    );
  }

  await Deno.writeTextFile(path, original.replace(mutation.find, mutation.replace));
  try {
    return await run();
  } finally {
    await Deno.writeTextFile(path, original);
  }
}

/** Adds the edition env only for edition-gated subsystems — without it, a Team-gated pack with no edition set selects nothing and a mutation run reports a false-negative green pack. */
export function runEnvFor(subsystem: SubsystemTag): { [key: string]: string } {
  const base: { [key: string]: string } = { EXA_LLM_PROVIDER: "mock", EXA_CI_MODE: "1" };
  return EDITION_GATED_SUBSYSTEMS.has(subsystem) ? { ...base, ...editionEnv(EDITION_TEAM) } : base;
}
