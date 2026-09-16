/**
 * @module PersonaResponseFixture
 * @path tests/scenario_framework/tests/helpers/persona_response_fixture.ts
 * @description Journal scaffolding for persona response capture regressions.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/persona_response_evidence_test.ts]
 */
import { initTestDbService } from "@exaix/testing";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

export const RESPONSE_TRACE = "11111111-1111-4111-8111-111111111111";
export const RESPONSE_ROLE = "code-analyst";
export const RESPONSE_PROVIDER = "claude-cli";
export const RESPONSE_MODEL = "claude-sonnet-5";

export async function createPersonaResponseFixture(): Promise<
  Awaited<ReturnType<typeof initTestDbService>> & {
    append: (action: string, payload: object, trace?: string) => void;
    seed: (content: string, role?: string) => void;
  }
> {
  const ctx = await initTestDbService();
  await ensureDir(join(ctx.tempDir, ctx.config.paths.memory));
  const append = (action: string, payload: object, trace = RESPONSE_TRACE) => {
    ctx.db.instance.prepare("INSERT INTO activity (id, trace_id, actor, action_type, payload) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), trace, "system", action, JSON.stringify(payload));
  };
  const seed = (content: string, role = RESPONSE_ROLE) => {
    append("llm.call.completed", { model: `${RESPONSE_PROVIDER}-${RESPONSE_PROVIDER}:${RESPONSE_MODEL}` });
    append("agent.llm_response_received", { agent_role: role, full_response: content, stop_reason: "end_turn" });
    append("agent.execution_completed", { agent_role: role, has_content: true });
    append("plan.created", { plan_path: "Workspace/Plans/current_plan.md" });
    append("request.planned", { plan_path: "Workspace/Plans/current_plan.md" });
  };
  return { ...ctx, append, seed };
}

export function personaCaptureInput(config: Awaited<ReturnType<typeof initTestDbService>>["config"]): {
  config: typeof config;
  traceId: string;
  agentRole: string;
  provider: string;
  model: string;
  baselineRowid: number;
  experimentId: string;
  taskId: string;
  trialIndex: number;
  variant: "shipped";
  runId: string;
  outputAlias: string;
} {
  return {
    config,
    traceId: RESPONSE_TRACE,
    agentRole: RESPONSE_ROLE,
    provider: RESPONSE_PROVIDER,
    model: RESPONSE_MODEL,
    baselineRowid: 0,
    experimentId: "phase161-response",
    taskId: "persona-explain-request-flow-codeanalyst",
    trialIndex: 0,
    variant: "shipped" as const,
    runId: "22222222-2222-4222-8222-222222222222",
    outputAlias: "@Memory/response.json",
  };
}
