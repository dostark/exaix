/**
 * @module LearningEffectivenessLiveTest
 * @path tests/scenario_framework/tests/unit/learning_effectiveness_live_test.ts
 * @description [live, operator-run] Phase 148 Step 4's self-improvement proof on a real
 * provider: the same warm/cold protocol as learning_effectiveness_test.ts, but the
 * warm leg's extraction runs through the real LlmLearningExtractor over a real
 * `claude-cli` (subscription-billed, no metered API key) CliDelegateModelProvider
 * instead of the deterministic heuristic strategy. Not CI-run: gated on CI=true.
 * @architectural-layer Test
 * @dependencies [packages/ai-clidelegate, packages/memory]
 * @related-files [tests/scenario_framework/scripts/run_learning_effectiveness.ts, packages/memory/tests/extraction/llm_extractor_live_test.ts]
 */

import { assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { CliDelegateModelProvider } from "@exaix/ai-clidelegate";
import {
  DEFAULT_CLAUDE_CLI_BIN,
  DEFAULT_CLAUDE_CLI_MODEL,
  DEFAULT_CLI_DELEGATE_TIMEOUT_MS,
} from "@exaix/ai-clidelegate";
import { SessionToolSchema } from "@exaix/schemas/session_delegate.ts";
import { LlmLearningExtractor } from "@exaix/memory";
import { castAny } from "@exaix/testing";
import type { IMemoryCostRouter, ISkillsService } from "@exaix/core/types";
import { runLearningEffectiveness } from "../../scripts/run_learning_effectiveness.ts";
import type { ILearningEffectivenessResult } from "../../scripts/run_learning_effectiveness.ts";

const POLICY_SKILL_ID = "memory-extraction-content-policy";

/** Persists live-provider evidence, matching the convention
 * `packages/memory/tests/extraction/llm_extractor_live_test.ts` already uses. */
async function writeEvidence(result: ILearningEffectivenessResult): Promise<string> {
  const evidenceDir = join(
    import.meta.dirname ?? ".",
    "..",
    "..",
    "..",
    "..",
    "exaix-dev-docs",
    "evidence",
    "phase-148",
  );
  await ensureDir(evidenceDir);
  const evidencePath = join(evidenceDir, "step-4-learning-effectiveness.json");
  await Deno.writeTextFile(
    evidencePath,
    JSON.stringify({ generated_at: new Date().toISOString(), provider: "claude-cli", ...result }, null, 2) + "\n",
  );
  return evidencePath;
}

Deno.test({
  name: "[live][phase-148] learning-effectiveness self-improvement proof via claude-cli",
  ignore: Deno.env.get("CI") === "true",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const coldRoot = await Deno.makeTempDir();
    const warmRoot = await Deno.makeTempDir();
    try {
      const provider = new CliDelegateModelProvider({
        tool: SessionToolSchema.enum["claude-code"],
        bin: DEFAULT_CLAUDE_CLI_BIN,
        model: DEFAULT_CLAUDE_CLI_MODEL,
        cwd: warmRoot,
        timeoutMs: DEFAULT_CLI_DELEGATE_TIMEOUT_MS,
      });
      const costRouter = castAny<IMemoryCostRouter>({
        isRemoteAllowed: () => Promise.resolve(true),
        recordOperation: () => Promise.resolve(),
      });
      const skillsService = castAny<ISkillsService>({
        getSkill: (skillId: string) =>
          Promise.resolve(
            skillId === POLICY_SKILL_ID
              ? { skill_id: skillId, instructions: "Prefer concrete, reusable facts over structural observations." }
              : null,
          ),
      });
      const llmExtractor = new LlmLearningExtractor(provider, skillsService, costRouter);

      // A short, robust substring: an LLM-paraphrased extraction is unlikely to preserve the
      // exact sentence a heuristic (verbatim-copy) extraction would, so the query must overlap
      // whatever core phrase the model naturally keeps, not the original lesson's full wording.
      const result = await runLearningEffectiveness(
        coldRoot,
        warmRoot,
        ["The rate limiter fully resets on a process restart, not on a per-request basis."],
        "rate limiter",
        5,
        llmExtractor,
      );

      const evidencePath = await writeEvidence(result);
      console.log(`evidence written: ${evidencePath}`);
      console.log(JSON.stringify(result));
      assertEquals(result.cold_recall, 0);
      assertEquals(
        result.learning_effectiveness > 0,
        true,
        `expected a positive self-improvement delta, got ${result.learning_effectiveness} (warm=${result.warm_recall})`,
      );
    } finally {
      await Deno.remove(coldRoot, { recursive: true });
      await Deno.remove(warmRoot, { recursive: true });
    }
  },
});
