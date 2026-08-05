// deno-lint-ignore-file no-explicit-any
/**
 * @module AblationDisableProofTest
 * @path tests/scenario_framework/tests/integration/ablation_disable_proof_test.ts
 * @description Phase 143 Step 2 — journal-level proof that each ablation preset actually
 *   disables exactly its subsystem. Drives the REAL subsystem service (SkillsService via
 *   AgentRunner; RequestQualityGate) with a REAL EventLogger bound to a SQLite Activity
 *   Journal, using config values parsed from the shipped preset TOMLs through the daemon's
 *   own ConfigSchema. Under the skills preset (`skills.inject_in_prompt=false` →
 *   AgentRunner.disableSkills=true) no `skills.match_completed` is journaled; under the
 *   quality-gate preset (`quality_gate.enabled=false`) no `request.quality_assessed` is
 *   journaled. The portal-knowledge preset is proven at the injection site by
 *   `packages/request/tests/request_processor_portal_injection_gate_test.ts` (knowledge
 *   service never consulted when `portal_knowledge.injection_enabled=false`).
 * @architectural-layer Test
 * @dependencies [@exaix/core, @exaix/execution, @exaix/quality-gate, @exaix/testing]
 * @related-files [apps/daemon/main.ts, packages/core/src/skills/skills.ts, packages/quality-gate/src/request_quality_gate.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse } from "@std/toml";
import { fromFileUrl } from "@std/path";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { EventLogger } from "@exaix/core/logger";
import { QualityGateMode, SKILL_EVENT_MATCH_COMPLETED } from "@exaix/core";
import { SkillsService } from "@exaix/core/skills";
import { AgentRunner } from "@exaix/execution";
import { buildRequestQualityGateFromConfig } from "@exaix/quality-gate";
import { initTestDbService } from "@exaix/testing";
import type { IBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../..", import.meta.url));

function parsePreset(name: string): ReturnType<typeof ConfigSchema.parse> {
  const text = Deno.readTextFileSync(join(REPO_ROOT, "configs", `eval-ablate-${name}.toml`));
  return ConfigSchema.parse(parse(text));
}

function makeMockProvider(): IModelProvider {
  return {
    id: "mock",
    generate: () =>
      Promise.resolve({
        content: "{}",
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "mock",
        provider: "mock",
      }),
  };
}

async function journalActions(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
): Promise<string[]> {
  await db.waitForFlush();
  const rows = db.instance.prepare("SELECT action_type FROM activity").all() as { action_type: string }[];
  return rows.map((r) => r.action_type);
}

Deno.test("[AblationDisableProof] skills preset: skills.inject_in_prompt=false → no skills.match_completed in the journal", async () => {
  const preset = parsePreset("skills");
  assertEquals(preset.skills?.inject_in_prompt, false, "preset grounds the toggle");
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const memoryDir = join(tempDir, "Memory");
    const skillsService = new SkillsService({ memoryDir, portal: undefined }, db, undefined, logger);
    await skillsService.initialize();

    const provider: IModelProvider = makeMockProvider();
    const runner = new AgentRunner(provider, { skillsService, disableSkills: true, logger });
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: [] };
    const request = { skills: [], userPrompt: "do the thing", taskType: "feature" };

    await (runner as any).matchAndApplySkills(blueprint, request, "test-identity");

    const actions = await journalActions(db);
    assertEquals(
      actions.includes(SKILL_EVENT_MATCH_COMPLETED),
      false,
      "skills ablation must leave no skills.match_completed in the journal",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[AblationDisableProof] skills control: inject_in_prompt=true → skills.match_completed IS journaled", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const memoryDir = join(tempDir, "Memory");
    const skillsService = new SkillsService({ memoryDir, portal: undefined }, db, undefined, logger);
    await skillsService.initialize();

    const provider: IModelProvider = makeMockProvider();
    const runner = new AgentRunner(provider, { skillsService, disableSkills: false, logger });
    const blueprint: IBlueprint = { systemPrompt: "test", defaultSkills: [] };
    const request = { skills: [], userPrompt: "do the thing", taskType: "feature" };

    await (runner as any).matchAndApplySkills(blueprint, request, "test-identity");

    const actions = await journalActions(db);
    assertEquals(
      actions.includes(SKILL_EVENT_MATCH_COMPLETED),
      true,
      "with skills enabled the journal must contain skills.match_completed",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[AblationDisableProof] quality-gate preset: quality_gate.enabled=false → no request.quality_assessed in the journal", async () => {
  const preset = parsePreset("quality-gate");
  assertEquals(preset.quality_gate?.enabled, false, "preset grounds the toggle");
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const gate = buildRequestQualityGateFromConfig(
      { ...(preset.quality_gate ?? {}), mode: QualityGateMode.HEURISTIC },
      undefined,
      undefined,
      logger,
    );
    await gate.assess("Implement JWT validation in src/auth.ts — must return 401 on invalid token", {
      requestId: "req-gate-ablation",
    });

    const actions = await journalActions(db);
    assertEquals(
      actions.includes("request.quality_assessed"),
      false,
      "gate ablation must leave no request.quality_assessed in the journal",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[AblationDisableProof] quality-gate control: enabled=true → request.quality_assessed IS journaled", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const gate = buildRequestQualityGateFromConfig(
      { enabled: true, mode: QualityGateMode.HEURISTIC },
      undefined,
      undefined,
      logger,
    );
    await gate.assess("Implement JWT validation in src/auth.ts — must return 401 on invalid token", {
      requestId: "req-gate-control",
    });

    const actions = await journalActions(db);
    assertEquals(
      actions.includes("request.quality_assessed"),
      true,
      "with the gate enabled the journal must contain request.quality_assessed",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[AblationDisableProof] portal-knowledge preset: injection_enabled=false grounds the switch", () => {
  const preset = parsePreset("portal-knowledge");
  assertEquals(preset.portal_knowledge?.injection_enabled, false, "preset grounds the toggle");
});
