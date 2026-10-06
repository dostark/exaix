/**
 * @module SkillSingleSourceE2eTest
 * @path tests/integration/skill_single_source_e2e_test.ts
 * @description Phase 206 Step 3 — a real booted daemon reads skill folders directly. It journals
 *   skills.initialized, injects a pinned Blueprint skill folder into a real Request (agent.prompt_assembled lists it), and writes
 *   no usage_count, index or JSON file: the authored folders stay byte-identical and no compiled
 *   store appears under Memory/Skills.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @exaix/storage-sqlite, @exaix/core/config, ./helpers/daemon_config.ts]
 * @related-files [apps/daemon/main.ts, packages/core/src/skills/skills.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { bootRealDaemon, daemonConfigSections } from "./helpers/daemon_config.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const SKILL_NAME = "e2e-folder-skill";
const SKILL_MARKER = "E2E_FOLDER_SKILL_MARKER";
const SKILLS_INITIALIZED_EVENT = "skills.initialized";
const PROMPT_ASSEMBLED_EVENT = "agent.prompt_assembled";
const DAEMON_SETTLE_MS = 5000;
const REQUEST_WAIT_MS = 20000;

interface IActivityRow {
  action_type: string;
  trace_id: string | null;
  payload: string;
}

function writeConfig(configPath: string, root: string): void {
  const cfg = [
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
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

async function readActivity(configPath: string): Promise<IActivityRow[]> {
  const db = new DatabaseService(new ConfigService(configPath).getAll());
  try {
    return await db.preparedAll<IActivityRow>(
      "SELECT action_type, trace_id, payload FROM activity ORDER BY rowid ASC",
    );
  } finally {
    await db.close();
  }
}

/** Every file under `dir` mapped to its bytes, so a run can be compared byte for byte. */
async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  try {
    for await (const entry of walk(dir, { includeDirs: false })) {
      snapshot.set(entry.path.slice(dir.length), await Deno.readTextFile(entry.path));
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return snapshot;
}

Deno.test({
  name:
    "[skill_single_source_e2e] a booted daemon injects a pinned skill folder and writes no usage_count, index or JSON file",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "skill-single-source-e2e-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeConfig(configPath, tempDir);
    try {
      await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
      await Deno.copyFile(
        join(REPO_ROOT, "Blueprints", "Agents", "mock-agent.md"),
        join(tempDir, "Blueprints", "Agents", "mock-agent.md"),
      );
      const skillDir = join(tempDir, "Blueprints", "Skills", SKILL_NAME);
      await Deno.mkdir(skillDir, { recursive: true });
      await Deno.writeTextFile(
        join(skillDir, "SKILL.md"),
        `---\nname: ${SKILL_NAME}\ndescription: Folder skill for the daemon e2e\n---\n# E2E\n\n${SKILL_MARKER}\n`,
      );
      await Deno.writeTextFile(join(skillDir, "exaix.yaml"), "title: E2E Folder Skill\n");
      const authoredBefore = await snapshotTree(join(tempDir, "Blueprints", "Skills"));

      const traceId = crypto.randomUUID();
      const requestPath = join(tempDir, "Workspace", "Requests", `request-${traceId.slice(0, 8)}.md`);
      await bootRealDaemon(configPath, DAEMON_SETTLE_MS, {
        midFlight: () => {
          Deno.mkdirSync(join(tempDir, "Workspace", "Requests"), { recursive: true });
          Deno.writeTextFileSync(
            requestPath,
            `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: mock-agent
skills: ["${SKILL_NAME}"]
source: cli
created_by: "test@example.com"
subject: "Skill folder e2e request"
---

# Request

Add a hello world function.
`,
          );
        },
        afterInjectMs: REQUEST_WAIT_MS,
        waitForAfterInject: async () =>
          (await readActivity(configPath)).some((row) =>
            row.trace_id === traceId && row.action_type === PROMPT_ASSEMBLED_EVENT
          ),
      });

      const activity = await readActivity(configPath);
      const initialized = activity.find((row) => row.action_type === SKILLS_INITIALIZED_EVENT);
      assert(initialized, "the daemon must journal skills.initialized at boot");
      assertEquals(JSON.parse(initialized.payload).outcome, "ready");

      const assembled = activity.find((row) => row.trace_id === traceId && row.action_type === PROMPT_ASSEMBLED_EVENT);
      assert(
        assembled,
        `the request must journal agent.prompt_assembled, got: ${
          activity.filter((r) => r.trace_id === traceId).map((r) => `${r.action_type}:${r.payload.slice(0, 160)}`).join(
            " | ",
          )
        }`,
      );
      assert(
        (JSON.parse(assembled.payload).skillIdsUsed as string[]).includes(SKILL_NAME),
        "the pinned folder skill is injected into the assembled prompt",
      );

      assertEquals(
        await snapshotTree(join(tempDir, "Blueprints", "Skills")),
        authoredBefore,
        "authored skill folders are byte-identical after the run",
      );
      const memorySkills = await snapshotTree(join(tempDir, "Memory", "Skills"));
      for (const [path, content] of memorySkills) {
        assert(!path.endsWith(".json"), `no JSON skill file may be written: ${path}`);
        assert(!content.includes("usage_count"), `no usage_count may be written: ${path}`);
      }
      assertEquals(memorySkills.has("/index.json"), false, "no skill index is written");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
