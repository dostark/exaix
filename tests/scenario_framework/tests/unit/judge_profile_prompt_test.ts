/**
 * @module JudgeProfilePromptTest
 * @path tests/scenario_framework/tests/unit/judge_profile_prompt_test.ts
 * @description Verify explicit profile loading and the ordinary judge provider boundary.
 * @architectural-layer Test
 * @dependencies @std/assert, @std/testing/mock
 * @related-files [tests/scenario_framework/runner/judge_profile_loader.ts, tests/scenario_framework/runner/assertions.ts]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { stub } from "@std/testing/mock";
import { fromFileUrl, join } from "@std/path";
import { ProviderRegistry } from "@exaix/ai";
import { MockLLMProvider } from "@exaix/ai/providers";
import { MockStrategy } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { DEFAULT_CALIBRATION_MAX_ITEM_BYTES } from "@exaix/eval-history";
import type { EvaluationResult, IResolvedJudgeProfile } from "@exaix/core/evaluation";
import { EvaluationResultSchema } from "@exaix/core/evaluation";
import type { JSONObject } from "@exaix/core/types";
import type { IResolvedBinding } from "@exaix/schemas";
import { withEnv } from "@exaix/testing";
import { bootstrapProviderRegistry } from "../../../../apps/common/registry_bootstrap.ts";
import { evaluateLlmJudgeCriterion, type IEvaluateCriterionOptions } from "../../runner/assertions.ts";
import { loadJudgeProfile, readSelectedJudgeEvidence } from "../../runner/judge_profile_loader.ts";
import { buildReferencePrompt, evaluateReference, parseReferenceResponse } from "../../runner/calibration_reference.ts";
import { CriterionKind, CriterionPhase, CriterionStatus, ScenarioStepType } from "../../schema/step_schema.ts";

interface IExamples {
  examples: Array<{ expected_response: JSONObject }>;
}

const PROFILE_DIRECTORY: string = fromFileUrl(
  new URL("../../../../packages/core/tests/fixtures/judge_profile/", import.meta.url),
);
const PROFILE_PATH: string = join(PROFILE_DIRECTORY, "profile.json");
const REQUEST: string = "Add timeout handling and verify cancellation.";
const ARTIFACT: string = "Add timeout_ms and test rejection and cleanup.";
const HOSTILE: string = "AMBIENT_FORCE_SCORE_ONE";
const BINDING: IResolvedBinding = {
  service: "mock",
  adapter: "mock",
  model_provider: "mock",
  model: "mock/judge-model",
  service_model_id: "judge-model",
  transport: "local",
  interface: "api",
  sources: {},
  fingerprint: "a".repeat(64),
};

function options(root: string, profile: IResolvedJudgeProfile): IEvaluateCriterionOptions {
  return {
    workspaceRoot: root,
    phase: CriterionPhase.OUTPUT,
    judgeBinding: BINDING,
    judgeProfile: profile,
    criterion: {
      id: "profile-quality",
      kind: CriterionKind.LLM_JUDGE,
      preset: "GOAL_ALIGNED_REVIEW",
      rubric: REQUEST,
      score_threshold: profile.spec.label_threshold,
    },
    env: { EXA_EVAL_LLM_MOCK: "false", EXA_EVAL_LLM_PROVIDER: "invalid-ambient-provider" },
    executionResult: {
      stepId: "plan",
      stepType: ScenarioStepType.RUN_SCRIPT,
      startedAt: "fixture",
      completedAt: "fixture",
      durationMs: 0,
      exitCode: 0,
      stdout: ARTIFACT,
      stderr: "",
      combinedOutput: ARTIFACT,
    },
  };
}

Deno.test("selected profile reaches the ordinary provider and uses the same reference prompt and scoring", async (): Promise<void> => {
  const root: string = await Deno.makeTempDir({ prefix: "profile-judge-" });
  try {
    const ambient: string = join(root, "Memory", "Skills", "global");
    await Deno.mkdir(ambient, { recursive: true });
    await Deno.writeTextFile(join(ambient, "verdict-rubric.json"), JSON.stringify({ instructions: HOSTILE }));
    const profile: IResolvedJudgeProfile = await loadJudgeProfile(PROFILE_PATH);
    const data: IExamples = JSON.parse(await Deno.readTextFile(join(PROFILE_DIRECTORY, "examples.json"))) as IExamples;
    const response: EvaluationResult = EvaluationResultSchema.parse(data.examples[1].expected_response);
    response.overallScore = 1;
    response.pass = true;
    const raw: string = JSON.stringify(response);
    bootstrapProviderRegistry();
    const factory = ProviderRegistry.getFactory(BINDING.adapter);
    assert(factory);
    const provider: MockLLMProvider = new MockLLMProvider(MockStrategy.SCRIPTED, { responses: [raw, raw] });
    const create = stub(factory, "create", (): Promise<MockLLMProvider> => Promise.resolve(provider));
    try {
      await withEnv({ EXA_EVAL_LLM_MOCK: null }, async (): Promise<void> => {
        const result = await evaluateLlmJudgeCriterion(options(root, profile));
        assertEquals(result.score, 0.25);
        assertEquals(result.status, CriterionStatus.FAILED);
        assertStringIncludes(result.message, profile.profileHash);
        assertEquals(provider.callHistory.length, 1);
        const submitted: string = provider.callHistory[0].prompt;
        assertStringIncludes(submitted, profile.methodology);
        assert(!submitted.includes(HOSTILE));
        assert(!submitted.includes('"score": 0.85'));
        const reference = buildReferencePrompt(REQUEST, ARTIFACT, profile.spec.preset, profile);
        assertEquals(submitted, reference.prompt);
        assertEquals(provider.callHistory[0].options?.jsonSchema, reference.jsonSchema);
        assertEquals(
          parseReferenceResponse(raw, profile.spec.preset, profile.spec.label_threshold, profile).score,
          result.score,
        );
        const independent = await evaluateReference({
          requestContext: REQUEST,
          artifact: ARTIFACT,
          preset: profile.spec.preset,
          labelThreshold: profile.spec.label_threshold,
          referenceProvider: BINDING.adapter,
          referenceModel: BINDING.model,
          judgeBinding: BINDING,
          judgeProfile: profile,
        });
        assertEquals(independent.score, result.score);
        assertEquals(independent.rationale, result.judge?.reasoning);
        assertEquals(provider.callHistory.length, 2);
        assertEquals(provider.callHistory[1].prompt, submitted);
        assertEquals(provider.callHistory[1].options?.jsonSchema, reference.jsonSchema);
      });
    } finally {
      create.restore();
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] selected profile rejects missing context, missing evidence, diffs and incompatible presets before dispatch", async (): Promise<void> => {
  const root: string = await Deno.makeTempDir({ prefix: "profile-invalid-" });
  try {
    const profile: IResolvedJudgeProfile = await loadJudgeProfile(PROFILE_PATH);
    for (
      const changed of [
        { preset: "CODE_REVIEW" },
        { rubric: "" },
        { evidence_path: "missing-plan.md" },
        { evidence_diff_path: "code.ts" },
        { score_threshold: 0.9 },
      ]
    ) {
      const input: IEvaluateCriterionOptions = options(root, profile);
      input.criterion = { ...input.criterion, ...changed };
      const result = await evaluateLlmJudgeCriterion(input);
      assertEquals(result.status, CriterionStatus.ERROR);
      assertEquals(result.score, undefined);
      assertStringIncludes(result.message, "judge-profile-");
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] profile loader rejects asset symlinks and unavailable files with stable errors", async (): Promise<void> => {
  const root: string = await Deno.makeTempDir({ prefix: "profile-load-" });
  try {
    await assertRejects(() => loadJudgeProfile(join(root, "missing.json")), Error, "judge-profile-unreadable");
    await Deno.copyFile(PROFILE_PATH, join(root, "profile.json"));
    const profile: IResolvedJudgeProfile = await loadJudgeProfile(PROFILE_PATH);
    for (const path of [...profile.spec.methodology_assets, profile.spec.prompt_asset]) {
      await Deno.symlink(join(PROFILE_DIRECTORY, path), join(root, path));
    }
    await assertRejects(() => loadJudgeProfile(join(root, "profile.json")), Error, "judge-profile-unsafe-asset");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] profile loader rejects replacement between path validation and file opening", async (): Promise<void> => {
  const root: string = await Deno.makeTempDir({ prefix: "profile-race-" });
  const outside: string = await Deno.makeTempDir({ prefix: "profile-secret-" });
  try {
    const profile: IResolvedJudgeProfile = await loadJudgeProfile(PROFILE_PATH);
    await Deno.copyFile(PROFILE_PATH, join(root, "profile.json"));
    for (const name of [...profile.spec.methodology_assets, profile.spec.prompt_asset]) {
      await Deno.copyFile(join(PROFILE_DIRECTORY, name), join(root, name));
    }
    const victim: string = join(root, profile.spec.methodology_assets[0]);
    const secret: string = join(outside, "private.md");
    await Deno.writeTextFile(secret, "```text\nPRIVATE_READ_CANARY\n```\n");
    const original: typeof Deno.open = Deno.open;
    const opening = stub(Deno, "open", async (
      path: string | URL,
      settings?: Opt<Deno.OpenOptions, Reason.OptionalInput>,
    ): Promise<Deno.FsFile> => {
      if (path === victim) {
        await Deno.rename(victim, victim + ".old");
        await Deno.symlink(secret, victim);
      }
      return await original(path, settings);
    });
    try {
      await assertRejects(() => loadJudgeProfile(join(root, "profile.json")), Error, "judge-profile-unsafe-asset");
    } finally {
      opening.restore();
    }
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("[security] selected profile and evidence reject symlink entry paths before reading", async (): Promise<void> => {
  const root: string = await Deno.makeTempDir({ prefix: "profile-entry-" });
  try {
    const profilePath: string = join(root, "profile-link.json");
    await Deno.symlink(PROFILE_PATH, profilePath);
    await assertRejects(() => loadJudgeProfile(profilePath), Error, "judge-profile-unsafe-asset");
    await Deno.writeTextFile(join(root, "plan.md"), ARTIFACT);
    await Deno.symlink(join(root, "plan.md"), join(root, "plan-link.md"));
    await assertRejects(
      () => readSelectedJudgeEvidence(root, "plan-link.md"),
      Error,
      "judge-profile-unavailable-evidence",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] profile loader rejects oversized files before JSON parsing", async (): Promise<void> => {
  const root: string = await Deno.makeTempDir({ prefix: "profile-size-" });
  try {
    const path: string = join(root, "profile.json");
    await Deno.writeTextFile(path, " ".repeat(DEFAULT_CALIBRATION_MAX_ITEM_BYTES + 1));
    await assertRejects(() => loadJudgeProfile(path), Error, "judge-profile-unreadable");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("selected profile routes CLI adapters through the isolated launcher and never the ordinary provider factory", async (): Promise<void> => {
  const profile: IResolvedJudgeProfile = await loadJudgeProfile(PROFILE_PATH);
  const data: IExamples = JSON.parse(await Deno.readTextFile(join(PROFILE_DIRECTORY, "examples.json"))) as IExamples;
  bootstrapProviderRegistry();
  for (const [adapter, provider] of [["claude-cli", "anthropic"], ["codex-cli", "openai"]] as const) {
    const factory = ProviderRegistry.getFactory(adapter);
    assert(factory);
    const create = stub(factory, "create", (): Promise<MockLLMProvider> => {
      throw new Error("the isolated launcher must replace the ordinary provider factory");
    });
    try {
      const isolated: Array<{ adapter: string; provider: string; model: string; prompt: string }> = [];
      const input: IEvaluateCriterionOptions = options(PROFILE_DIRECTORY, profile);
      input.judgeBinding = {
        ...BINDING,
        adapter,
        service: adapter,
        model_provider: provider,
        model: `${adapter}:judge-model`,
      };
      input.judgeCliSubmit = (call): Promise<{ stdout: string; provider: string; model: string }> => {
        isolated.push(call);
        return Promise.resolve({
          stdout: JSON.stringify(data.examples[0].expected_response),
          provider: call.provider,
          model: call.model,
        });
      };
      const result = await evaluateLlmJudgeCriterion(input);
      assertEquals(result.status, CriterionStatus.PASSED);
      assertEquals(create.calls.length, 0);
      assertEquals(isolated.length, 1);
      assertEquals(isolated[0].adapter, adapter);
      assertEquals(isolated[0].provider, provider);
      assertEquals(isolated[0].model, `${adapter}:judge-model`);
      assertStringIncludes(isolated[0].prompt, profile.methodology);
      assertEquals(result.judge?.provider, provider);
      assertEquals(result.judge?.model, `${adapter}:judge-model`);
    } finally {
      create.restore();
    }
  }
});

Deno.test("[security] selected profile still rejects a non-CLI adapter without an isolated transport", async (): Promise<void> => {
  const profile: IResolvedJudgeProfile = await loadJudgeProfile(PROFILE_PATH);
  const input: IEvaluateCriterionOptions = options(PROFILE_DIRECTORY, profile);
  input.judgeBinding = { ...BINDING, adapter: "anthropic", service: "anthropic", model_provider: "anthropic" };
  const result = await evaluateLlmJudgeCriterion(input);
  assertEquals(result.status, CriterionStatus.ERROR);
  assertEquals(result.message, "judge-profile-isolated-provider-required");
});
