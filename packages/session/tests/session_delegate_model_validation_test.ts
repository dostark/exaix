/**
 * @module SessionDelegateModelValidationTest
 * @path packages/session/tests/session_delegate_model_validation_test.ts
 * @description Phase 132.5 — validates session delegate rejects non-provider:model strings.
 * @architectural-layer Services
 * @related-files [packages/session/src/session_delegate_service.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import { SessionDelegateService } from "../src/session_delegate_service.ts";
import type { IPrepareBriefInput } from "../src/i_session_delegate.ts";

const service = new SessionDelegateService({
  sessionDir: "/tmp/session-briefs",
  registry: {
    resolve: () => ({ buildLaunch: () => ({ command: "", args: [] }), name: "test" }),
    getSupportedAdapters: () => [],
  },
  clock: { now: () => new Date() },
} as never);

Deno.test("[step132.5] prepareBrief rejects model_size instead of resolved provider:model", async () => {
  const input: IPrepareBriefInput = {
    traceId: "trace-1",
    identityId: "test-identity",
    gate: "refinement" as never,
    tool: "opencode",
    objective: "test",
    model: "M",
    artifactRef: "/tmp/test",
    permittedPaths: [],
    acceptanceCriteria: [],
    tokenBudget: { max_input_tokens: 32000, max_output_tokens: 8000, max_total_tokens: 40000 },
  };
  await assertRejects(
    () => service.prepareBrief(input),
    Error,
    "model must be pre-resolved",
  );
});

Deno.test("[step132.5] prepareBrief accepts resolved provider:model string", async () => {
  const input: IPrepareBriefInput = {
    traceId: "trace-2",
    identityId: "test-identity",
    gate: "refinement" as never,
    tool: "opencode",
    objective: "test",
    model: "anthropic:claude-sonnet-5",
    artifactRef: "/tmp/test",
    permittedPaths: [],
    acceptanceCriteria: [],
    tokenBudget: { max_input_tokens: 64000, max_output_tokens: 8000, max_total_tokens: 72000 },
  };
  try {
    await service.prepareBrief(input);
  } catch (e) {
    const msg = (e as Error).message;
    assertEquals(msg.includes("model must be pre-resolved"), false);
  }
});
