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
import type { JSONValue } from "@exaix/core/types";

/** Runs one real-registry planning round for `toolName`/`input` over a portal that has a sibling
 *  secret file, and returns the content the loop fed back to the model. */
async function feedBackFor(toolName: string, input: Record<string, JSONValue>): Promise<string> {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/portal/src`, { recursive: true });
    await Deno.writeTextFile(`${root}/portal/src/a.ts`, "export const a = 1;\n");
    await Deno.writeTextFile(`${root}/secret.txt`, "OUTSIDE\n");
    const config = createMockConfig(root);
    config.portals = [{ alias: "p", target_path: `${root}/portal` } as never];
    const registry = new ToolRegistry({ config, baseDir: `${root}/portal` });
    const resolved = JSON.parse(JSON.stringify(input).replaceAll("$ROOT", root)) as Record<string, JSONValue>;

    let round = 0;
    let fedBack = "";
    const loop = new PlanningToolLoop({
      toolRegistry: registry,
      tokenizer: new AiTokenEstimatorTokenizer(),
      modelId: "gpt-4o",
      generate: (_prompt, options): Promise<IGenerateResult> => {
        round++;
        if (round === 1) {
          return Promise.resolve(makeGenerateResult("", { toolCalls: [{ id: "1", name: toolName, input: resolved }] }));
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
      allowedTools: new Set([toolName]),
      maxRounds: 2,
      maxToolResultTokens: 2000,
      maxToolCallsPerRound: 3,
      traceId: "t",
    });
    return fedBack;
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("[security] PlanningToolLoop feeds an error result for a traversing search_files pattern", async () => {
  const fedBack = await feedBackFor("search_files", { pattern: "../*.txt", path: "." });
  assert(fedBack.includes("Access denied"), `expected access denied, got ${fedBack}`);
  assertEquals(fedBack.includes("secret.txt"), false);
});

Deno.test("[security] PlanningToolLoop denies an absolute file_path alias outside the portal", async () => {
  const fedBack = await feedBackFor("read_file", { file_path: "$ROOT/secret.txt" });
  assert(fedBack.includes("Access denied"), `expected access denied, got ${fedBack}`);
  assertEquals(fedBack.includes("OUTSIDE"), false);
});

Deno.test("[security] PlanningToolLoop denies a ../ file_path alias outside the portal", async () => {
  const fedBack = await feedBackFor("read_file", { file_path: "../secret.txt" });
  assert(fedBack.includes("Access denied"), `expected access denied, got ${fedBack}`);
  assertEquals(fedBack.includes("OUTSIDE"), false);
});

Deno.test("PlanningToolLoop still reads an in-portal file through the file_path alias", async () => {
  const fedBack = await feedBackFor("read_file", { file_path: "src/a.ts" });
  assert(fedBack.includes("export const a = 1;"), `expected file content, got ${fedBack}`);
});
