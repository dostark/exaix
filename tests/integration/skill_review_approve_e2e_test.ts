/**
 * @module SkillReviewApproveE2eTest
 * @path tests/integration/skill_review_approve_e2e_test.ts
 * @description A real booted daemon and real `exactl` processes run the reviewed lifecycle end to end.
 *   A derived draft is never injected, approving the reviewed revision makes the daemon inject exactly
 *   that revision on its next request, and the lifecycle events and the usage row correlate by revision id.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @exaix/storage-sqlite, @exaix/core/config, ./helpers/daemon_config.ts]
 * @related-files [apps/exactl/src/command_builders/skill_commands.ts, packages/core/src/skills/skills.ts]
 */

import {
  DEFAULT_AGENTS_PATH,
  DEFAULT_BLUEPRINTS_PATH,
  DEFAULT_REQUESTS_PATH,
  DEFAULT_WORKSPACE_PATH,
} from "@exaix/shared";
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import {
  bootRealDaemon,
  daemonConfigSections,
  type IRunningDaemon,
  REQUEST_OUTCOME_ACTIONS,
} from "./helpers/daemon_config.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const EXACTL = join(REPO_ROOT, "apps", "exactl", "src", "exactl.ts");
const SKILL = "review-flow";
const MARKER = "REVIEWED_SKILL_MARKER";
const PROMPT_ASSEMBLED_EVENT = "agent.prompt_assembled";

interface IActivityRow {
  action_type: string;
  trace_id: string | null;
  payload: string;
}

function writeConfig(configPath: string, root: string): void {
  Deno.writeTextFileSync(
    configPath,
    [
      ...daemonConfigSections(root, ""),
      "",
      "[agents]",
      'default_model = "mock"',
      "",
      "[ai]",
      'provider = "mock"',
      'model = "test"',
      "",
      "[ai.mock]",
      "timeout_ms = 30000",
      "",
      "[models.mock]",
      'provider = "mock"',
      'model = "test"',
      "",
      "[quality_gate]",
      "enabled = false",
      "",
    ].join("\n"),
  );
}

async function withDb<T>(configPath: string, run: (db: DatabaseService) => Promise<T>): Promise<T> {
  const db = new DatabaseService(new ConfigService(configPath).getAll());
  try {
    return await run(db);
  } finally {
    await db.close();
  }
}

const readActivity = (configPath: string) =>
  withDb(
    configPath,
    (db) => db.preparedAll<IActivityRow>("SELECT action_type, trace_id, payload FROM activity ORDER BY rowid"),
  );

const readUsage = (configPath: string, traceId: string) =>
  withDb(
    configPath,
    (db) =>
      db.preparedAll<{ skill_name: string; revision_id: string }>(
        "SELECT skill_name, revision_id FROM skill_usage WHERE trace_id = ? ORDER BY id",
        [traceId],
      ),
  );

async function cli(
  configPath: string,
  root: string,
  args: string[],
): Promise<{ code: number; out: string; err: string }> {
  const result = await new Deno.Command("deno", {
    args: ["run", "-A", "--config", join(REPO_ROOT, "deno.json"), EXACTL, "skills", ...args],
    cwd: root,
    env: { EXA_CONFIG_PATH: configPath, EXA_TEST_MODE: "" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return { code: result.code, out: decode(result.stdout), err: decode(result.stderr) };
}

Deno.test({
  name: "[skill_review_approve_e2e] a derived draft is injected only after its reviewed revision is approved",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "skill-review-approve-e2e-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeConfig(configPath, tempDir);
    try {
      await Deno.mkdir(join(tempDir, DEFAULT_BLUEPRINTS_PATH, DEFAULT_AGENTS_PATH), { recursive: true });
      await Deno.copyFile(
        join(REPO_ROOT, DEFAULT_BLUEPRINTS_PATH, DEFAULT_AGENTS_PATH, "mock-agent.md"),
        join(tempDir, DEFAULT_BLUEPRINTS_PATH, DEFAULT_AGENTS_PATH, "mock-agent.md"),
      );

      const submit = async (daemon: IRunningDaemon): Promise<string> => {
        const traceId = crypto.randomUUID();
        await Deno.mkdir(join(tempDir, DEFAULT_WORKSPACE_PATH, DEFAULT_REQUESTS_PATH), { recursive: true });
        await Deno.writeTextFile(
          join(tempDir, DEFAULT_WORKSPACE_PATH, DEFAULT_REQUESTS_PATH, `request-${traceId.slice(0, 8)}.md`),
          `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: mock-agent
skills: ["${SKILL}"]
source: cli
created_by: "test@example.com"
subject: "Reviewed skill request"
---

# Request

Add a hello world function.
`,
        );
        await daemon.until(
          async () =>
            (await readActivity(configPath)).some((row) =>
              row.trace_id === traceId &&
              (row.action_type === PROMPT_ASSEMBLED_EVENT || REQUEST_OUTCOME_ACTIONS.includes(row.action_type))
            ),
          "the request to assemble its prompt",
        );
        return traceId;
      };

      const state: { derived?: string; draftTrace?: string; activeTrace?: string; active?: string } = {};
      await bootRealDaemon(configPath, {
        midFlight: async (daemon) => {
          const derived = await cli(configPath, tempDir, [
            "derive",
            "--learning-ids",
            "learning-a,learning-b",
            "--name",
            "Review Flow",
            "--instructions",
            `${MARKER} body.`,
          ]);
          assertEquals(derived.code, 0, derived.err);
          const match = derived.out.match(/Revision: ([0-9a-f-]{36})/);
          assert(match, `no revision in derive output: ${derived.out}`);
          state.derived = match[1];

          state.draftTrace = await submit(daemon);

          const approved = await cli(configPath, tempDir, [
            "approve",
            SKILL,
            "--revision",
            state.derived,
            "--format",
            "json",
          ]);
          assertEquals(approved.code, 0, approved.err);
          const lines = approved.out.split("\n");
          state.active = JSON.parse(lines.slice(lines.findIndex((line) => line === "{")).join("\n")).activeRevisionId;

          state.activeTrace = await submit(daemon);
        },
      });

      assertEquals(
        (await readUsage(configPath, state.draftTrace!)).map((row) => row.skill_name),
        [],
        "a draft is never injected",
      );
      const usage = await readUsage(configPath, state.activeTrace!);
      assertEquals(usage.map((row) => row.skill_name), [SKILL]);
      assertEquals(usage[0].revision_id, state.active, "the next request injects exactly the approved revision");
      assert(state.active !== state.derived, "approval publishes a new active revision");

      const activity = await readActivity(configPath);
      const byType = (type: string) =>
        activity.filter((row) => row.action_type === type).map((row) => JSON.parse(row.payload));
      assertEquals(byType("skill.derived").map((payload) => payload.revision_id), [state.derived]);
      const approvedEvents = byType("skills.approved");
      assertEquals(approvedEvents.length, 1);
      assertEquals(approvedEvents[0].reviewed_revision_id, state.derived);
      assertEquals(approvedEvents[0].active_revision_id, state.active);
      assert(
        activity.some((row) =>
          row.trace_id === state.activeTrace && row.action_type === "skills.revision_recorded" &&
          JSON.parse(row.payload).revision_id === state.active
        ),
        "the request trace journals the revision snapshot of the approved skill",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
