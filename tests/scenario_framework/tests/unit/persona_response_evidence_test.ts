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

Deno.test("[PersonaResponse] explicit judge files include only the selected source", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    const root = join(ctx.tempDir, "Portals/task/src");
    await Deno.mkdir(root, { recursive: true });
    await Deno.writeTextFile(join(root, "api.ts"), "export const selected = true;");
    await Deno.writeTextFile(join(root, "storage.ts"), "export const excluded = true;");
    const contextPath = await preparePersonaJudgeContext(
      ctx.config,
      "Inspect the API",
      ["@Portals/task"],
      [{ alias: "@Portals/task", path: "src/api.ts" }],
    );
    const context = await Deno.readTextFile(contextPath);
    assertEquals(context.includes("export const selected = true;"), true);
    assertEquals(context.includes("export const excluded = true;"), false);
    assertEquals(context.includes("Source @Portals/task/src/api.ts:"), true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[PersonaResponse] no judge file list still walks every source file", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    const root = join(ctx.tempDir, "Portals/task/src");
    await Deno.mkdir(root, { recursive: true });
    await Deno.writeTextFile(join(root, "api.ts"), "api fixture");
    await Deno.writeTextFile(join(root, "storage.ts"), "storage fixture");
    const contextPath = await preparePersonaJudgeContext(ctx.config, "Read both", ["@Portals/task"]);
    const context = await Deno.readTextFile(contextPath);
    assertEquals(context.includes("api fixture"), true);
    assertEquals(context.includes("storage fixture"), true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("[security][PersonaResponse] explicit judge file traversal is rejected before reading", async () => {
  const ctx = await createPersonaResponseFixture();
  try {
    const portalRoot = join(ctx.tempDir, "Portals/task/src");
    await Deno.mkdir(portalRoot, { recursive: true });
    await Deno.mkdir(join(ctx.tempDir, "Portals/sibling"), { recursive: true });
    await Deno.writeTextFile(join(ctx.tempDir, "Portals/sibling/secret.ts"), "must never be read");
    await assertRejects(
      () =>
        preparePersonaJudgeContext(ctx.config, "Read safe files", ["@Portals/task"], [{
          alias: "@Portals/task",
          path: "../sibling/secret.ts",
        }]),
      Error,
      "outside",
    );
    await assertRejects(
      () => Deno.stat(join(ctx.tempDir, "Memory/persona-judge-context.txt")),
      Deno.errors.NotFound,
    );
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
