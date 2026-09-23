/**
 * @module PlanningToolLoopConfinementTest
 * @path packages/execution/tests/planning_tool_loop_confinement_test.ts
 * @description [security] PlanningToolLoop over a real ToolRegistry must feed back an error, not
 * outside file names, for a traversing search_files pattern.
 * @architectural-layer Execution
 * @dependencies [@exaix/tool-runtime, @exaix/testing, @exaix/core/func]
 * @related-files [packages/execution/src/planning_tool_loop.ts, packages/tool-runtime/src/tool_registry.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig, makeGenerateResult } from "@exaix/testing";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import type { IGenerateResult } from "@exaix/ai/providers";
import { PlanningToolLoop } from "../src/planning_tool_loop.ts";

Deno.test("[security] PlanningToolLoop feeds an error result for a traversing search_files pattern", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/portal`, { recursive: true });
    await Deno.writeTextFile(`${root}/secret.txt`, "OUTSIDE\n");
    const config = createMockConfig(root);
    config.portals = [{ alias: "p", target_path: `${root}/portal` } as never];
    const registry = new ToolRegistry({ config, baseDir: `${root}/portal` });

    let round = 0;
    let fedBack = "";
    const loop = new PlanningToolLoop({
      toolRegistry: registry,
      tokenizer: new AiTokenEstimatorTokenizer(),
      modelId: "gpt-4o",
      generate: (_prompt, options): Promise<IGenerateResult> => {
        round++;
        if (round === 1) {
          return Promise.resolve(makeGenerateResult("", {
            toolCalls: [{ id: "1", name: "search_files", input: { pattern: "../*.txt", path: "." } }],
          }));
        }
        fedBack = String(options.priorTurn?.toolResultContent);
        return Promise.resolve(makeGenerateResult("done"));
      },
    });
    await loop.run({
      prompt: "p",
      baseOptions: {},
      nextCallSite: () => undefined,
      portalAlias: "p",
      portalRoot: `${root}/portal`,
      allowedTools: new Set(["search_files"]),
      maxRounds: 2,
      maxToolResultTokens: 2000,
      maxToolCallsPerRound: 3,
      traceId: "t",
    });

    assert(fedBack.includes("Access denied"), `expected access denied, got ${fedBack}`);
    assertEquals(fedBack.includes("secret.txt"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
