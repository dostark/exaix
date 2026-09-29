/**
 * @module ProviderLiveEvidenceTest
 * @path tests/scenario_framework/tests/unit/provider_live_evidence_test.ts
 * @description Verifies trace-linked live metadata survives sandbox cleanup without private content.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/provider_live_evidence.ts]
 */
import { assertEquals } from "@std/assert";
import type { IActivityRecord } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import { writeProviderLiveEvidence } from "../../runner/provider_live_evidence.ts";

function activity(action_type: string, payload: Record<string, JSONValue>, trace_id = "trace-live-1"): IActivityRecord {
  return {
    id: crypto.randomUUID(),
    trace_id,
    actor: "system",
    actor_type: "system",
    agent_role: null,
    action_type,
    target: null,
    payload: JSON.stringify(payload),
    timestamp: "2026-09-29T12:00:00.000Z",
  };
}

Deno.test("provider live evidence retains a redacted trace and normalized usage after sandbox cleanup", async () => {
  const sandbox = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${sandbox}/exa.config.toml`, "api_key = 'private-key'\nmodel = 'fixture-model'\n");
    const path = await writeProviderLiveEvidence({
      scenarioId: "openai-compatible-native-live",
      outputDir,
      configPath: `${sandbox}/exa.config.toml`,
      activities: [
        activity("request.created", {}),
        activity("llm.call.completed", {
          model: "gpt-6-luna",
          provider: "openai-chat",
          prompt_tokens: 30,
          completion_tokens: 10,
          cache_read_tokens: 8,
          cost_usd: 0.01,
          prompt: "private prompt",
          api_key: "private-key",
        }),
      ],
      outcome: "success",
      suiteScore: 1,
      exitCode: 0,
    });
    await Deno.remove(sandbox, { recursive: true });
    const text = await Deno.readTextFile(path);
    const summary = JSON.parse(text);
    assertEquals(summary.qualified, true);
    assertEquals(summary.traceId, "trace-live-1");
    assertEquals(summary.returnedModels, ["gpt-6-luna"]);
    assertEquals(summary.usage, {
      promptTokens: 30,
      completionTokens: 10,
      cacheReadTokens: 8,
      costStatus: "estimated",
      costUsd: 0.01,
    });
    assertEquals(text.includes("private-key"), false);
    assertEquals(text.includes("private prompt"), false);
    assertEquals(typeof summary.configRevisionSha256, "string");
  } finally {
    await Deno.remove(sandbox, { recursive: true }).catch(() => {});
    await Deno.remove(outputDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("provider live evidence never qualifies a quota or infrastructure failure", async () => {
  const outputDir = await Deno.makeTempDir();
  const configPath = `${outputDir}/exa.config.toml`;
  await Deno.writeTextFile(configPath, "model = 'fixture-model'\n");
  try {
    for (
      const [scenarioId, activities, outcome, exitCode] of [
        ["quota-failed", [activity("request.created", {}), activity("llm.call.failed", { status: 429 })], "failed", 1],
        ["infra-failed", [], "success", 2],
      ] as const
    ) {
      const path = await writeProviderLiveEvidence({
        scenarioId,
        outputDir,
        configPath,
        activities,
        outcome,
        suiteScore: 1,
        exitCode,
      });
      const summary = JSON.parse(await Deno.readTextFile(path));
      assertEquals(summary.qualified, false);
    }
  } finally {
    await Deno.remove(outputDir, { recursive: true }).catch(() => {});
  }
});
