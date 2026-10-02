/**
 * @module ProviderLiveEvidenceTest
 * @path tests/scenario_framework/tests/unit/provider_live_evidence_test.ts
 * @description Verifies trace-linked live metadata survives sandbox cleanup without private content.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/provider_live_evidence.ts]
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { IActivityRecord } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core";
import {
  readLockEntryEvidence,
  readRequestLockEntries,
  readRunLockEntries,
  writeProviderLiveEvidence,
} from "../../runner/provider_live_evidence.ts";

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

/** A minimal boundary lockfile, as the daemon persists it under `<root>/.exa/bindings/`. */
async function writeLockfile(path: string, traceId: string): Promise<void> {
  await Deno.writeTextFile(
    path,
    JSON.stringify({
      schema: 1,
      trace_id: traceId,
      flow_id: "research",
      created_at: "2026-10-02T12:00:00.000Z",
      flow_content_sha256: "0".repeat(64),
      pin_sha256: "0".repeat(64),
      catalog_sha256: "0".repeat(64),
      step_ids: ["compose", "explore"],
      config_checksum: "checksum",
      overlay_sha256: [],
      run_overlays: 2,
      env_ignored: false,
      hosts: ["127.0.0.1:43117"],
      entries: [
        {
          step_id: "compose",
          agent_role: "senior-coder",
          outcome: {
            kind: "bound",
            binding: {
              service: "self-hosted-fixture",
              model_provider: "fixture",
              model: "fixture/compat-fixture-v1",
              service_model_id: "compat-fixture-v1",
              transport: "local",
              interface: "api",
              adapter: "openai-chat",
              profile: "self-hosted",
              endpoint: "http://127.0.0.1:43117/v1/chat/completions",
              sources: { service: { layer: "run", selector: "flow:research/step:compose" } },
              fingerprint: "a".repeat(64),
            },
          },
        },
        { step_id: "explore", agent_role: "web-explorer", outcome: { kind: "unbound" } },
      ],
    }),
  );
}

Deno.test("[evidence] provider live evidence records overlays, lock entries and judge bindings", async () => {
  const outputDir = await Deno.makeTempDir();
  const configPath = `${outputDir}/exa.config.toml`;
  await Deno.writeTextFile(configPath, "model = 'fixture-model'\n");
  try {
    const path = await writeProviderLiveEvidence({
      scenarioId: "bindings-evidence",
      outputDir,
      configPath,
      activities: [activity("request.created", {}), activity("llm.call.completed", { model: "mock" })],
      outcome: "success",
      suiteScore: 1,
      exitCode: 0,
      overlays: [
        { role: "scenario", path: "/out/bindings/10-scenario.json", sha256: "a".repeat(64) },
        { role: "operator", path: "/out/bindings/40-operator-bind.json", sha256: "b".repeat(64) },
      ],
      bindings: [
        {
          traceId: "10000000-0000-4000-8000-000000000001",
          stepId: "compose",
          agentRole: "senior-coder",
          outcome: "bound",
          service: "alpha",
          model: "alpha/one",
        },
        {
          traceId: "10000000-0000-4000-8000-000000000001",
          stepId: "explore",
          agentRole: "web-explorer",
          outcome: "unbound",
        },
      ],
      judges: [{
        stepId: "judge-1",
        service: "claude-cli",
        model: "anthropic/claude-sonnet-5",
        sources: { service: { layer: "config", selector: "judge" } },
        judgeSharesSut: false,
      }],
    });

    const summary = JSON.parse(await Deno.readTextFile(path));
    assertEquals(summary.overlays, [
      { role: "scenario", path: "/out/bindings/10-scenario.json", sha256: "a".repeat(64) },
      { role: "operator", path: "/out/bindings/40-operator-bind.json", sha256: "b".repeat(64) },
    ]);
    assertEquals(summary.bindings.length, 2);
    assertEquals(summary.bindings[0].stepId, "compose");
    assertEquals(summary.bindings[0].service, "alpha");
    assertEquals(summary.bindings[1].outcome, "unbound");
    // The judge row carries the resolved service and model plus the source of each field.
    assertEquals(summary.judges, [
      {
        stepId: "judge-1",
        service: "claude-cli",
        model: "anthropic/claude-sonnet-5",
        sources: { service: { layer: "config", selector: "judge" } },
        judgeSharesSut: false,
      },
    ]);
  } finally {
    await Deno.remove(outputDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("[evidence] readLockEntryEvidence reduces a binding lockfile to auditable rows", async () => {
  const root = await Deno.makeTempDir({ prefix: "lock-evidence-" });
  try {
    const traceId = "10000000-0000-4000-8000-000000000002";
    const lockPath = `${root}/${traceId}.lock.json`;
    await writeLockfile(lockPath, traceId);

    const rows = await readLockEntryEvidence(lockPath, traceId);
    assertEquals(rows.length, 2);
    assertEquals(rows[0], {
      traceId,
      stepId: "compose",
      agentRole: "senior-coder",
      outcome: "bound",
      service: "self-hosted-fixture",
      model: "fixture/compat-fixture-v1",
    });
    assertEquals(rows[1], { traceId, stepId: "explore", agentRole: "web-explorer", outcome: "unbound" });
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("[evidence] readRunLockEntries reads every lockfile in the run's sandbox, and none when no lock exists", async () => {
  const root = await Deno.makeTempDir({ prefix: "run-locks-" });
  try {
    assertEquals(await readRunLockEntries(root), []);

    const dir = `${root}/.exa/bindings`;
    await Deno.mkdir(dir, { recursive: true });
    const first = "10000000-0000-4000-8000-000000000003";
    const second = "10000000-0000-4000-8000-000000000004";
    await writeLockfile(`${dir}/${second}.lock.json`, second);
    await writeLockfile(`${dir}/${first}.lock.json`, first);
    await Deno.writeTextFile(`${dir}/${first}.json`, "{}");

    const rows = await readRunLockEntries(root);
    assertEquals(rows.map((row) => [row.traceId, row.stepId]), [
      [first, "compose"],
      [first, "explore"],
      [second, "compose"],
      [second, "explore"],
    ]);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("[evidence] a bound run without a lockfile fails the evidence write", async () => {
  const root = await Deno.makeTempDir({ prefix: "request-locks-missing-" });
  try {
    const trace = "10000000-0000-4000-8000-000000000005";
    const error = await assertRejects(() => readRequestLockEntries(root, [trace], true));
    assertStringIncludes(String(error), trace);
    // An unbound run has no lock to read, so it records no binding rows.
    assertEquals(await readRequestLockEntries(root, [trace], false), []);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("[evidence] every request trace of a scenario contributes its lock entries", async () => {
  const root = await Deno.makeTempDir({ prefix: "request-locks-all-" });
  try {
    const dir = `${root}/.exa/bindings`;
    await Deno.mkdir(dir, { recursive: true });
    const first = "10000000-0000-4000-8000-000000000006";
    const second = "10000000-0000-4000-8000-000000000007";
    await writeLockfile(`${dir}/${first}.lock.json`, first);
    await writeLockfile(`${dir}/${second}.lock.json`, second);

    const rows = await readRequestLockEntries(root, [first, second], true);
    assertEquals(new Set(rows.map((row) => row.traceId)), new Set([first, second]));
    assertEquals(rows.length, 4);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
