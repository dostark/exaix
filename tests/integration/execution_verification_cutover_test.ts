/**
 * @module ExecutionVerificationCutoverTest
 * @path tests/integration/execution_verification_cutover_test.ts
 * @description Phase 208 Step 6 cutover — a real booted daemon executes a plan whose portal
 *   config sets `verification` and journals the verification outcome on the request trace.
 *   The plan is placed directly in Workspace/Active (the daemon's approved-plan watcher), so
 *   the legacy action path commits a real test file and the verification stage runs for real.
 * @architectural-layer Integration
 * @related-files [apps/daemon/main.ts, packages/execution/src/execution_loop.ts, packages/execution/src/verification_runner.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { PlanStatus } from "@exaix/core/status";
import { bootRealDaemon, daemonConfigSections } from "./helpers/daemon_config.ts";

interface IActivityRow {
  action_type: string;
  payload: string;
}

async function readTraceActivity(configPath: string, traceId: string): Promise<IActivityRow[]> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    return await db.preparedAll<IActivityRow>(
      "SELECT action_type, payload FROM activity WHERE trace_id = ? ORDER BY rowid ASC",
      [traceId],
    );
  } finally {
    await db.close();
  }
}

async function initPortalRepo(portalDir: string): Promise<void> {
  await Deno.mkdir(portalDir, { recursive: true });
  for (
    const args of [
      ["init", "-b", "master"],
      ["config", "user.name", "Test User"],
      ["config", "user.email", "test@test.com"],
    ]
  ) {
    await new Deno.Command("git", { args, cwd: portalDir }).output();
  }
  await Deno.writeTextFile(join(portalDir, ".gitignore"), "*.tmp\n");
  await new Deno.Command("git", { args: ["add", ".gitignore"], cwd: portalDir }).output();
  await new Deno.Command("git", { args: ["commit", "-m", "Initial commit"], cwd: portalDir }).output();
}

function writeConfig(configPath: string, root: string, portalDir: string, verification?: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[ai.mock]",
    "timeout_ms = 30000",
    "",
    "[quality_gate]",
    "enabled = false",
    "",
    "[[portals]]",
    'alias = "verify-portal"',
    `target_path = "${portalDir}"`,
    ...(verification ? ["", verification] : []),
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

function verificationBlock(maxRepairAttempts: number): string {
  return [
    "[portals.verification]",
    `max_repair_attempts = ${maxRepairAttempts}`,
    "check_timeout_ms = 120000",
    "output_max_chars = 4000",
    "",
    "[[portals.verification.checks]]",
    'kind = "deno_task"',
    'task = "test"',
    'path = "."',
    "args = []",
  ].join("\n");
}

function planFile(traceId: string, testBody: string): string {
  return `---
trace_id: "${traceId}"
request_id: "cutover-${traceId.slice(0, 8)}"
status: ${PlanStatus.APPROVED}
portal: verify-portal
---

# Verification cutover plan

\`\`\`toml
tool = "write_file"
description = "write the checked test file"

[params]
path = "checked_test.ts"
content = """
${testBody}"""
\`\`\`
`;
}

const PASSING_TEST = 'Deno.test("ok", () => { if (1 !== 1) throw new Error("no"); });\n';
const FAILING_TEST = 'Deno.test("no", () => { throw new Error("boom"); });\n';

async function bootCutoverPlan(
  prefix: string,
  testBody: string,
  verification: string | undefined,
): Promise<{ traceId: string; activities: IActivityRow[] }> {
  const tempDir = await Deno.makeTempDir({ prefix });
  const portalDir = join(tempDir, "portal-repo");
  const configPath = join(tempDir, "exa.config.toml");

  await initPortalRepo(portalDir);
  writeConfig(configPath, tempDir, portalDir, verification);

  const traceId = crypto.randomUUID();
  const activeDir = join(tempDir, "Workspace", "Active");

  try {
    await bootRealDaemon(configPath, 2000, {
      midFlight: () => {
        Deno.mkdirSync(activeDir, { recursive: true });
        Deno.writeTextFileSync(join(activeDir, `cutover-${traceId.slice(0, 8)}_plan.md`), planFile(traceId, testBody));
      },
      afterInjectMs: 60000,
      waitForAfterInject: async () => {
        const rows = await readTraceActivity(configPath, traceId);
        return rows.some((row) => row.action_type === "execution.completed");
      },
    });
    return { traceId, activities: await readTraceActivity(configPath, traceId) };
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

function completedStatus(activities: IActivityRow[]): string {
  const completed = activities.find((row) => row.action_type === "execution.completed");
  assert(
    completed,
    `execution.completed must be journaled; got ${JSON.stringify(activities.map((r) => r.action_type))}`,
  );
  return (JSON.parse(completed.payload) as { verification_status: string }).verification_status;
}

Deno.test({
  name: "[phase208-cutover] a booted daemon with no verification block journals not_configured",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { activities } = await bootCutoverPlan("p208-cutover-none-", PASSING_TEST, undefined);
    assertEquals(completedStatus(activities), "not_configured");
    assertEquals(
      activities.filter((r) => r.action_type.startsWith("execution.verification.")).length,
      0,
      "no verification events without a block",
    );
  },
});

Deno.test({
  name: "[phase208-cutover] a booted daemon re-verifies a committed change and journals passed on the request trace",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { activities } = await bootCutoverPlan("p208-cutover-pass-", PASSING_TEST, verificationBlock(0));
    assertEquals(completedStatus(activities), "passed");
    const types = activities.map((r) => r.action_type);
    assert(types.includes("execution.verification.started"), types.join(","));
    assert(types.includes("execution.verification.passed"), types.join(","));
  },
});

Deno.test({
  name: "[phase208-cutover] a booted daemon journals failed for a failing check when no repair is allowed",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { activities } = await bootCutoverPlan("p208-cutover-fail-", FAILING_TEST, verificationBlock(0));
    assertEquals(completedStatus(activities), "failed");
    const types = activities.map((r) => r.action_type);
    assert(types.includes("execution.verification.failed"), types.join(","));
  },
});
