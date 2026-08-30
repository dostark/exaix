/**
 * @module SessionDelegateCycleDogfoodE2eTest
 * @path apps/daemon/tests/session_delegate_cycle_dogfood_e2e_test.ts
 * @description [daemon scenario] a real booted daemon, the real, unmodified
 *   `Blueprints/Flows/dogfood-meta-workflow.flow.yaml` catalog file, the real
 *   `scripts/plan_to_requests.ts` generator (`--plan-context-root`), and the compiled mock
 *   session tool binary carry a hardened 2-step plan through pre-gap → next-steps
 *   (`session_delegate_cycle`) → post-gap. Proves the literal shipped catalog artifact
 *   dispatches correctly — reference/root provenance, ordered cycle events, distinct
 *   delegation traces, parent lineage, and non-empty paths_touched end to end (Phase 174
 *   Step 7 / GAP-1 remediation); a second scenario proves a hollow return halts before the
 *   next step and never fabricates a third launch.
 * @architectural-layer Tests
 * @related-files [scripts/plan_to_requests.ts, scripts/mock_session_tool.ts, packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  bootRealDaemon,
  daemonConfigSections,
  writePortalDir,
} from "../../../tests/integration/helpers/daemon_config.ts";
import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";

const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");
const MOCK_BIN_PATH = join(REPO_ROOT, ".cache", "mock_session_tool_bin");
const MOCK_BIN_EXISTS = (() => {
  try {
    Deno.statSync(MOCK_BIN_PATH);
    return true;
  } catch {
    return false;
  }
})();

const FLOW_ID = "dogfood-meta-workflow";

function twoStepPlan(): string {
  return planWithSteps(2);
}

function planWithSteps(count: number): string {
  const sections: string[] = [];
  for (let n = 1; n <= count; n++) {
    sections.push(
      `## Step ${n}`,
      "",
      "**Actions:**",
      `- Implement change ${n}.`,
      "",
      "```yaml",
      "# step-manifest",
      `step: ${n}`,
      `title: Change ${n}`,
      "```",
      "",
    );
  }
  return sections.join("\n");
}

/**
 * Copies the real, unmodified `Blueprints/Flows/dogfood-meta-workflow.flow.yaml` (GAP-1
 * remediation, Phase 174 Step 7) so this test proves the literal shipped catalog artifact —
 * pre-gap (react) → next-steps (session_delegate_cycle) → post-gap (react) — dispatches
 * correctly on a real booted daemon, not a hand-maintained clone that can silently drift
 * from the real file's shape.
 */
function copyRealDogfoodFlow(root: string): void {
  const dir = join(root, "Blueprints", "Flows");
  Deno.mkdirSync(dir, { recursive: true });
  Deno.copyFileSync(
    join(REPO_ROOT, "Blueprints", "Flows", `${FLOW_ID}.flow.yaml`),
    join(dir, `${FLOW_ID}.flow.yaml`),
  );
}

/** Copies every identity the real dogfood-meta-workflow flow references (pre-gap/next-steps/post-gap). */
function copyDogfoodFlowIdentities(root: string): void {
  const dir = join(root, "Blueprints", "Identities");
  Deno.mkdirSync(dir, { recursive: true });
  for (const identity of ["dogfood-coder", "code-analyst", "code-reviewer"]) {
    Deno.copyFileSync(
      join(REPO_ROOT, "Blueprints", "Identities", `${identity}.md`),
      join(dir, `${identity}.md`),
    );
  }
}

/**
 * Shadows `codex` on PATH for the daemon subprocess. The real codex adapter never passes
 * `--brief <path>` (that convention is test-only), so the shim locates the newest
 * `brief.json` under the Session tree itself — safe here because session_delegate_cycle
 * guarantees at most one delegation is in flight at a time. A brief whose `sequence`
 * appears in `hollowSequences` gets a "completed" return with empty `paths_touched`
 * instead of delegating to the real mock tool — the hollow-result failure arm.
 */
async function makeMockCodexBinDir(sessionDir: string, hollowSequences: number[] = []): Promise<string> {
  const binDir = await Deno.makeTempDir({ prefix: "mock-codex-bin-" });
  const shadowed = join(binDir, "codex");
  await Deno.writeTextFile(
    shadowed,
    [
      "#!/usr/bin/env -S deno run -A",
      `const sessionDir = ${JSON.stringify(sessionDir)};`,
      `const hollowSequences = new Set(${JSON.stringify(hollowSequences)});`,
      `const mockBinPath = ${JSON.stringify(MOCK_BIN_PATH)};`,
      "",
      "let newest = { path: '', mtime: 0 };",
      "for await (const entry of Deno.readDir(sessionDir)) {",
      "  if (!entry.isDirectory) continue;",
      "  const briefPath = `${sessionDir}/${entry.name}/brief.json`;",
      "  try {",
      "    const stat = await Deno.stat(briefPath);",
      "    const mtime = stat.mtime?.getTime() ?? 0;",
      "    if (mtime >= newest.mtime) newest = { path: briefPath, mtime };",
      "  } catch { /* not yet written */ }",
      "}",
      "const brief = JSON.parse(await Deno.readTextFile(newest.path));",
      "",
      "if (hollowSequences.has(brief.sequence)) {",
      "  const returnPath = `${sessionDir}/${brief.trace_id}/return.json`;",
      "  const hollow = {",
      "    trace_id: brief.trace_id,",
      "    resume_token: brief.resume_token,",
      "    decision: 'changes_made',",
      "    summary: 'Hollow result: no changes were actually made.',",
      "    paths_touched: [],",
      "    token_stats: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },",
      "  };",
      "  const tmp = `${returnPath}.tmp`;",
      "  await Deno.writeTextFile(tmp, JSON.stringify(hollow, null, 2));",
      "  await Deno.rename(tmp, returnPath);",
      "  Deno.exit(0);",
      "}",
      "",
      "const cmd = new Deno.Command(mockBinPath, { args: ['--brief', newest.path] });",
      "const { code } = await cmd.output();",
      "Deno.exit(code);",
      "",
    ].join("\n"),
  );
  await Deno.chmod(shadowed, 0o755);
  return binDir;
}

/** A recorded gate-review pass, matched by prompt prefix for either plan step's evaluation call. */
function writeReviewPassFixture(recordingsDir: string): void {
  Deno.mkdirSync(recordingsDir, { recursive: true });
  Deno.writeTextFileSync(
    join(recordingsDir, "review-pass.json"),
    JSON.stringify(
      {
        promptHash: "0000000000000000000000000000000000000000000000000000000000000000",
        promptPreview: "## Evaluation Request",
        response: JSON.stringify({
          criteriaScores: {
            code_correctness: { score: 1.0, reasoning: "ok", passed: true },
            has_tests: { score: 1.0, reasoning: "ok", passed: true },
            task_fulfillment: { score: 1.0, reasoning: "ok", passed: true },
          },
          feedback: "Looks good.",
        }),
        model: "test",
        tokens: { input: 10, output: 10 },
        recordedAt: "2026-08-13T00:00:00Z",
      },
      null,
      2,
    ),
  );
}

const REACT_COMPLETION_SUMMARY =
  "Completed the step successfully with high confidence. The implementation is correct and verified.";

/**
 * The real flow's pre-gap/post-gap react steps need their own recordings: `MockLLMProvider`
 * only falls back to its generic pattern matcher when ZERO recordings are loaded at all, so
 * loading the review-pass recording above disables that fallback for every other prompt.
 * Neither step's output is asserted on directly by this test — session_delegate_cycle never
 * reads pre-gap's output, and post-gap's plain-text summary fails the daemon's unrelated
 * downstream plan-JSON validation exactly as a non-plan-shaped mock response would in any
 * other flow-ending react step; that failure is orthogonal to the session_delegate_cycle
 * behavior this test exists to prove and does not affect any assertion below.
 */
function writeReactCompletionFixture(recordingsDir: string, filename: string, identityName: string): void {
  Deno.mkdirSync(recordingsDir, { recursive: true });
  Deno.writeTextFileSync(
    join(recordingsDir, filename),
    JSON.stringify(
      {
        // promptHash is unused for matching (previewMatch below is what matches); it only
        // needs to be schema-valid and distinct per fixture file.
        promptHash: filename.padEnd(68, "0"),
        promptPreview: `IDENTITY: ${identityName}`,
        response: `THOUGHT: ${REACT_COMPLETION_SUMMARY}\nSTATUS: COMPLETE\nSUMMARY: ${REACT_COMPLETION_SUMMARY}`,
        model: "test",
        tokens: { input: 10, output: 10 },
        recordedAt: "2026-08-13T00:00:00Z",
      },
      null,
      2,
    ),
  );
}

function writeSessionDelegateConfig(configPath: string, root: string, portalDir: string, recordingsDir: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[ai.mock]",
    `fixtures_dir = "${recordingsDir}"`,
    "",
    "[quality_gate]",
    "enabled = false",
    "",
    "[request_analysis]",
    "enabled = false",
    "",
    "[session_delegate]",
    "enabled = true",
    'tool = "codex"',
    'launch_mode = "headless"',
    'gates = ["code_changes"]',
    'permitted_paths = ["packages/**"]',
    "harden_permissions = false",
    "",
    "[[portals]]",
    'alias = "exaix-self"',
    `target_path = "${portalDir}"`,
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

async function runGenerator(planPath: string, planContextRoot: string, outDir: string): Promise<void> {
  const result = await new Deno.Command("deno", {
    args: [
      "run",
      "-A",
      "--config",
      join(REPO_ROOT, "deno.json"),
      join(REPO_ROOT, "scripts", "plan_to_requests.ts"),
      planPath,
      "--out-dir",
      outDir,
      "--plan-context-root",
      planContextRoot,
    ],
  }).output();
  assert(
    result.success,
    `plan_to_requests.ts must succeed: ${new TextDecoder().decode(result.stderr)}`,
  );
}

function writeCycleRequest(requestsDir: string, traceId: string, planContextRef: string): void {
  Deno.mkdirSync(requestsDir, { recursive: true });
  Deno.writeTextFileSync(
    join(requestsDir, "session-delegate-cycle-e2e.md"),
    [
      "---",
      `trace_id: "${traceId}"`,
      `created: "${new Date().toISOString()}"`,
      "status: pending",
      "priority: high",
      `flow: ${FLOW_ID}`,
      "portal: exaix-self",
      `plan_context_ref: ${planContextRef}`,
      "source: cli",
      'created_by: "test@example.com"',
      "---",
      "",
      "Run the governed cycle.",
      "",
    ].join("\n"),
  );
}

async function readJournalEvents(configPath: string, traceId: string) {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    return await db.getActivitiesByTraceSafe(traceId);
  } finally {
    await db.close();
  }
}

/** `session.delegate.launched` is journaled under the delegation's own trace, not the parent's. */
async function readLaunchedEventsForParent(configPath: string, parentTraceId: string) {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    const all = await db.getActivitiesByActionTypeSafe("session.delegate.launched");
    return all.filter((e) => JSON.parse(e.payload).parent_trace_id === parentTraceId);
  } finally {
    await db.close();
  }
}

Deno.test({
  name:
    "[daemon scenario] the real generator + mock session binary carry a 2-step hardened plan through the production session_delegate_cycle configuration",
  ignore: !MOCK_BIN_EXISTS || Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "cycle-e2e-" });
    const portalDir = writePortalDir(tempDir);
    const configPath = join(tempDir, "exa.config.toml");
    const sessionDir = join(tempDir, "Session");
    Deno.mkdirSync(sessionDir, { recursive: true });
    const mockBinDir = await makeMockCodexBinDir(sessionDir);
    try {
      copyRealDogfoodFlow(tempDir);
      copyDogfoodFlowIdentities(tempDir);
      const recordingsDir = join(tempDir, "recordings");
      writeReviewPassFixture(recordingsDir);
      writeReactCompletionFixture(recordingsDir, "pre-gap-react.json", "Code Analyst");
      writeReactCompletionFixture(recordingsDir, "post-gap-react.json", "Code Reviewer");
      writeSessionDelegateConfig(configPath, tempDir, portalDir, recordingsDir);

      const fixturePlanPath = join(tempDir, "hardened-fixture.md");
      await Deno.writeTextFile(fixturePlanPath, twoStepPlan());
      const genOutDir = join(tempDir, "generated-requests");
      await runGenerator(fixturePlanPath, portalDir, genOutDir);

      const planContextRef = ".exa/PlanContext/hardened-fixture.md";
      const copiedPlan = join(portalDir, planContextRef);
      const copiedContent = await Deno.readTextFile(copiedPlan);
      assertEquals(copiedContent, twoStepPlan(), "the generator must copy the exact plan the daemon will read");

      const traceId = crypto.randomUUID();
      const requestsDir = join(tempDir, "Workspace", "Requests");

      await bootRealDaemon(configPath, 3000, {
        extraEnv: {
          EXA_LLM_PROVIDER: "mock",
          PATH: `${mockBinDir}:${Deno.env.get("PATH") ?? ""}`,
        },
        midFlight: () => writeCycleRequest(requestsDir, traceId, planContextRef),
        afterInjectMs: 15000,
      });

      const events = await readJournalEvents(configPath, traceId);
      const byType = (type: string) => events.filter((e) => e.action_type === type);

      const started = byType("session.delegate.cycle_started");
      assertEquals(started.length, 1, "cycle_started must fire exactly once");
      assertEquals(JSON.parse(started[0].payload).planStepCount, 2);

      const completed = byType("session.delegate.cycle_step_completed");
      assertEquals(completed.length, 2, "both plan steps must complete as ordered session delegations");
      const sequences = completed.map((e) => JSON.parse(e.payload).sequence);
      assertEquals(sequences, [1, 2], "cycle steps must complete in ascending sequence order");
      const delegationTraceIds = completed.map((e) => JSON.parse(e.payload).delegationTraceId);
      assertEquals(new Set(delegationTraceIds).size, 2, "each plan step must mint a distinct delegation trace");
      for (const event of completed) {
        assertEquals(event.trace_id, traceId, "every cycle event must be journaled under the parent trace");
      }

      const cycleCompleted = byType("session.delegate.cycle_completed");
      assertEquals(cycleCompleted.length, 1, "cycle_completed must fire exactly once");
      assertEquals(JSON.parse(cycleCompleted[0].payload).stepCount, 2);

      for (const delegationTraceId of delegationTraceIds) {
        const resultPath = join(tempDir, "Memory", "Execution", delegationTraceId, "session_delegate_result.json");
        const record = JSON.parse(await Deno.readTextFile(resultPath));
        assert(
          record.outcome.pathsTouched.length > 0,
          `delegation ${delegationTraceId} must report non-empty pathsTouched`,
        );
        assertEquals(record.outcome.parentTraceId, traceId, "each delegation must carry the parent trace lineage");
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
      await Deno.remove(mockBinDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[daemon negative] a hollow step 2 halts before step 3 and persists cycle_step_rejected, never launching a third delegation",
  ignore: !MOCK_BIN_EXISTS || Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "cycle-e2e-hollow-" });
    const portalDir = writePortalDir(tempDir);
    const configPath = join(tempDir, "exa.config.toml");
    const sessionDir = join(tempDir, "Session");
    Deno.mkdirSync(sessionDir, { recursive: true });
    const mockBinDir = await makeMockCodexBinDir(sessionDir, [2]);
    try {
      copyRealDogfoodFlow(tempDir);
      copyDogfoodFlowIdentities(tempDir);
      const recordingsDir = join(tempDir, "recordings");
      writeReviewPassFixture(recordingsDir);
      writeReactCompletionFixture(recordingsDir, "pre-gap-react.json", "Code Analyst");
      writeReactCompletionFixture(recordingsDir, "post-gap-react.json", "Code Reviewer");
      writeSessionDelegateConfig(configPath, tempDir, portalDir, recordingsDir);

      const plan = planWithSteps(3);
      const fixturePlanPath = join(tempDir, "hardened-fixture.md");
      await Deno.writeTextFile(fixturePlanPath, plan);
      const genOutDir = join(tempDir, "generated-requests");
      await runGenerator(fixturePlanPath, portalDir, genOutDir);

      const planContextRef = ".exa/PlanContext/hardened-fixture.md";
      const traceId = crypto.randomUUID();
      const requestsDir = join(tempDir, "Workspace", "Requests");

      await bootRealDaemon(configPath, 3000, {
        extraEnv: {
          EXA_LLM_PROVIDER: "mock",
          PATH: `${mockBinDir}:${Deno.env.get("PATH") ?? ""}`,
        },
        midFlight: () => writeCycleRequest(requestsDir, traceId, planContextRef),
        afterInjectMs: 15000,
      });

      const events = await readJournalEvents(configPath, traceId);
      const byType = (type: string) => events.filter((e) => e.action_type === type);

      const completed = byType("session.delegate.cycle_step_completed");
      assertEquals(
        completed.map((e) => JSON.parse(e.payload).sequence),
        [1],
        "only step 1 may complete before the hollow step 2 halts the cycle",
      );

      const rejected = byType("session.delegate.cycle_step_rejected");
      assertEquals(rejected.length, 1, "the hollow step must produce exactly one visible rejection");
      const rejectedPayload = JSON.parse(rejected[0].payload);
      assertEquals(rejectedPayload.sequence, 2, "the rejection must name the hollow step's sequence");
      assertEquals(rejectedPayload.reason, "empty_paths_touched", "the rejection reason must name the hollow cause");
      assertEquals(rejected[0].trace_id, traceId);

      assertEquals(byType("session.delegate.cycle_completed").length, 0, "a halted cycle must never report completion");

      const launched = await readLaunchedEventsForParent(configPath, traceId);
      assertEquals(launched.length, 2, "exactly steps 1 and 2 may launch — never a third delegation for step 3");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
      await Deno.remove(mockBinDir, { recursive: true }).catch(() => {});
    }
  },
});

function hasRealOpencode(): boolean {
  try {
    return new Deno.Command("opencode", { args: ["--version"], stdout: "null", stderr: "null" })
      .outputSync().success;
  } catch {
    return false;
  }
}

/**
 * [live, operator-run] Uses the real, installed `opencode` CLI (no shadowed mock binary)
 * and a real Anthropic model for the review gate. Never runs in CI — an operator opts in
 * explicitly by exporting ANTHROPIC_API_KEY and having `opencode` authenticated locally.
 */
Deno.test({
  name: "[live, operator-run] a supported CLI completes a two-step hardened phase plan with real changed paths",
  // Deliberately requires an explicit opt-in flag, not just credential presence — this
  // test spends real API budget and runs a real CLI, so it must never fire just because
  // the environment happens to already have ANTHROPIC_API_KEY exported for other work.
  ignore: Deno.env.get("EXA_RUN_LIVE_SESSION_DELEGATE_CYCLE_E2E") !== "1" || Deno.env.get("CI") === "true" ||
    !Deno.env.get("ANTHROPIC_API_KEY") || !hasRealOpencode(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "cycle-e2e-live-" });
    const portalDir = writePortalDir(tempDir);
    const configPath = join(tempDir, "exa.config.toml");
    try {
      const initGit = await new Deno.Command("git", { args: ["init", "--quiet"], cwd: portalDir }).output();
      assert(initGit.success, "the live portal worktree must be a real git repo");
      copyRealDogfoodFlow(tempDir);
      copyDogfoodFlowIdentities(tempDir);

      const cfg = [
        ...daemonConfigSections(tempDir, ""),
        "",
        "[ai]",
        'provider = "anthropic"',
        "",
        "[quality_gate]",
        "enabled = false",
        "",
        "[request_analysis]",
        "enabled = false",
        "",
        "[session_delegate]",
        "enabled = true",
        'tool = "opencode"',
        'launch_mode = "headless"',
        'gates = ["code_changes"]',
        'permitted_paths = ["**"]',
        "harden_permissions = false",
        "",
        "[[portals]]",
        'alias = "exaix-self"',
        `target_path = "${portalDir}"`,
        "",
      ].join("\n");
      Deno.writeTextFileSync(configPath, cfg);

      const fixturePlanPath = join(tempDir, "hardened-fixture.md");
      await Deno.writeTextFile(fixturePlanPath, twoStepPlan());
      const genOutDir = join(tempDir, "generated-requests");
      await runGenerator(fixturePlanPath, portalDir, genOutDir);
      const planContextRef = ".exa/PlanContext/hardened-fixture.md";
      // pre-gap's file-change audit (AgentOrchestrator.auditGitChanges) flags ANY untracked
      // file in the portal, including the PlanContext copy the generator just wrote — commit
      // it so the worktree is clean before the real flow's first step runs.
      await new Deno.Command("git", { args: ["add", "-A"], cwd: portalDir }).output();
      await new Deno.Command("git", {
        args: ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "--quiet", "-m", "plan context"],
        cwd: portalDir,
      }).output();

      const traceId = crypto.randomUUID();
      const requestsDir = join(tempDir, "Workspace", "Requests");

      await bootRealDaemon(configPath, 3000, {
        midFlight: () => writeCycleRequest(requestsDir, traceId, planContextRef),
        afterInjectMs: 180000,
      });

      const events = await readJournalEvents(configPath, traceId);
      const completed = events.filter((e) => e.action_type === "session.delegate.cycle_step_completed");
      assertEquals(
        completed.map((e) => JSON.parse(e.payload).sequence),
        [1, 2],
        "a real CLI must complete both hardened steps in order",
      );

      const delegationTraceIds = completed.map((e) => JSON.parse(e.payload).delegationTraceId);
      for (const delegationTraceId of delegationTraceIds) {
        const resultPath = join(tempDir, "Memory", "Execution", delegationTraceId, "session_delegate_result.json");
        const record = JSON.parse(await Deno.readTextFile(resultPath));
        assert(
          record.outcome.pathsTouched.length > 0,
          `delegation ${delegationTraceId} must report real changed paths`,
        );
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
