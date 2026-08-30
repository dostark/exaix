/**
 * @module DynamicStepWiringTest
 * @path apps/daemon/tests/dynamic_step_wiring_test.ts
 * @description Phase 163 Step 6 — daemon-boot wiring tests proving that the real
 *   `FlowRunner` construction path in `apps/daemon/main.ts` produces a working
 *   `DynamicStepExecutor` on the Team edition (via `buildDynamicHandlers()` +
 *   `LocalToolDispatcher`), that a dynamic-mode flow step actually executes through
 *   `DynamicStepExecutor` and not the static `AgentStepHandler` path, and that the
 *   Solo edition keeps today's no-dynamic-step-mode behavior.
 *
 *   Team boots use a single LLM fixture recording whose preview prefix matches the
 *   dynamic step's ReAct prompt ("You are Senior Software Engineer,"), so the first
 *   and only LLM call declares the step complete without any tool calls. Solo boots
 *   run with no fixtures at all, so every call falls back to the provider's default
 *   patterns exactly as it did before this phase.
 * @architectural-layer Test
 * @related-files [apps/daemon/main.ts, packages-team/mcp-server/tools.ts, packages/mcp/server/local_tool_dispatcher.ts, packages/flow/src/dynamic_step_executor.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";
import { DomainEventType } from "@exaix/core/events";
import { DYNAMIC_MODE_APPROVAL_TOOLS, DYNAMIC_MODE_TOOLS } from "@exaix/mcp";
import { LocalToolDispatcher } from "@exaix/mcp/server";
import { AllowAllPermissionsService } from "@exaix/mcp/testing";
import { createStubContext } from "@exaix/testing";
import { buildDynamicHandlers } from "@exaix-team/mcp-server";
import type { IEventLogger } from "@exaix/core/logger";
import type { IApplicationContext, LogMetadata } from "@exaix/core/types";
import type { IPortalPermissionsChecker } from "@exaix/schemas/portal_permissions.ts";
import { buildTeamMcpClient } from "../src/build_team_mcp_client.ts";
import {
  bootRealDaemon,
  daemonConfigSections,
  writePortalDir,
} from "../../../tests/integration/helpers/daemon_config.ts";

/** Repo root, from `apps/daemon/tests/` — the source of the shipped identity blueprint. */
const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");

/** Activity-journal action_type strings this step asserts on. */
const DYNAMIC_STEP_COMPLETED = "dynamic_step_completed";
const FLOW_STARTED = "flow.started";

/** ReAct completion fixture; promptPreview is the stable REACT_PROMPT_TEMPLATE prefix for the shipped senior-coder blueprint. */
const REACT_COMPLETE_FIXTURE = {
  promptHash: "0000000000000000000000000000000000000000000000000000000000000000",
  promptPreview: "\nYou are Senior Software Engineer,",
  response: JSON.stringify({
    reasoning: "Exploration objective met; no further tool calls needed.",
    action: { type: "complete", output: "Wiring probe complete." },
  }),
  model: "test",
  tokens: { input: 10, output: 10 },
  recordedAt: "2026-08-13T00:00:00Z",
};

interface IJournalEvent {
  action_type: string;
  payload: string | null;
}

async function readLastEvent(configPath: string, actionType: string): Promise<IJournalEvent | undefined> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    const rows = await db.preparedAll<IJournalEvent>(
      "SELECT action_type, payload FROM activity WHERE action_type = ? ORDER BY rowid DESC LIMIT 1",
      [actionType],
    );
    return rows[0];
  } catch {
    return undefined;
  } finally {
    await db.close();
  }
}

/** Debug aid: full sorted journal action-type histogram, embedded in assertion messages. */
async function journalSummary(configPath: string): Promise<string> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    const rows = await db.preparedAll<{ action_type: string }>(
      "SELECT action_type FROM activity ORDER BY rowid",
    );
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.action_type, (counts.get(r.action_type) ?? 0) + 1);
    return [...counts.entries()].sort().map(([k, v]) => `${v} ${k}`).join("\n");
  } catch {
    return "(journal unreadable)";
  } finally {
    await db.close();
  }
}

/** Uses the shipped `senior-coder` blueprint so the ReAct prompt prefix is deterministic and the recorded fixture hits. */
function writeWiringProbeFlow(root: string): void {
  const dir = join(root, "Blueprints", "Flows");
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(
    join(dir, "wiring-probe.flow.yaml"),
    [
      'id: "wiring-probe"',
      'name: "Wiring probe flow"',
      'description: "Single dynamic step used by the Phase 163 Step 6 daemon wiring tests."',
      'version: "1.0"',
      "steps:",
      "  - id: probe",
      '    name: "Probe dynamic execution"',
      "    identity: senior-coder",
      "    execution_mode: dynamic",
      "    permitted_tools:",
      "      - read_file",
      "      - list_directory",
      "      - search_files",
      "    input:",
      "      source: request",
      "      transform: passthrough",
      "output:",
      "  from: probe",
      "  format: markdown",
      "settings:",
      "  maxParallelism: 1",
      "  failFast: true",
      "",
    ].join("\n"),
  );
}

function writeSeniorCoderIdentity(root: string): void {
  const dir = join(root, "Blueprints", "Identities");
  Deno.mkdirSync(dir, { recursive: true });
  Deno.copyFileSync(
    join(REPO_ROOT, "Blueprints", "Identities", "senior-coder.md"),
    join(dir, "senior-coder.md"),
  );
}

/** Team config: recorded strategy with the single ReAct completion fixture. */
function writeTeamConfig(configPath: string, root: string, portalDir: string, recordingsDir: string): void {
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
    "[[portals]]",
    'alias = "workspace"',
    `target_path = "${portalDir}"`,
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/** Solo config: same shape minus the mock fixture section (default pattern fallback). */
function writeSoloConfig(configPath: string, root: string, portalDir: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[quality_gate]",
    "enabled = false",
    "",
    "[request_analysis]",
    "enabled = false",
    "",
    "[[portals]]",
    'alias = "workspace"',
    `target_path = "${portalDir}"`,
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

function writeFlowRequest(root: string): void {
  const dir = join(root, "Workspace", "Requests");
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(
    join(dir, "wiring-probe.md"),
    [
      "---",
      'trace_id: "wiring-probe"',
      `created: "${new Date().toISOString()}"`,
      'status: "pending"',
      'priority: "normal"',
      'source: "cli"',
      'created_by: "dynamic-step-wiring-test"',
      'flow: "wiring-probe"',
      "---",
      "",
      "# Probe dynamic execution",
      "",
      "Execute the dynamic probe step.",
      "",
    ].join("\n"),
  );
}

function seedTeamWorkspace(root: string): void {
  writeWiringProbeFlow(root);
  writeSeniorCoderIdentity(root);
  writePortalDir(root);
  const recordingsDir = join(root, "recordings");
  Deno.mkdirSync(recordingsDir, { recursive: true });
  Deno.writeTextFileSync(
    join(recordingsDir, "step6-react-complete.json"),
    JSON.stringify(REACT_COMPLETE_FIXTURE, null, 2),
  );
}

function seedSoloWorkspace(root: string): void {
  writeWiringProbeFlow(root);
  writeSeniorCoderIdentity(root);
  writePortalDir(root);
}

/** Boots the real daemon subprocess with a flow request injected mid-flight, then reads the activity journal. Team and Solo share this harness. */
async function bootAndProbeFlow(
  configPath: string,
  root: string,
  extraEnv: Record<string, string>,
  settleMs = 6000,
  afterInjectMs = 10000,
): Promise<void> {
  await bootRealDaemon(configPath, settleMs, {
    // EXA_LLM_PROVIDER=mock pins the provider to mock regardless of `config.models.default`
    // (which the schema defaults to a real Google provider) — see model_registry_team_cutover_test.ts.
    extraEnv: { EXA_LLM_PROVIDER: "mock", ...extraEnv },
    midFlight: () => writeFlowRequest(root),
    afterInjectMs,
  });
}

// ── Team-edition daemon wiring ────────────────────────────────────────────────

Deno.test({
  name: "[daemon wiring] with EXAIX_EDITION=team, the real FlowRunner construction path (via the daemon's own " +
    "bootstrap) produces a working DynamicStepExecutor — a dynamic-mode step completes through it",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "step6-team-wiring-" });
    const configPath = join(tempDir, "exa.config.toml");
    try {
      seedTeamWorkspace(tempDir);
      writeTeamConfig(configPath, tempDir, join(tempDir, "portal-repo"), join(tempDir, "recordings"));
      await bootAndProbeFlow(configPath, tempDir, { EXAIX_EDITION: "team" });

      const completed = await readLastEvent(configPath, DYNAMIC_STEP_COMPLETED);
      assert(
        completed,
        "dynamic_step_completed must appear in the journal: the daemon's real FlowRunner construction " +
          "must build a DynamicStepExecutor via buildDynamicHandlers() + LocalToolDispatcher (Phase 163 Step 6)\n" +
          `Journal:\n${await journalSummary(configPath)}`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "[daemon wiring] with EXAIX_EDITION=team, a flow step with execution_mode: dynamic actually executes " +
    "via DynamicStepExecutor, not the static AgentStepHandler path",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "step6-team-dynamic-" });
    const configPath = join(tempDir, "exa.config.toml");
    try {
      seedTeamWorkspace(tempDir);
      writeTeamConfig(configPath, tempDir, join(tempDir, "portal-repo"), join(tempDir, "recordings"));
      await bootAndProbeFlow(configPath, tempDir, { EXAIX_EDITION: "team" });

      const started = await readLastEvent(configPath, FLOW_STARTED);
      assert(started, "flow.started must appear in the journal — the flow request must reach FlowRunner");
      const completed = await readLastEvent(configPath, DYNAMIC_STEP_COMPLETED);
      assert(
        completed,
        "dynamic_step_completed is emitted only by DynamicStepExecutor (dynamic_step_executor.ts); its " +
          "presence proves the dynamic step ran through the dynamic executor, not the static path\n" +
          `Journal:\n${await journalSummary(configPath)}`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

// ── Solo-edition unchanged behavior ──────────────────────────────────────────

Deno.test({
  name: "[daemon wiring] with EXAIX_EDITION=solo (default), dynamic-step wiring is absent exactly as before — " +
    "no behavior change",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "step6-solo-wiring-" });
    const configPath = join(tempDir, "exa.config.toml");
    try {
      seedSoloWorkspace(tempDir);
      writeSoloConfig(configPath, tempDir, join(tempDir, "portal-repo"));
      await bootAndProbeFlow(configPath, tempDir, {});

      const started = await readLastEvent(configPath, FLOW_STARTED);
      assert(started, "flow.started must appear in the journal — the flow request must still reach FlowRunner");
      const completed = await readLastEvent(configPath, DYNAMIC_STEP_COMPLETED);
      assertEquals(
        completed,
        undefined,
        "no dynamic_step_completed on Solo: no mcpClient/dynamicHandlers is ever constructed outside the " +
          "EDITION_TEAM branch, so DynamicStepExecutor is never built (identical to pre-Phase-163 behavior)",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

// ── Dispatcher surface parity ────────────────────────────────────────────────

Deno.test({
  name: "[daemon wiring] LocalToolDispatcher built from buildDynamicHandlers() exposes exactly the union of " +
    "DYNAMIC_MODE_TOOLS and DYNAMIC_MODE_APPROVAL_TOOLS",
  fn() {
    const dynamicHandlers = buildDynamicHandlers(createStubContext(), new AllowAllPermissionsService());
    const dispatcher = new LocalToolDispatcher(createStubContext(), dynamicHandlers);

    const exposed = [...dispatcher.getAvailableToolNames()].sort();
    const expected = [...new Set([...DYNAMIC_MODE_TOOLS, ...DYNAMIC_MODE_APPROVAL_TOOLS])].sort();

    assertEquals(
      exposed,
      expected,
      "the dispatcher's tool surface must be exactly the union of DYNAMIC_MODE_TOOLS and " +
        "DYNAMIC_MODE_APPROVAL_TOOLS — the narrower safe-only filter is enforced downstream by " +
        "DynamicStepExecutor.resolvePermittedTools(), not by which handlers exist in the map",
    );
  },
});

// ── Fail-soft degradation ─────────────────────────────────────────────────

Deno.test({
  name:
    "[daemon wiring] a Team-edition dynamic-tooling construction failure logs DynamicToolsInitFailed and degrades to no-dynamic-step-mode without crashing boot",
  async fn() {
    const errors: Array<{ action: string; payload: LogMetadata }> = [];
    const logger: IEventLogger = {
      log: () => Promise.resolve(),
      info: () => Promise.resolve(),
      warn: () => Promise.resolve(),
      error: (action: string, _target: string | null, payload?: LogMetadata) => {
        errors.push({ action, payload: payload ?? {} });
        return Promise.resolve();
      },
      fatal: () => Promise.resolve(),
      debug: () => Promise.resolve(),
      child: () => logger,
    };
    // A context whose config.getAll() throws makes buildDynamicHandlers' ToolHandler
    // constructor throw, exercising the catch → log DynamicToolsInitFailed → return
    // undefined (no crash) path.
    const validContext = createStubContext();
    const throwingContext: IApplicationContext = {
      ...validContext,
      config: {
        ...validContext.config,
        getAll: () => {
          throw new Error("dynamic-tooling boom");
        },
      },
    };

    const result = await buildTeamMcpClient(
      throwingContext,
      {} as IPortalPermissionsChecker,
      logger,
    );

    assertEquals(result, undefined, "a wiring failure must degrade to no mcpClient (undefined), not crash boot");
    assertEquals(
      errors.filter((e) => e.action === DomainEventType.DynamicToolsInitFailed).length,
      1,
      "DynamicToolsInitFailed must be logged exactly once on a wiring failure",
    );
  },
});
