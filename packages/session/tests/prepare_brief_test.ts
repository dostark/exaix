/**
 * @module PrepareBriefTest
 * @path packages/session/tests/prepare_brief_test.ts
 * @description Phase 106 Step 3 — tests for SessionDelegateService.prepareBrief /
 *   resolveLaunch. Covers atomic schema-valid materialization, deterministic
 *   deadline from an injected clock, GAP-2 resume-token integrity, GAP-5 path
 *   traversal/null-byte rejection, and advisory/supervised launch resolution.
 */

import { assertEquals, assertMatch, assertNotEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionBrief } from "@exaix/schemas/session_delegate.ts";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";
import { generateResumeToken, SessionDelegateService } from "@exaix/session/session_delegate_service.ts";
import type { IPrepareBriefInput } from "@exaix/session/i_session_delegate.ts";

const TRACE_ID = "00000000-0000-4000-8000-0000000000bb";
const FIXED_NOW = new Date("2026-06-11T00:00:00.000Z");
const EXPECTED_DEADLINE = "2026-06-12T00:00:00.000Z"; // FIXED_NOW + 24h
const TOKEN_PATTERN = /^[0-9a-f-]{36}\.[0-9a-f]{64}$/;

const fixedClock = { now: () => FIXED_NOW };

function makeService(sessionDir: string): SessionDelegateService {
  return new SessionDelegateService({
    registry: createDefaultSessionAdapterRegistry(),
    clock: fixedClock,
    sessionDir,
  });
}

function baseInput(overrides: Partial<IPrepareBriefInput> = {}): IPrepareBriefInput {
  return {
    traceId: TRACE_ID,
    gate: "code_changes",
    tool: "claude-code",
    objective: "Implement the feature within src/.",
    artifactRef: "Workspace/Plans/req-01_plan.md",
    permittedPaths: ["src/**"],
    tokenBudget: { max_input_tokens: 50_000, max_output_tokens: 50_000, max_total_tokens: 100_000 },
    worktreePath: "/tmp/wt",
    ...overrides,
  };
}

Deno.test("[prepare_brief] carries the optional model from input into the brief and resolved launch", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const service = makeService(dir);
    const brief = await service.prepareBrief(baseInput({ tool: "opencode", model: "deepseek:deepseek-v4-flash" }));
    assertEquals(brief.model, "deepseek:deepseek-v4-flash");

    const launch = service.resolveLaunch(brief, "headless");
    const modelIdx = launch.args.indexOf("--model");
    assertEquals(launch.args[modelIdx + 1], "deepseek/deepseek-v4-flash");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief] omits model from the brief when input has none", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const brief = await makeService(dir).prepareBrief(baseInput());
    assertEquals(brief.model, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief] writes a schema-valid brief.json with correct scope/budget/deadline", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const brief = await makeService(dir).prepareBrief(baseInput());
    const onDisk = SessionBriefSchema.parse(JSON.parse(await Deno.readTextFile(join(dir, TRACE_ID, "brief.json"))));
    assertEquals(onDisk.permitted_paths, ["src/**"]);
    assertEquals(onDisk.token_budget.max_total_tokens, 100_000);
    assertEquals(onDisk.deadline, EXPECTED_DEADLINE);
    assertEquals(onDisk.resume_token, brief.resume_token);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief] persists optional parent lineage without changing legacy briefs", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const service = makeService(dir);
    const legacy = await service.prepareBrief(baseInput());
    const linked = await service.prepareBrief(baseInput({
      traceId: "00000000-0000-4000-8000-000000000174",
      parentTraceId: "00000000-0000-4000-8000-000000000173",
      parentStepId: "step-1",
      sequence: 1,
    }));
    assertEquals(legacy.parent_trace_id, undefined);
    assertEquals(linked.parent_trace_id, "00000000-0000-4000-8000-000000000173");
    assertEquals(linked.parent_step_id, "step-1");
    assertEquals(linked.sequence, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief] deadline is deterministic for a fixed clock", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const a = await makeService(dir).prepareBrief(baseInput());
    const b = await makeService(dir).prepareBrief(baseInput({ traceId: "00000000-0000-4000-8000-0000000000cc" }));
    assertEquals(a.deadline, b.deadline);
    assertEquals(a.deadline, EXPECTED_DEADLINE);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief][security] GAP-5 — traversal in artifactRef is rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await assertRejects(() => makeService(dir).prepareBrief(baseInput({ artifactRef: "../../etc/passwd" })));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief][security] GAP-5 — traversal in permittedPaths is rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await assertRejects(() =>
      makeService(dir).prepareBrief(baseInput({ permittedPaths: ["src/**", "../../../root/**"] }))
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief][security] GAP-5 — null byte in a path field is rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await assertRejects(() => makeService(dir).prepareBrief(baseInput({ artifactRef: "Workspace/Plans/\x00evil.md" })));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief][security] GAP-2 — resume token is high-entropy and embedded", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const brief = await makeService(dir).prepareBrief(baseInput());
    assertMatch(brief.resume_token, TOKEN_PATTERN);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief][security] GAP-2 — resume tokens are unique across briefs", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const a = await makeService(dir).prepareBrief(baseInput());
    const b = await makeService(dir).prepareBrief(baseInput({ traceId: "00000000-0000-4000-8000-0000000000dd" }));
    assertNotEquals(a.resume_token, b.resume_token);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief] resolveLaunch returns a supervised CLI launch referencing the brief", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const brief: SessionBrief = await makeService(dir).prepareBrief(baseInput());
    const launch = makeService(dir).resolveLaunch(brief, "supervised");
    assertEquals(launch.args.includes(join(dir, TRACE_ID, "brief.json")), true);
    assertEquals(launch.command, "claude");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief] resolveLaunch refuses supervised for an advisory-only tool", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const brief = await makeService(dir).prepareBrief(
      baseInput({ tool: "cursor", gate: "plan_review", worktreePath: undefined }),
    );
    assertThrows(() => makeService(dir).resolveLaunch(brief, "supervised"), Error);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[prepare_brief] generateResumeToken yields unique, well-formed tokens", () => {
  const a = generateResumeToken();
  const b = generateResumeToken();
  assertMatch(a, TOKEN_PATTERN);
  assertNotEquals(a, b);
});
