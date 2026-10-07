/**
 * @module SkillHotRootsE2eTest
 * @path tests/integration/skill_hot_roots_e2e_test.ts
 * @description A real booted daemon selects skill roots from the config it has loaded now. After the
 *   real exa.config.toml gains a custom root the next request reads from it and no longer from the
 *   default catalog, and the usage rows carry the new config generation. An invalid edit is refused,
 *   the previous generation stays in force and the next request still resolves from it.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @exaix/storage-sqlite, @exaix/core/config, ./helpers/daemon_config.ts]
 * @related-files [apps/daemon/main.ts, packages/core/src/skills/skills.ts, packages/core/src/config/service.ts]
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { bootRealDaemon, daemonConfigSections } from "./helpers/daemon_config.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const FIRST_SKILL = "hot-first-skill";
const SECOND_SKILL = "hot-second-skill";
const PROMPT_ASSEMBLED_EVENT = "agent.prompt_assembled";
const CONFIG_UPDATED_EVENT = "config.updated";
const DAEMON_SETTLE_MS = 20000;
const STEP_WAIT_MS = 60000;
const POLL_MS = 250;

interface IActivityRow {
  action_type: string;
  trace_id: string | null;
  payload: string;
}

interface IUsageRow {
  skill_name: string;
  config_generation: string;
}

function baseConfig(root: string): string {
  return [
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
}

/** Opens the journal through a pristine copy of the config, because the live file is edited to be invalid mid-test. */
async function withDb<T>(readerConfigPath: string, run: (db: DatabaseService) => Promise<T>): Promise<T> {
  const db = new DatabaseService(new ConfigService(readerConfigPath).getAll());
  try {
    return await run(db);
  } finally {
    await db.close();
  }
}

const readActivity = (configPath: string) =>
  withDb(
    configPath,
    (db) => db.preparedAll<IActivityRow>("SELECT action_type, trace_id, payload FROM activity ORDER BY rowid ASC"),
  );

const readUsage = (configPath: string, traceId: string) =>
  withDb(
    configPath,
    (db) =>
      db.preparedAll<IUsageRow>(
        "SELECT skill_name, config_generation FROM skill_usage WHERE trace_id = ? ORDER BY id",
        [traceId],
      ),
  );

async function until(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

async function writeSkill(dir: string, name: string): Promise<void> {
  const folder = join(dir, name);
  await Deno.mkdir(folder, { recursive: true });
  await Deno.writeTextFile(
    join(folder, "SKILL.md"),
    `---\nname: ${name}\ndescription: Hot roots e2e skill ${name}\n---\n# ${name}\n\nBody of ${name}.\n`,
  );
}

Deno.test({
  name:
    "[skill_hot_roots_e2e] a config edit changes the next request's roots and an invalid edit keeps the last good generation",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "skill-hot-roots-e2e-" });
    const configPath = join(tempDir, "exa.config.toml");
    const original = baseConfig(tempDir);
    Deno.writeTextFileSync(configPath, original);
    const readerDir = await Deno.makeTempDir({ prefix: "skill-hot-roots-reader-" });
    const readerConfig = join(readerDir, "exa.config.toml");
    Deno.writeTextFileSync(readerConfig, original);
    try {
      await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
      await Deno.copyFile(
        join(REPO_ROOT, "Blueprints", "Agents", "mock-agent.md"),
        join(tempDir, "Blueprints", "Agents", "mock-agent.md"),
      );
      await writeSkill(join(tempDir, "Blueprints", "Skills"), FIRST_SKILL);
      await writeSkill(join(tempDir, "Alt", "Skills"), SECOND_SKILL);

      const submit = async (skill: string): Promise<string> => {
        const traceId = crypto.randomUUID();
        await Deno.mkdir(join(tempDir, "Workspace", "Requests"), { recursive: true });
        await Deno.writeTextFile(
          join(tempDir, "Workspace", "Requests", `request-${traceId.slice(0, 8)}.md`),
          `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: mock-agent
skills: ["${skill}"]
source: cli
created_by: "test@example.com"
subject: "Hot roots ${skill}"
---

# Request

Add a hello world function.
`,
        );
        const assembled = await until(
          async () =>
            (await readActivity(readerConfig)).some((row) =>
              row.trace_id === traceId && row.action_type === PROMPT_ASSEMBLED_EVENT
            ),
          STEP_WAIT_MS,
        );
        assert(assembled, `request for ${skill} never assembled a prompt`);
        return traceId;
      };
      const configUpdates = async (): Promise<number> =>
        (await readActivity(readerConfig)).filter((row) => row.action_type === CONFIG_UPDATED_EVENT).length;
      const edit = async (text: string): Promise<void> => {
        const before = await configUpdates();
        await Deno.writeTextFile(configPath, text);
        await until(async () => (await configUpdates()) > before, STEP_WAIT_MS);
      };

      const traces: Record<string, string> = {};
      await bootRealDaemon(configPath, DAEMON_SETTLE_MS, {
        midFlight: async () => {
          traces.first = await submit(FIRST_SKILL);

          await edit(`${original}\n[skills]\nroots = [{ kind = "blueprint", path = "Alt/Skills" }]\n`);
          traces.second = await submit(SECOND_SKILL);
          traces.droppedFirst = await submit(FIRST_SKILL);

          const settled = await configUpdates();
          await Deno.writeTextFile(configPath, `${original}\n[skills]\nmain_max_bytes = "not a number"\n`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          assertEquals(await configUpdates(), settled, "an invalid edit never becomes a config update");
          traces.afterInvalid = await submit(SECOND_SKILL);
        },
        afterInjectMs: 0,
      });

      const names = async (traceId: string): Promise<string[]> =>
        (await readUsage(readerConfig, traceId)).map((row) => row.skill_name);
      assert((await names(traces.first)).includes(FIRST_SKILL));
      assert((await names(traces.second)).includes(SECOND_SKILL));
      assertEquals((await names(traces.second)).includes(FIRST_SKILL), false);
      assertEquals(
        (await names(traces.droppedFirst)).includes(FIRST_SKILL),
        false,
        "the default catalog is no longer a root after the edit",
      );
      assert((await names(traces.afterInvalid)).includes(SECOND_SKILL), "the last good generation stays in force");

      const [first] = await readUsage(readerConfig, traces.first);
      const [second] = await readUsage(readerConfig, traces.second);
      const [afterInvalidUsage] = await readUsage(readerConfig, traces.afterInvalid);
      assertNotEquals(first.config_generation, second.config_generation);
      assertEquals(afterInvalidUsage.config_generation, second.config_generation);
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
      await Deno.remove(readerDir, { recursive: true }).catch(() => {});
    }
  },
});
