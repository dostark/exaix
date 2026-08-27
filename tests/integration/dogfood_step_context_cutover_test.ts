/**
 * @module DogfoodStepContextCutoverTest
 * @path tests/integration/dogfood_step_context_cutover_test.ts
 * @description Phase 173 Step 3 [integration] bullets as permanent automation against a REAL
 *   linked git worktree (not a simulated one): a generator run with --plan-context-root aimed
 *   at the delegate worktree must produce requests carrying both the inline Why This Step
 *   Exists block and a resolvable relative PlanContext/ path, and `git status --porcelain`
 *   inside that worktree must stay clean — the judge-cleanliness property GAP-3 option-a
 *   depends on. Cuts at real git mechanics: linked worktrees hold a `.git` FILE whose shared
 *   common dir owns info/exclude.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/path]
 * @related-files [scripts/plan_to_requests.ts, tests/integration/fixtures/phase-nn-fixture-with-context.md, tests/integration/plan_to_requests_test.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "plan_to_requests.ts");
const CONTEXT_FIXTURE_PATH = join(REPO_ROOT, "tests", "integration", "fixtures", "phase-nn-fixture-with-context.md");
const CONTEXT_SLUG = "phase-nn-fixture-with-context";
const POINTER_RE = /> Full phase context: `PlanContext\/[^`]+\.md` \(read this if the context above isn't enough\)\./;

async function runGenerator(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", SCRIPT_PATH, ...args],
    stdout: "piped",
    stderr: "piped",
    cwd: REPO_ROOT,
  });
  const output = await cmd.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

interface IRealWorktree {
  root: string;
  cleanup(): Promise<void>;
}

/** A genuine linked worktree of this repository — `.git` is a FILE pointing into the
 *  parent's worktrees registry, exactly like dogfood_bootstrap's `git worktree add`. */
async function makeRealWorktree(): Promise<IRealWorktree> {
  const root = await Deno.makeTempDir({ prefix: "p173-cutover-wt-" });
  const add = await new Deno.Command("git", {
    args: ["worktree", "add", "--detach", root, "HEAD"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!add.success) {
    throw new Error(`git worktree add failed: ${new TextDecoder().decode(add.stderr)}`);
  }
  return {
    root,
    async cleanup() {
      await new Deno.Command("git", {
        args: ["worktree", "remove", "--force", root],
        cwd: REPO_ROOT,
        stdout: "piped",
        stderr: "piped",
      }).output();
      try {
        await Deno.remove(root, { recursive: true });
      } catch { /* already gone */ }
    },
  };
}

Deno.test(
  "[cutover][integration] generator run against a real phase doc into a real worktree target produces a request with both the inline context block and a resolvable PlanContext/ path",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const wt = await makeRealWorktree();
    try {
      // Mirror the dogfood workspace shape: requests live under <root>/workspace/...
      const outDir = join(
        await Deno.makeTempDir({ prefix: "p173-cutover-sandbox-" }),
        "workspace",
        "Workspace",
        "Requests",
      );
      const run = await runGenerator([CONTEXT_FIXTURE_PATH, "--out-dir", outDir, "--plan-context-root", wt.root]);
      assertEquals(run.code, 0, `generator failed: ${run.stderr}`);
      assertEquals(run.stderr.includes("Unsafe"), false);

      const request = await Deno.readTextFile(join(outDir, `${CONTEXT_SLUG}-step-1.md`));
      assertEquals(request.includes("## Why This Step Exists"), true, "inline context block present");
      assertEquals(request.indexOf("## Why This Step Exists") < request.indexOf("## Actions"), true);
      const pointerMatch = request.match(POINTER_RE);
      assertExists(pointerMatch, "request names the PlanContext path explicitly");

      // Resolvable BY CONSTRUCTION: the referenced relative path exists directly
      // under the worktree root that will be the delegate's cwd.
      const resolvedTarget = join(wt.root, "PlanContext", `${CONTEXT_SLUG}.md`);
      const stat = await Deno.stat(resolvedTarget);
      assertEquals(stat.isFile, true);
      assertEquals(
        await Deno.readTextFile(resolvedTarget),
        await Deno.readTextFile(CONTEXT_FIXTURE_PATH),
        "copy matches the source doc byte-for-byte",
      );
    } finally {
      await wt.cleanup();
    }
  },
);

Deno.test(
  "[cutover][integration] with --plan-context-root aimed at the worktree, git status inside the worktree shows no PlanContext entries (judge-clean copy)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const wt = await makeRealWorktree();
    try {
      const outDir = await Deno.makeTempDir({ prefix: "p173-cutover-out-" });
      const run = await runGenerator([CONTEXT_FIXTURE_PATH, "--out-dir", outDir, "--plan-context-root", wt.root]);
      assertEquals(run.code, 0, `generator failed: ${run.stderr}`);

      const porcelain = await new Deno.Command("git", {
        args: ["status", "--porcelain"],
        cwd: wt.root,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(porcelain.success, true);
      assertEquals(new TextDecoder().decode(porcelain.stdout).trim(), "", "worktree status must be spotless");

      // The exclusion was recorded where git actually consults it for this worktree:
      // the SHARED common dir's info/exclude (linked-worktree semantics).
      const dotGitPointer = await Deno.readTextFile(join(wt.root, ".git"));
      const pointerRaw = dotGitPointer.match(/gitdir:\s*(.+)/)![1].trim();
      // The pointer may be relative or absolute — normalize first, THEN strip the
      // per-worktree registry segment (…/.git/worktrees/<name>) down to …/.git.
      const gitDirAbs = pointerRaw.startsWith("/") ? pointerRaw : await Deno.realPath(join(wt.root, pointerRaw));
      const commonDotGit = gitDirAbs.replace(/[\\/]worktrees[\\/][^\\/]+$/, "");
      const exclude = await Deno.readTextFile(join(commonDotGit, "info", "exclude"));
      assertEquals(
        exclude.split("\n").some((l) => l.trim() === "PlanContext/"),
        true,
        "common .git/info/exclude carries the judge-cleanliness entry exactly for this mechanism",
      );
    } finally {
      await wt.cleanup();
    }
  },
);
