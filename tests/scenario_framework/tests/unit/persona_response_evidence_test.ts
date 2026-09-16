/**
 * @module PersonaResponseEvidenceTest
 * @path tests/scenario_framework/tests/unit/persona_response_evidence_test.ts
 * @description Pins accepted-response selection, parsing, provenance and immutable evidence.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/persona_response_evidence.ts]
 */
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { capturePersonaRoleResponse, preparePersonaJudgeContext } from "../../runner/persona_response_evidence.ts";
import { join } from "@std/path";
import { createPersonaResponseFixture, personaCaptureInput } from "../helpers/persona_response_fixture.ts";

Deno.test("[PersonaResponse] captures actual content for all three roles without thought or fixture text", async () => {
  for (const role of ["senior-coder", "code-analyst", "security-expert"]) {
    const ctx = await createPersonaResponseFixture();
    try {
      ctx.seed('<thought>private reasoning</thought><content>{"finding":"actual response"}</content>', role);
      const input = { ...personaCaptureInput(ctx.config), agentRole: role };
      const evidence = await capturePersonaRoleResponse(input);
      assertEquals(evidence.content, '{"finding":"actual response"}');
      assertEquals(evidence.agentRole, role);
      assertEquals(evidence.planPath, "Workspace/Plans/current_plan.md");
      assertNotEquals(evidence.contentHash, evidence.rawResponseHash);
      assertEquals(await capturePersonaRoleResponse(input), evidence);
    } finally {
      await ctx.cleanup();
    }
  }
});

Deno.test("[PersonaResponse] judge context preserves task and initial source before agent changes", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    await Deno.mkdir(join(ctx.tempDir, "Portals/task/src"), { recursive: true });
    await Deno.writeTextFile(join(ctx.tempDir, "Portals/task/src/api.ts"), "export const original = true;");
    const path = await preparePersonaJudgeContext(ctx.config, "Explain the flow", ["@Portals/task"]);
    const context = await Deno.readTextFile(path);
    assertEquals(context.includes("Explain the flow"), true);
    assertEquals(context.includes("export const original = true;"), true);
    await Deno.writeTextFile(join(ctx.tempDir, "Portals/task/src/api.ts"), "changed");
    assertEquals(await Deno.readTextFile(path), context);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[PersonaResponse] selects accepted role response and excludes other traces and downstream reports", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    ctx.append("agent.llm_response_received", { agent_role: "wrong-role", full_response: "wrong" });
    ctx.append("agent.llm_response_received", { agent_role: "code-analyst", full_response: "stale" });
    ctx.append("agent.execution_completed", { agent_role: "code-analyst" });
    ctx.seed("accepted content");
    ctx.append("agent.llm_response_received", { agent_role: "code-analyst", full_response: "downstream" });
    const result = await capturePersonaRoleResponse(personaCaptureInput(ctx.config));
    assertEquals(result.content, "accepted content");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[PersonaResponse] rejects missing, empty, truncated, stale, ambiguous and model-drifted evidence", async () => {
  for (const mode of ["missing", "empty", "truncated", "stale", "ambiguous", "drift"]) {
    const ctx = await createPersonaResponseFixture();
    try {
      if (mode !== "missing") ctx.seed(mode === "empty" ? "<content> </content>" : "answer");
      if (mode === "truncated") {
        ctx.db.instance.exec(
          "UPDATE activity SET payload=json_set(payload,'$.stop_reason','max_tokens') WHERE action_type='agent.llm_response_received'",
        );
      }
      if (mode === "ambiguous") ctx.seed("second accepted response");
      if (mode === "drift") {
        ctx.db.instance.exec(
          "UPDATE activity SET payload=json_set(payload,'$.model','wrong-provider:wrong-model') WHERE action_type='llm.call.completed'",
        );
      }
      await assertRejects(
        () =>
          capturePersonaRoleResponse({ ...personaCaptureInput(ctx.config), baselineRowid: mode === "stale" ? 999 : 0 }),
        Error,
      );
    } finally {
      await ctx.cleanup();
    }
  }
});

Deno.test("[PersonaResponse] tolerates a null model on unrelated journal rows in the trace", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    ctx.append("request.created", { agent_role: "code-analyst", model: null });
    ctx.seed("accepted content");
    const result = await capturePersonaRoleResponse(personaCaptureInput(ctx.config));
    assertEquals(result.content, "accepted content");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[PersonaResponse] rejects thought-only content and immutable evidence collisions", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    ctx.seed("<thought>private reasoning only</thought>");
    const input = personaCaptureInput(ctx.config);
    await assertRejects(() => capturePersonaRoleResponse(input), Error, "no content");
    ctx.db.instance.exec(
      "UPDATE activity SET payload=json_set(payload,'$.full_response','accepted') WHERE action_type='agent.llm_response_received'",
    );
    await capturePersonaRoleResponse(input);
    await assertRejects(
      () => capturePersonaRoleResponse({ ...input, experimentId: "different-experiment" }),
      Error,
      "different provenance",
    );
  } finally {
    await ctx.cleanup();
  }
});
