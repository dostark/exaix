/**
 * @module MockSessionToolTest
 * @path tests/integration/mock_session_tool_test.ts
 * @description Phase 111 Step 3 — integration tests for the deterministic mock
 *   session-tool CLI. For each gate, writes a brief, invokes the mock script,
 *   and asserts the returned return.json is schema-valid with the correct
 *   gate-legal decision and only in-scope paths_touched.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { SessionBriefSchema, SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import { SESSION_GATE_DECISIONS } from "@exaix/schemas/session_delegate.ts";
import type { SessionBrief, SessionGate } from "@exaix/schemas/session_delegate.ts";

const MOCK_SCRIPT = "scripts/mock_session_tool.ts";
const GATES: SessionGate[] = ["refinement", "plan_review", "code_changes", "review"];

function makeBrief(overrides: Partial<SessionBrief> = {}): SessionBrief {
  return SessionBriefSchema.parse({
    trace_id: crypto.randomUUID(),
    identity_id: "dogfood-coder",
    gate: "code_changes",
    tool: "claude-code",
    objective: "Implement the feature",
    artifact_ref: "Workspace/Plans/plan.md",
    permitted_paths: ["src/feature.ts", "src/utils.ts", "tests/feature_test.ts"],
    token_budget: { max_input_tokens: 10000, max_output_tokens: 10000, max_total_tokens: 20000 },
    resume_token: "test-token-abc",
    deadline: new Date(Date.now() + 3600000).toISOString(),
    ...overrides,
  });
}

async function invokeMock(briefPath: string, _sessionDir: string): Promise<void> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "-A", MOCK_SCRIPT, "--brief", briefPath],
    cwd: join(import.meta.dirname!, "../.."),
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  const { code } = await child.status;
  if (code !== 0) {
    const stderr = new TextDecoder().decode(await new Response(child.stderr).arrayBuffer());
    throw new Error(`mock script exited ${code}: ${stderr}`);
  }
}

Deno.test("[mock_session_tool] each gate produces a schema-valid return with the canonical decision", async () => {
  for (const gate of GATES) {
    const sessionDir = await Deno.makeTempDir();
    const traceId = crypto.randomUUID();
    const traceDir = join(sessionDir, traceId);
    await Deno.mkdir(traceDir, { recursive: true });
    const briefPath = join(traceDir, "brief.json");
    const returnPath = join(traceDir, "return.json");

    const brief = makeBrief({ gate, trace_id: traceId, worktree_path: traceDir });
    await Deno.writeTextFile(briefPath, JSON.stringify(brief));

    await invokeMock(briefPath, sessionDir);

    const raw = await Deno.readTextFile(returnPath).catch(() => null);
    assertEquals(raw !== null, true, `return.json must exist for gate ${gate}`);
    if (!raw) continue;

    const parsed = SessionReturnSchema.safeParse(JSON.parse(raw));
    assertEquals(parsed.success, true, `return must be schema-valid for gate ${gate}`);
    if (!parsed.success) continue;

    assertEquals(parsed.data.trace_id, traceId, `trace_id must match brief for gate ${gate}`);
    assertEquals(parsed.data.resume_token, brief.resume_token, `resume_token must match brief for gate ${gate}`);
    assertEquals(
      parsed.data.decision,
      SESSION_GATE_DECISIONS[gate][0],
      `decision must be the canonical success verb for gate ${gate}`,
    );
    assertEquals(parsed.data.token_stats.input_tokens, 0, `token_stats must be zeroed for gate ${gate}`);
    assertEquals(parsed.data.token_stats.output_tokens, 0, `token_stats must be zeroed for gate ${gate}`);
    assertEquals(parsed.data.token_stats.total_tokens, 0, `token_stats must be zeroed for gate ${gate}`);

    for (const path of parsed.data.paths_touched) {
      assertEquals(
        brief.permitted_paths.some((p) => path.startsWith(p.replace("*", ""))),
        true,
        `paths_touched must be within permitted_paths for gate ${gate}: ${path}`,
      );
    }

    await Deno.remove(sessionDir, { recursive: true });
  }
});
