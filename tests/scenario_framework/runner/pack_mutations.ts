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

/**
 * A subsystem the phase defines. Written as an explicit union rather than derived from
 * SUBSYSTEM_TAGS so the exported interface below can precede every value declaration, which the
 * style gate requires.
 */
export type SubsystemTag =
  | "subsystem:tools"
  | "subsystem:mcp-server"
  | "subsystem:mcp-client"
  | "subsystem:identities"
  | "subsystem:skills"
  | "subsystem:flows";

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
] as const;

/** Mutations declared for a subsystem. */
export function mutationsFor(subsystem: SubsystemTag): IPackMutation[] {
  return PACK_MUTATIONS.filter((mutation) => mutation.subsystem === subsystem);
}

/**
 * Apply a mutation, run something against the mutated tree, and restore the file unconditionally.
 *
 * Declaring a mutation is not evidence: `pack_mutation_coverage_test.ts` proves an anchor still
 * resolves, which says a refactor has not moved the code — not that the pack notices when the
 * mechanism breaks. Only running the pack against the mutated tree can say that, and five of the
 * six mutations here were never run (Phase 142 GAP-5).
 *
 * Restoration is in a `finally` and writes the ORIGINAL bytes back rather than reversing the
 * substitution, so an aborted run cannot leave a half-reverted file behind. The replacement
 * itself mirrors `pack_mutation_coverage_test.ts`'s no-op check: first occurrence only.
 *
 * @param repoRoot - Checkout the mutation's `file` is relative to.
 * @param mutation - The mutation to apply.
 * @param run - Callback invoked while the tree is mutated.
 * @returns Whatever `run` returns.
 */
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

/**
 * Environment a subsystem's pack run needs.
 *
 * The mock provider and CI mode are universal; the edition is not. `subsystem:mcp-server` is
 * edition-gated, so on a Solo build its five scenarios are correctly *absent* — and a mutation run
 * against an empty selection reports a green pack, which is the exact false negative the verifier
 * exists to prevent.
 *
 * This lives here rather than in `scripts/verify_pack_mutations.ts` because which packs are
 * edition-gated is a property of the pack registry. The environment itself comes from
 * `modes.ts:editionEnv`, the module that also reads it back during selection.
 */
export function runEnvFor(subsystem: SubsystemTag): { [key: string]: string } {
  const base: { [key: string]: string } = { EXA_LLM_PROVIDER: "mock", EXA_CI_MODE: "1" };
  return EDITION_GATED_SUBSYSTEMS.has(subsystem) ? { ...base, ...editionEnv(EDITION_TEAM) } : base;
}
