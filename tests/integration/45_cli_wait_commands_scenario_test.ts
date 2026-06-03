/**
 * @module CliWaitCommandsScenarioTest
 * @path tests/integration/45_cli_wait_commands_scenario_test.ts
 * @description Scenario tests for the full wait-state CLI lifecycle: creating wait-state
 * artifacts on disk and exercising exactl wait list/approve/reject/amend/expire commands.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { withCliProcessMutex } from "../helpers/cli_process_mutex.ts";

const WAIT_UUID = "550e8400-e29b-41d4-a716-446655440000";
const TOKEN_UUID = "550e8400-e29b-41d4-a716-446655440001";
const TRACE_ID = "trace-scenario-45";

function makeWaitStateJson(overrides: object = {}): string {
  return JSON.stringify(
    {
      waitStateId: WAIT_UUID,
      traceId: TRACE_ID,
      kind: "plan_approval",
      status: "pending",
      artifactPath: "Workspace/Active/test-flow",
      resumeToken: TOKEN_UUID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 86_400_000).toISOString(),
      metadata: {},
      ...overrides,
    },
    null,
    2,
  );
}

function getFallbackConfig(root: string): string {
  return `
[system]
version = "1.0.0"
log_level = "info"
root = "${root}"

[paths]
memory = "./Memory"
blueprints = "./Blueprints"
runtime = "./.exa"
workspace = "./Workspace"
portals = "./Portals"
active = "Active"
archive = "Archive"
plans = "Plans"
requests = "Requests"
rejected = "Rejected"
identities = "Identities"
flows = "Flows"
memoryProjects = "Projects"
memoryExecution = "Execution"
memoryIndex = "Index"
memorySkills = "Skills"
memoryPending = "Pending"
memoryTasks = "Tasks"
memoryGlobal = "Global"
waitStates = "WaitStates"

[database.sqlite]
journal_mode = "WAL"
foreign_keys = true
busy_timeout_ms = 5000

[agents]
default_model = "default"
timeout_sec = 60
max_iterations = 10

[models.default]
provider = "mock"
model = "gpt-5.2-pro"
timeout_ms = 30000
`.trim();
}

async function runExactl(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const repoRoot = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
  const exactlPath = join(repoRoot, "apps", "exactl", "main.ts");

  const configPath = join(cwd, "exa.config.toml");
  const hasConfig = await Deno.stat(configPath).then(() => true).catch(() => false);
  if (!hasConfig) {
    await Deno.writeTextFile(configPath, getFallbackConfig(cwd));
  }

  const parentEnv = Deno.env.toObject();
  const env: Record<string, string> = {
    PATH: parentEnv.PATH ?? "",
    HOME: parentEnv.HOME ?? "",
    TMPDIR: parentEnv.TMPDIR ?? "/tmp",
    TERM: parentEnv.TERM ?? "xterm",
  };
  env.EXA_CONFIG_PATH = configPath;
  env.EXA_LLM_PROVIDER = "mock";

  return await withCliProcessMutex(async () => {
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", exactlPath, ...args],
      cwd,
      stdout: "piped",
      stderr: "piped",
      env,
    });
    const { code, stdout, stderr } = await command.output();
    const stdoutStr = new TextDecoder().decode(stdout);
    const stderrStr = new TextDecoder().decode(stderr);
    const effectiveStdout = stdoutStr.trim() ? stdoutStr : stderrStr;
    return { code, stdout: effectiveStdout, stderr: stderrStr };
  });
}

const skipInParallel = !!Deno.env.get("DENO_JOBS") && Deno.env.get("EXA_TEST_FORCE_CLI_PARALLEL") !== "1";

function cliTest(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, ignore: skipInParallel, fn });
}

cliTest("WaitScenario: exactl wait list returns wait states created as files on disk", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "wait-scenario-" });
  try {
    const waitDir = join(tempDir, "Workspace", "WaitStates", TRACE_ID);
    await Deno.mkdir(waitDir, { recursive: true });
    await Deno.writeTextFile(join(waitDir, `${WAIT_UUID}.json`), makeWaitStateJson());

    const result = await runExactl(["wait", "list"], tempDir);
    assertEquals(result.code, 0, `expected exit 0, got ${result.code}: ${result.stderr}`);
    assertStringIncludes(result.stdout, WAIT_UUID.substring(0, 8));
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

cliTest("WaitScenario: exactl wait list --status filters by status", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "wait-scenario-" });
  try {
    const waitDir = join(tempDir, "Workspace", "WaitStates", TRACE_ID);
    await Deno.mkdir(waitDir, { recursive: true });
    await Deno.writeTextFile(
      join(waitDir, `${WAIT_UUID}.json`),
      makeWaitStateJson({ status: "fulfilled" }),
    );

    const result = await runExactl(["wait", "list", "--status", "fulfilled"], tempDir);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, WAIT_UUID.substring(0, 8));
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

cliTest("WaitScenario: exactl wait approve transitions wait state to fulfilled", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "wait-scenario-" });
  try {
    const waitDir = join(tempDir, "Workspace", "WaitStates", TRACE_ID);
    await Deno.mkdir(waitDir, { recursive: true });
    await Deno.writeTextFile(join(waitDir, `${WAIT_UUID}.json`), makeWaitStateJson());

    const result = await runExactl(["wait", "approve", TOKEN_UUID, "-m", "Approved in scenario"], tempDir);
    assertEquals(result.code, 0, `expected exit 0, got ${result.code}: ${result.stderr}`);

    const updated = JSON.parse(await Deno.readTextFile(join(waitDir, `${WAIT_UUID}.json`)));
    assertEquals(updated.status, "fulfilled");
    assertEquals(updated.resolutionSummary, "Approved in scenario");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

cliTest("WaitScenario: exactl wait reject transitions wait state to rejected", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "wait-scenario-" });
  try {
    const waitDir = join(tempDir, "Workspace", "WaitStates", TRACE_ID);
    await Deno.mkdir(waitDir, { recursive: true });
    await Deno.writeTextFile(join(waitDir, `${WAIT_UUID}.json`), makeWaitStateJson());

    const result = await runExactl(["wait", "reject", TOKEN_UUID, "-m", "Rejected in scenario"], tempDir);
    assertEquals(result.code, 0);

    const updated = JSON.parse(await Deno.readTextFile(join(waitDir, `${WAIT_UUID}.json`)));
    assertEquals(updated.status, "rejected");
    assertEquals(updated.resolutionSummary, "Rejected in scenario");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

cliTest("WaitScenario: exactl wait amend transitions wait state to amended", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "wait-scenario-" });
  try {
    const waitDir = join(tempDir, "Workspace", "WaitStates", TRACE_ID);
    await Deno.mkdir(waitDir, { recursive: true });
    await Deno.writeTextFile(join(waitDir, `${WAIT_UUID}.json`), makeWaitStateJson());

    const result = await runExactl(["wait", "amend", TOKEN_UUID, "-m", "Please revise"], tempDir);
    assertEquals(result.code, 0);

    const updated = JSON.parse(await Deno.readTextFile(join(waitDir, `${WAIT_UUID}.json`)));
    assertEquals(updated.status, "amended");
    assertEquals(updated.resolutionSummary, "Please revise");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

cliTest("WaitScenario: exactl wait expire transitions wait state to expired", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "wait-scenario-" });
  try {
    const waitDir = join(tempDir, "Workspace", "WaitStates", TRACE_ID);
    await Deno.mkdir(waitDir, { recursive: true });
    await Deno.writeTextFile(join(waitDir, `${WAIT_UUID}.json`), makeWaitStateJson());

    const result = await runExactl(["wait", "expire", TOKEN_UUID, "-m", "Timed out"], tempDir);
    assertEquals(result.code, 0);

    const updated = JSON.parse(await Deno.readTextFile(join(waitDir, `${WAIT_UUID}.json`)));
    assertEquals(updated.status, "expired");
    assertEquals(updated.resolutionSummary, "Timed out");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

cliTest("WaitScenario: exactl wait approve on non-pending wait state errors gracefully", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "wait-scenario-" });
  try {
    const waitDir = join(tempDir, "Workspace", "WaitStates", TRACE_ID);
    await Deno.mkdir(waitDir, { recursive: true });
    await Deno.writeTextFile(
      join(waitDir, `${WAIT_UUID}.json`),
      makeWaitStateJson({ status: "fulfilled" }),
    );

    const result = await runExactl(["wait", "approve", TOKEN_UUID, "-m", "Should fail"], tempDir);
    assertEquals(result.code, 1);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

cliTest("WaitScenario: exactl wait list returns empty when no wait states", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "wait-scenario-" });
  try {
    const result = await runExactl(["wait", "list"], tempDir);
    assertEquals(result.code, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
