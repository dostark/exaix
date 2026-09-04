/**
 * @module AgentRoleCutoverE2ETest
 * @path apps/daemon/tests/agent_role_cutover_e2e_test.ts
 * @description Phase 179 Step 9 (Integration & Cutover, non-deferrable) — proves the
 *   renamed AgentRole path works end to end through a real daemon boot, not a unit-scoped
 *   adapter: a request `.md` file with `agent_role: senior-coder` in its frontmatter is
 *   dropped into `Workspace/Requests/`, the real daemon (booted as a subprocess via
 *   `bootRealDaemon`) picks it up, resolves `Blueprints/Agents/senior-coder.md`, and the
 *   resulting `activity` table row — queried directly via the real SQLite DB, not a mock
 *   store — carries a populated `agent_role` column. The request also reaches at least
 *   the plan stage (a file under `Workspace/Plans/`).
 * @architectural-layer Test
 * @related-files [apps/daemon/main.ts, packages/request/src/processor.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";
import {
  bootRealDaemon,
  daemonConfigSections,
  writePortalDir,
} from "../../../tests/integration/helpers/daemon_config.ts";

/** Repo root, from `apps/daemon/tests/` — the source of the shipped agent role blueprint. */
const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");

function writeSeniorCoderAgentRole(root: string): void {
  const dir = join(root, "Blueprints", "Agents");
  Deno.mkdirSync(dir, { recursive: true });
  Deno.copyFileSync(
    join(REPO_ROOT, "Blueprints", "Agents", "senior-coder.md"),
    join(dir, "senior-coder.md"),
  );
}

/** A plain (non-flow) request selecting `agent_role: senior-coder`; body text includes
 *  "Implement" so the mock provider's default planning pattern returns a real plan. */
function writeAgentRoleRequest(root: string): void {
  const dir = join(root, "Workspace", "Requests");
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(
    join(dir, "agent-role-cutover.md"),
    [
      "---",
      'trace_id: "agent-role-cutover"',
      `created: "${new Date().toISOString()}"`,
      'status: "pending"',
      'priority: "normal"',
      'source: "cli"',
      'created_by: "agent-role-cutover-test"',
      "agent_role: senior-coder",
      "---",
      "",
      "# Implement a hello world function",
      "",
      "Implement a simple hello world function in TypeScript.",
      "",
    ].join("\n"),
  );
}

function writeMockConfig(configPath: string, root: string, portalDir: string): void {
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

Deno.test({
  name: "[Phase 179 Step 9][cutover] a real daemon boot resolves Blueprints/Agents/senior-coder.md for an " +
    "agent_role: senior-coder request and stamps activity.agent_role, reaching the plan stage",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "agent-role-cutover-" });
    const configPath = join(tempDir, "exa.config.toml");
    try {
      writeSeniorCoderAgentRole(tempDir);
      const portalDir = writePortalDir(tempDir);
      writeMockConfig(configPath, tempDir, portalDir);

      await bootRealDaemon(configPath, 3000, {
        // Pins the provider to mock regardless of config.models.default — see
        // dynamic_step_wiring_test.ts's identical use of this env var for the same reason.
        extraEnv: { EXA_LLM_PROVIDER: "mock" },
        midFlight: () => writeAgentRoleRequest(tempDir),
        afterInjectMs: 15000,
      });

      const configService = new ConfigService(configPath);
      const db = new DatabaseService(configService.getAll());
      try {
        const rows = await db.preparedAll<{ agent_role: string; action_type: string }>(
          "SELECT agent_role, action_type FROM activity WHERE agent_role = ? ORDER BY rowid ASC",
          ["senior-coder"],
        );
        assert(
          rows.length > 0,
          "activity table must carry at least one row with agent_role = 'senior-coder', queried " +
            "directly via the real DB (not a mock store) — the daemon must have resolved " +
            "Blueprints/Agents/senior-coder.md for this request",
        );
        assertEquals(rows[0].agent_role, "senior-coder");
      } finally {
        await db.close();
      }

      const plansDir = join(tempDir, "Workspace", "Plans");
      let planFiles: string[] = [];
      try {
        planFiles = [...Deno.readDirSync(plansDir)].filter((e) => e.isFile).map((e) => e.name);
      } catch {
        planFiles = [];
      }
      assert(
        planFiles.length > 0,
        `request must reach at least the plan stage: expected at least one file under ` +
          `${plansDir}, found none`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
