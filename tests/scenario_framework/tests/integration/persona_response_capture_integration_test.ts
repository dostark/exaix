/**
 * @module PersonaResponseCaptureIntegrationTest
 * @path tests/scenario_framework/tests/integration/persona_response_capture_integration_test.ts
 * @description Exercises declarative capture through the scenario executor and validated configuration.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_executor.ts]
 */
import { assertEquals } from "@std/assert";
import { stringify } from "@std/toml";
import { join } from "@std/path";
import { AgentRunner } from "@exaix/execution";
import { MockProvider } from "@exaix/ai/providers.ts";
import { EventLogger } from "@exaix/core/logger";
import { LogLevel } from "@exaix/core";
import { capturePersonaRoleResponse } from "../../runner/persona_response_evidence.ts";
import { personaCaptureInput } from "../helpers/persona_response_fixture.ts";
import { executeScenarioStep } from "../../runner/step_executor.ts";
import { ScenarioStepSchema } from "../../schema/step_schema.ts";
import { createPersonaResponseFixture, RESPONSE_TRACE } from "../helpers/persona_response_fixture.ts";

Deno.test("[PersonaResponse] declarative capture preserves accepted response artifact", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    ctx.append("request.created", {});
    ctx.seed("actual accepted response");
    await Deno.writeTextFile(join(ctx.tempDir, "exa.config.toml"), stringify(ctx.config));
    const step = ScenarioStepSchema.parse({
      id: "capture-response",
      type: "capture-role-response",
      response_capture: {
        agent_role: "code-analyst",
        output_alias: "@Memory/response.json",
        content_alias: "@Memory/response.txt",
      },
    });
    const result = await executeScenarioStep({
      step,
      cwd: ctx.tempDir,
      traceBaselineRowid: 0,
      env: {
        CELL_PROVIDER: "claude-cli",
        CELL_MODEL: "claude-sonnet-5",
        EXA_PERSONA_EXPERIMENT_ID: "integration",
        EXA_PERSONA_TASK_ID: "persona-test",
        EXA_PERSONA_TRIAL_INDEX: "0",
        EXA_PERSONA_VARIANT: "shipped",
        EXA_PERSONA_RUN_ID: "22222222-2222-4222-8222-222222222222",
      },
    });
    assertEquals(result.exitCode, 0, result.stderr);
    const evidence = JSON.parse(await Deno.readTextFile(join(ctx.tempDir, "Memory/response.json")));
    assertEquals(evidence.content, "actual accepted response");
    assertEquals(evidence.traceId, RESPONSE_TRACE);
    assertEquals(await Deno.readTextFile(join(ctx.tempDir, "Memory/response.txt")), "actual accepted response");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[PersonaResponse] captures real AgentRunner debug journal response rather than rendered plan", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    const logger = new EventLogger({ db: ctx.db, minLevel: LogLevel.DEBUG });
    const provider = new MockProvider("<thought>private reasoning</thought><content>actual runner content</content>");
    const original = provider.generate.bind(provider);
    provider.generate = async (...args) => {
      const result = await original(...args);
      await logger.info("llm.call.completed", "", { model: "claude-cli-claude-cli:claude-sonnet-5" }, RESPONSE_TRACE);
      return result;
    };
    const runner = new AgentRunner(provider, { logger, disableSkills: true });
    await runner.run({ systemPrompt: "Explain the code", agentRole: "code-analyst" }, {
      userPrompt: "Explain flow",
      context: {},
      traceId: RESPONSE_TRACE,
    }, undefined);
    await ctx.db.waitForFlush();
    await logger.info("plan.created", "", { plan_path: "Workspace/Plans/current_plan.md" }, RESPONSE_TRACE);
    await logger.info("request.planned", "", { plan_path: "Workspace/Plans/current_plan.md" }, RESPONSE_TRACE);
    await ctx.db.waitForFlush();
    const evidence = await capturePersonaRoleResponse(personaCaptureInput(ctx.config));
    assertEquals(evidence.content, "actual runner content");
  } finally {
    await ctx.cleanup();
  }
});
