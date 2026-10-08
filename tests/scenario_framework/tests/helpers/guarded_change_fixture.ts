/**
 * @module GuardedChangeFixture
 * @path tests/scenario_framework/tests/helpers/guarded_change_fixture.ts
 * @description Stages hardened plan context and checks the reconciled delegate worktree evidence.
 * @architectural-layer Test
 * @dependencies [@exaix/core, @exaix/portal, @exaix/schemas]
 * @related-files [tests/scenario_framework/tests/integration/advanced_flow_controls_test.ts]
 */
import { Database } from "@db/sqlite";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { PathResolver } from "@exaix/portal";
import { ConfigSchema } from "@exaix/schemas";
import { SessionBriefSchema, SessionReturnSchema } from "@exaix/schemas/session_delegate.ts";
import { copyDocIntoPlanContext } from "../../../../scripts/plan_to_requests.ts";

const PLAN_SLUG = "phase205-guarded-change";
const EXPECTED_PATHS = ["src/proof.txt", "tests/proof_test.ts"];

/** Give the deterministic launcher its known cache after the production child environment is sanitized. */
export function buildGuardedLauncher(
  runtimePath: string,
  configPath: string,
  launcherPath: string,
  cache: string | undefined,
): string {
  return `#!/usr/bin/env -S deno run -A
const result = await new Deno.Command(${JSON.stringify(runtimePath)}, {
  args: ["run", "-A", "--config", ${JSON.stringify(configPath)}, ${JSON.stringify(launcherPath)}, ...Deno.args],
  env: ${JSON.stringify(cache === undefined ? {} : { DENO_DIR: cache })},
  stdin: "inherit", stdout: "inherit", stderr: "inherit",
}).spawn().status;
Deno.exit(result.code);
`;
}

/** Stage the plan through the established copy protocol after the runner mounts the portal. */
export async function prepareGuardedPortal(workspaceRoot: string): Promise<void> {
  const config = new ConfigService(join(workspaceRoot, "exa.config.toml")).getAll();
  const resolver = new PathResolver(config);
  const root = await resolver.resolve("@exaix-self/");
  const target = await resolver.resolve(`@exaix-self/.exa/PlanContext/${PLAN_SLUG}.md`);
  const source = new URL(`../../fixtures/plans/${PLAN_SLUG}.md`, import.meta.url).pathname;
  assertEquals(await copyDocIntoPlanContext(source, PLAN_SLUG, root), target);
}

/** Verify the returned paths and actual Git changes against the isolated execution worktree. */
export async function assertGuardedDelegation(
  workspaceRoot: string,
  parentTraceId: string,
  delegationTraceId: string,
): Promise<void> {
  const config = new ConfigService(join(workspaceRoot, "exa.config.toml")).getAll();
  const resolver = new PathResolver(ConfigSchema.parse({
    ...config,
    portals: [...config.portals, { alias: "session-evidence", target_path: join(workspaceRoot, "Session") }, {
      alias: "journal-evidence",
      target_path: join(workspaceRoot, ".exa"),
    }],
  }));
  const brief = SessionBriefSchema.parse(
    JSON.parse(await Deno.readTextFile(await resolver.resolve(`@session-evidence/${delegationTraceId}/brief.json`))),
  );
  const returned = SessionReturnSchema.parse(
    JSON.parse(await Deno.readTextFile(await resolver.resolve(`@session-evidence/${delegationTraceId}/return.json`))),
  );
  const db = new Database(await resolver.resolve("@journal-evidence/journal.db"), { readonly: true });
  try {
    const reconciled = db.prepare("SELECT payload FROM activity WHERE trace_id = ? AND action_type = ?")
      .all<{ payload: string }>(delegationTraceId, "session.delegate.reconciled");
    assert(
      reconciled.some((row) => JSON.parse(row.payload).decision === "changes_made"),
      "the child session has accepted reconciliation evidence",
    );
  } finally {
    db.close();
  }
  assertEquals(brief.parent_trace_id, parentTraceId);
  assertEquals(brief.parent_step_id, "implement");
  assertEquals(brief.permitted_paths, EXPECTED_PATHS);
  assertEquals(brief.artifact_ref, `.exa/PlanContext/${PLAN_SLUG}.md`);
  const worktree = join(workspaceRoot, ".exa", "worktrees", "exaix-self", parentTraceId);
  assertEquals(brief.worktree_path, worktree);
  assertEquals(returned.trace_id, delegationTraceId);
  assertEquals(returned.resume_token, brief.resume_token);
  assertEquals(returned.decision, "changes_made");
  assertEquals(returned.paths_touched?.sort(), [...EXPECTED_PATHS].sort());
  const worktreeResolver = new PathResolver(ConfigSchema.parse({
    ...config,
    portals: [{ alias: "guarded-worktree", target_path: worktree }],
  }));
  assertStringIncludes(
    await Deno.readTextFile(await worktreeResolver.resolve("@guarded-worktree/src/proof.txt")),
    "GUARDED IMPLEMENTATION PROOF",
  );
  const testPath = await worktreeResolver.resolve("@guarded-worktree/tests/proof_test.ts");
  const test = await new Deno.Command(Deno.execPath(), { args: ["test", "--allow-read", "--no-config", testPath] })
    .output();
  assert(test.success, new TextDecoder().decode(test.stderr));
  const git = await new Deno.Command("git", { args: ["ls-files", "--others", "--exclude-standard"], cwd: worktree })
    .output();
  assert(git.success);
  assertEquals(new TextDecoder().decode(git.stdout).trim().split("\n").sort(), [...EXPECTED_PATHS].sort());
  for (const path of EXPECTED_PATHS) {
    await assertMissing(await new PathResolver(config).resolve(`@exaix-self/${path}`));
  }
}

/** Capture scope proof before daemon shutdown removes the temporary worktree. */
export async function captureGuardedDelegation(workspaceRoot: string): Promise<void> {
  const config = new ConfigService(join(workspaceRoot, "exa.config.toml")).getAll();
  const resolver = new PathResolver(
    ConfigSchema.parse({
      ...config,
      portals: [{ alias: "guarded-journal", target_path: join(workspaceRoot, ".exa") }],
    }),
  );
  const db = new Database(await resolver.resolve("@guarded-journal/journal.db"), { readonly: true });
  let parentTraceId: string;
  let delegationTraceId: string;
  try {
    const completed = db.prepare("SELECT trace_id, payload FROM activity WHERE action_type = ?")
      .all<{ trace_id: string; payload: string }>("session.delegate.cycle_step_completed");
    assertEquals(completed.length, 1);
    parentTraceId = completed[0].trace_id;
    delegationTraceId = JSON.parse(completed[0].payload).delegationTraceId;
  } finally {
    db.close();
  }
  await assertGuardedDelegation(workspaceRoot, parentTraceId, delegationTraceId);
  await Deno.writeTextFile(
    await resolver.resolve("@guarded-journal/guarded-scope-evidence.json"),
    JSON.stringify({ parentTraceId, delegationTraceId }),
  );
}

async function assertMissing(path: string): Promise<void> {
  try {
    await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new Error("The plain portal contains a delegated proof write");
}
