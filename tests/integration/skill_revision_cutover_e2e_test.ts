/**
 * @module SkillRevisionCutoverE2eTest
 * @path tests/integration/skill_revision_cutover_e2e_test.ts
 * @description One real daemon with a loopback compatible provider proves the revision cutover end to end.
 *   Request A plans against the original `code-review` skill, the live file is edited, request B plans
 *   against the edit, and approving A still executes the exact A body and never the B marker. The journal
 *   and the CLI history agree on the two revisions, the single drift event and the per-call usage rows.
 *   The daemon runs once, and decisive evidence is written outside the temporary workspace.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @exaix/storage-sqlite, @exaix/core/config, ./helpers/daemon_config.ts]
 * @related-files [packages/core/src/planning/plan_executor.ts, packages/execution/src/agent_runner.ts, tests/scenario_framework/scenarios/skill_eval/skill-revision-cutover.yaml]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX, SkillMatchSource } from "@exaix/core";
import { renderSkillEntry } from "@exaix/core/func";
import { skillToContextEntry } from "@exaix/core/skills";
import { createSkillLoaderFor, testSkillContext } from "@exaix/testing";
import { setupGitRepo } from "@exaix/git/testing";
import { bootRealDaemon, daemonConfigSections } from "./helpers/daemon_config.ts";
import { type ICutoverEvidence, verifyCutoverEvidence } from "./helpers/skill_cutover_evidence.ts";
import { SkillRootKind } from "@exaix/core";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const EXACTL = join(REPO_ROOT, "apps", "exactl", "src", "exactl.ts");
const FIXTURE = join(
  REPO_ROOT,
  "tests",
  "scenario_framework",
  "fixtures",
  "requests",
  "skill_eval",
  "code_review_cutover.md",
);
const SKILL = "code-review";
const PORTAL = "cutover-portal";
const B_MARKER = "CUTOVER_B_EDIT_MARKER";
const EVIDENCE_ENV = "EXA_PHASE206_EVIDENCE_DIR";
const DAEMON_SETTLE_MS = 30000;
const STEP_WAIT_MS = 90000;
const POLL_MS = 250;
const REQUIRED_FIXTURE_FIELDS = ["trace_id", "created", "status", "agent_role", "portal", "skills"];

interface IActivityRow {
  rowid: number;
  action_type: string;
  trace_id: string | null;
  payload: string;
}

interface IProviderRequest {
  index: number;
  prompt: string;
}

interface ICutoverRun {
  tempDir: string;
  configPath: string;
  evidenceDir: string;
  provider: IProviderRequest[];
}

async function withDb<T>(configPath: string, run: (db: DatabaseService) => Promise<T>): Promise<T> {
  const db = new DatabaseService(new ConfigService(configPath).getAll());
  try {
    return await run(db);
  } finally {
    await db.close();
  }
}

async function gitStatus(path: string): Promise<string> {
  const result = await new Deno.Command("git", {
    args: ["status", "--porcelain", "--", path],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return new TextDecoder().decode(result.stdout);
}

const readActivity = (configPath: string) =>
  withDb(
    configPath,
    (db) => db.preparedAll<IActivityRow>("SELECT rowid, action_type, trace_id, payload FROM activity ORDER BY rowid"),
  );

async function exactl(
  run: ICutoverRun,
  args: string[],
): Promise<{ code: number; out: string; err: string }> {
  const result = await new Deno.Command("deno", {
    args: ["run", "-A", "--config", join(REPO_ROOT, "deno.json"), EXACTL, ...args],
    cwd: run.tempDir,
    env: { EXA_CONFIG_PATH: run.configPath },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return { code: result.code, out: decode(result.stdout), err: decode(result.stderr) };
}

/** Parses the JSON object a command printed, skipping the journal event lines that precede it. */
function jsonOf<T>(out: string): T {
  const lines = out.split("\n");
  const start = lines.findIndex((line) => line === "{" || line === "[");
  assert(start >= 0, `no JSON in output: ${out}`);
  return JSON.parse(lines.slice(start).join("\n")) as T;
}

async function until(check: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

interface ICutoverFixture {
  text: string;
  agentRole: string;
  portal: string;
  skills: string;
}

/** The fixture must carry every field the request parser needs before it is submitted. */
function loadFixture(timestamp: string): ICutoverFixture {
  const text = Deno.readTextFileSync(FIXTURE).replaceAll("{{timestamp}}", timestamp);
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert(frontmatter, "the cutover fixture must start with frontmatter");
  for (const field of REQUIRED_FIXTURE_FIELDS) {
    assert(new RegExp(`^${field}:`, "m").test(frontmatter[1]), `the cutover fixture lacks ${field}`);
  }
  const field = (name: string) =>
    /^[^:]+:\s*"?([^"\n]*)"?$/m.exec(
      frontmatter[1].split("\n").find((line) => line.startsWith(`${name}:`)) ?? "",
    )?.[1] ?? "";
  const skills = /^skills:\s*\[(.*)\]/m.exec(frontmatter[1])?.[1] ?? "";
  return { text, agentRole: field("agent_role"), portal: field("portal"), skills: skills.replaceAll(/\s/g, "") };
}

function planOf(plansDir: string, traceId: string): string | undefined {
  try {
    for (const entry of Deno.readDirSync(plansDir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      if (Deno.readTextFileSync(join(plansDir, entry.name)).includes(traceId)) return entry.name.slice(0, -3);
    }
  } catch {
    // The daemon creates the plans directory after the first request.
  }
  return undefined;
}

function planResponse(): string {
  return JSON.stringify({
    title: "Cutover review",
    description: "Review src/marker.txt for correctness defects.",
    steps: [{ step: 1, title: "Review the marker", description: "Read the marker file and report defects." }],
  });
}

function chatResponse(content: string) {
  return Response.json({
    model: "compat-fixture-v1",
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 },
  });
}

/** Removes the runner's EXA_* variables so the daemon and the CLI see only this test's own config. Returns the restore function. */
function scrubFrameworkEnv(): () => void {
  const kept = new Set([EVIDENCE_ENV]);
  const removed = Object.entries(Deno.env.toObject()).filter(([name]) => name.startsWith("EXA_") && !kept.has(name));
  for (const [name] of removed) Deno.env.delete(name);
  return () => {
    for (const [name, value] of removed) Deno.env.set(name, value);
  };
}

Deno.test({
  name:
    "[skill_revision_cutover_e2e] an edit after plan A never reaches A's execution and the history proves both revisions",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const restoreEnv = scrubFrameworkEnv();
    const tempDir = await Deno.makeTempDir({ prefix: "skill-cutover-e2e-" });
    const evidenceBase = Deno.env.get(EVIDENCE_ENV) ??
      join(REPO_ROOT, "tests", "scenario_framework", "output", "phase-206");
    const evidenceDir = join(evidenceBase, `cutover-${crypto.randomUUID().slice(0, 8)}`);
    await Deno.mkdir(evidenceDir, { recursive: true });
    const provider: IProviderRequest[] = [];
    const fixture = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request: Request) => {
      if (new URL(request.url).pathname === "/api/embed") {
        const embedding = await request.json() as { input?: string[] };
        return Response.json({ embeddings: (embedding.input ?? []).map(() => Array(768).fill(0)) });
      }
      const body = await request.json() as { messages?: Array<{ role: string; content?: string }> };
      const prompt = (body.messages ?? []).map((message) => message.content ?? "").join("\n");
      provider.push({ index: provider.length + 1, prompt });
      if (prompt.startsWith("Extract reusable learnings")) return chatResponse('{"learnings":[]}');
      const executing = prompt.includes("### EXECUTION REPORT SUMMARY ###") ||
        prompt.includes('output "STATUS: COMPLETE"');
      return chatResponse(
        executing ? `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}review complete` : planResponse(),
      );
    });
    const port = (fixture.addr as Deno.NetAddr).port;
    const configPath = join(tempDir, "exa.config.toml");
    const run: ICutoverRun = { tempDir, configPath, evidenceDir, provider };
    const state: {
      traceA?: string;
      traceB?: string;
      planA?: string;
      planB?: string;
      daemonStarts?: number;
    } = {};
    try {
      const portal = join(tempDir, "portal");
      await Deno.mkdir(join(portal, "src"), { recursive: true });
      await Deno.writeTextFile(join(portal, "src", "marker.txt"), "cutover marker");
      await setupGitRepo(portal, { initialCommit: true });
      for (const args of [["add", "src/marker.txt"], ["commit", "-m", "Add marker"]]) {
        const git = await new Deno.Command("git", { args, cwd: portal, stdout: "piped", stderr: "piped" }).output();
        assertEquals(git.code, 0, new TextDecoder().decode(git.stderr));
      }
      await copy(join(REPO_ROOT, "Blueprints", "Skills"), join(tempDir, "Blueprints", "Skills"));
      await Deno.mkdir(join(tempDir, "Blueprints", "Agents"), { recursive: true });
      await Deno.writeTextFile(
        join(tempDir, "Blueprints", "Agents", "security-expert.md"),
        [
          "---",
          'agent_role: "security-expert"',
          'name: "Cutover Security Expert"',
          'model: "openai-chat:compat-fixture-v1"',
          "model_size: M",
          "characteristics: [fastest]",
          'capabilities: ["react"]',
          'created: "2026-10-07T00:00:00Z"',
          'created_by: "cutover-test"',
          'version: "1.0.0"',
          'description: "Cutover fixture role with no default skills"',
          "default_skills: []",
          'permitted_tools: ["read_file"]',
          "---",
          "Review the requested file and report the result.",
          "",
        ].join("\n"),
      );
      await Deno.writeTextFile(
        configPath,
        [
          ...daemonConfigSections(tempDir, ""),
          "",
          "[ai]",
          'provider = "mock"',
          'model = "test"',
          "",
          "[ai.mock]",
          "timeout_ms = 30000",
          "",
          "[agents]",
          'default_model = "compat-agent"',
          "",
          "[models.compat-agent]",
          'provider = "openai-chat"',
          'model = "compat-fixture-v1"',
          "timeout_ms = 10000",
          "",
          "[models.compat-agent.compatible]",
          'profile = "local-test"',
          `endpoint = "http://127.0.0.1:${port}/v1/chat/completions"`,
          'model = "compat-fixture-v1"',
          "allow_insecure_loopback = true",
          "",
          "[skills]",
          "inject_in_prompt = true",
          'render_mode = "full"',
          "",
          "[planning]",
          "tools_enabled = false",
          "",
          "[quality_gate]",
          "enabled = false",
          "",
          "[execution]",
          "native_tools_enabled = false",
          "",
          "[memory.embedding]",
          'provider = "ollama"',
          'model = "nomic-embed-text"',
          `baseUrl = "http://127.0.0.1:${port}"`,
          "",
          "[[portals]]",
          `alias = "${PORTAL}"`,
          `target_path = "${portal}"`,
        ].join("\n"),
      );
      const skillPath = join(tempDir, "Blueprints", "Skills", SKILL, "SKILL.md");
      const originalSkill = await Deno.readTextFile(skillPath);
      const originalRoot = join(tempDir, "original-skills");
      await copy(join(tempDir, "Blueprints", "Skills", SKILL), join(originalRoot, SKILL));
      const canonical = (await createSkillLoaderFor([{
        path: originalRoot,
        kind: SkillRootKind.BLUEPRINT,
        writable: false,
        project: null,
      }]).get(SKILL, testSkillContext()))!;
      const canonicalBlockA = renderSkillEntry(
        skillToContextEntry(canonical.skill, {
          confidence: 1,
          source: SkillMatchSource.PINNED,
          matchedTriggers: {},
        }),
        true,
      ).trimEnd();
      const memorySkillsBefore = await gitStatus("Memory/Skills");

      const submit = async (label: string): Promise<{ traceId: string; planId: string }> => {
        const before = (await readActivity(configPath)).reduce((max, row) => Math.max(max, row.rowid), 0);
        const file = join(tempDir, `${label}.md`);
        const request = loadFixture(new Date().toISOString());
        await Deno.writeTextFile(file, request.text);
        const submitted = await exactl(run, [
          "request",
          "--file",
          file,
          "--agent-role",
          request.agentRole,
          "--portal",
          request.portal,
          "--skills",
          request.skills,
        ]);
        assertEquals(submitted.code, 0, submitted.err || submitted.out);
        let traceId: string | undefined;
        assert(
          await until(async () => {
            const created = (await readActivity(configPath)).find((row) =>
              row.rowid > before && row.action_type === "request.created" && row.trace_id !== null
            );
            traceId = created?.trace_id ?? undefined;
            return traceId !== undefined;
          }, STEP_WAIT_MS),
          `request ${label} was never created`,
        );
        let planId: string | undefined;
        assert(
          await until(() => {
            planId = planOf(join(tempDir, "Workspace", "Plans"), traceId!);
            return planId !== undefined;
          }, STEP_WAIT_MS),
          `no review plan for ${label}: ${JSON.stringify(provider.map((call) => call.prompt.slice(0, 200)))}`,
        );
        await Deno.copyFile(
          join(tempDir, "Workspace", "Plans", `${planId}.md`),
          join(evidenceDir, `plan-${label}.md`),
        );
        return { traceId: traceId!, planId: planId! };
      };

      await bootRealDaemon(configPath, DAEMON_SETTLE_MS, {
        extraEnv: { EXA_COMPAT_TEST_API_KEY: "local-fixture-key" },
        midFlight: async () => {
          const a = await submit("request-a");
          state.traceA = a.traceId;
          state.planA = a.planId;
          await Deno.writeTextFile(skillPath, `${originalSkill.trimEnd()}\n\n${B_MARKER}\n`);
          const b = await submit("request-b");
          state.traceB = b.traceId;
          state.planB = b.planId;
          const approved = await exactl(run, ["plan", "approve", state.planA!]);
          assertEquals(approved.code, 0, approved.err || approved.out);
          assert(
            await until(
              async () =>
                (await readActivity(configPath)).some((row) =>
                  row.trace_id === state.traceA &&
                  ["execution.completed", "execution.failed", "request.failed"].includes(row.action_type)
                ),
              STEP_WAIT_MS,
            ),
            "plan A never reached a terminal execution event",
          );
        },
        afterInjectMs: 0,
      });

      await Deno.writeTextFile(join(evidenceDir, "provider-requests.json"), JSON.stringify(provider, null, 2));
      assert(state.traceA && state.traceB && state.planA && state.planB);
      const activity = await readActivity(configPath);
      await Deno.writeTextFile(join(evidenceDir, "activity.json"), JSON.stringify(activity, null, 2));
      assertEquals(
        activity.filter((row) => row.action_type === "daemon.ready").length,
        1,
        "the daemon must not restart during the cutover",
      );
      assertEquals(
        activity.some((row) => row.trace_id === state.traceA && row.action_type === "execution.completed"),
        true,
        "plan A must complete its execution",
      );

      const usage = await withDb(configPath, (db) =>
        db.preparedAll<
          { call_id: string; trace_id: string; revision_id: string; match_source: string; submission_kind: string }
        >(
          `SELECT u.call_id, u.trace_id, u.revision_id, u.match_source, u.submission_kind
             FROM skill_usage u JOIN skill_revisions r ON r.revision_id = u.revision_id AND r.skill_name = u.skill_name
            WHERE u.skill_name = ? ORDER BY u.id`,
          [SKILL],
        ));
      const stored = await withDb(configPath, (db) =>
        db.preparedAll<{ revision_id: string }>(
          "SELECT revision_id FROM skill_revisions WHERE skill_name = ? ORDER BY first_seen_at",
          [SKILL],
        ));
      const rowsA = usage.filter((row) => row.trace_id === state.traceA);
      const rowsB = usage.filter((row) => row.trace_id === state.traceB);
      const planningA = rowsA.find((row) => row.match_source !== "plan_pinned");
      const executionA = rowsA.find((row) => row.match_source === "plan_pinned");
      assert(planningA && executionA && rowsB.length >= 1, `usage rows missing: ${JSON.stringify(usage)}`);
      const executionCall = provider.find((call) => call.prompt.includes(`Trace ID: ${state.traceA}`));
      assert(executionCall, "the provider never received the execution call of A");
      const evidence: ICutoverEvidence = {
        executionPromptA: executionCall.prompt,
        canonicalBlockA,
        markerB: B_MARKER,
        revisionA: planningA.revision_id,
        revisionB: rowsB[0].revision_id,
        traceA: state.traceA,
        traceB: state.traceB,
        planningCallA: planningA.call_id,
        executionCallA: executionA.call_id,
        planningCallB: rowsB[0].call_id,
        usageRows: usage,
        storedRevisionIds: stored.map((row) => row.revision_id),
        driftEvents: activity.filter((row) => row.action_type === "skills.pin_drifted").map((row) => ({
          trace_id: row.trace_id ?? "",
          ...JSON.parse(row.payload),
        })),
      };
      await Deno.writeTextFile(join(evidenceDir, "evidence.json"), JSON.stringify(evidence, null, 2));
      verifyCutoverEvidence(evidence);

      const revisions = await exactl(run, ["skills", "revisions", SKILL, "--format", "json"]);
      assertEquals(revisions.code, 0, revisions.err);
      const history = jsonOf<Array<{ revisionId: string; useCount: number }>>(revisions.out);
      assertEquals(history.map((entry) => entry.revisionId).sort(), [evidence.revisionA, evidence.revisionB].sort());
      assertEquals(history.find((entry) => entry.revisionId === evidence.revisionA)?.useCount, 2);
      const shown = await exactl(run, [
        "skills",
        "show",
        SKILL,
        "--revision",
        evidence.revisionA,
        "--format",
        "json",
      ]);
      assertEquals(shown.code, 0, shown.err);
      const shownJson = jsonOf<{ skillMd: string }>(shown.out);
      assertEquals(shownJson.skillMd.includes(B_MARKER), false, "the historical A revision never carries the edit");
      const usageA = await exactl(run, ["skills", "usage", "--trace", state.traceA, "--format", "json"]);
      const usageB = await exactl(run, ["skills", "usage", "--trace", state.traceB, "--format", "json"]);
      assertEquals([usageA.code, usageB.code], [0, 0], usageA.err + usageB.err);
      await Deno.writeTextFile(join(evidenceDir, "cli.json"), JSON.stringify({ revisions, shown, usageA, usageB }));
      assertStringIncludes(usageA.out, evidence.revisionA);
      assertEquals(usageA.out.includes(evidence.revisionB), false, "A's trace never names the edited revision");
      assertStringIncludes(usageB.out, evidence.revisionB);

      assertEquals(await gitStatus("Memory/Skills"), memorySkillsBefore, "the cutover must not touch Memory/Skills");
    } finally {
      restoreEnv();
      fixture.shutdown();
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
