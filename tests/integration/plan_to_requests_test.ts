/**
 * @module PlanToRequestsTest
 * @path tests/integration/plan_to_requests_test.ts
 * @description Phase 122 Step 4 — integration tests for plan_to_requests.ts generator.
 *   Validates file generation, frontmatter correctness, dry-run mode, heading-scrape
 *   fallback, error handling, priority clamping for >10-step plans, and dogfood
 *   metadata body line (GAP-13 remediation).
 * @architectural-layer Integration
 * @dependencies [@exaix/schemas, @std/path, @std/assert]
 * @related-files [scripts/plan_to_requests.ts]
 */

import { assertEquals, assertExists, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYamlRaw } from "@std/yaml";
import { parseFrontmatter } from "./helpers/parse_frontmatter.ts";
import { RequestSchema } from "@exaix/schemas/request.ts";
import { BlueprintResolver, RequestProcessor } from "@exaix/request";
import { RequestKind } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";

const noopTraceLogger: IEventLogger = {
  log: () => Promise.resolve(),
  info: () => Promise.resolve(),
  warn: () => Promise.resolve(),
  error: () => Promise.resolve(),
  fatal: () => Promise.resolve(),
  debug: () => Promise.resolve(),
  child: () => noopTraceLogger,
};

const DOGFOOD_META_RE = /> Dogfood metadata — portal: `([^`]+)`; target_branch: `([^`]+)`/;

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const FIXTURES_DIR = join(REPO_ROOT, "tests", "integration", "fixtures");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "plan_to_requests.ts");

async function runGenerator(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      SCRIPT_PATH,
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

Deno.test("[plan-to-requests] generates 3 request files from a 3-step fixture", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-test-" });
  const fixturePath = join(FIXTURES_DIR, "phase-nn-fixture.md");

  try {
    const { stdout, stderr } = await runGenerator([fixturePath, "--out-dir", tmpDir]);
    assertEquals(stderr, "");
    assertMatch(stdout, /Wrote 3 request file/);

    for (const stepNum of [1, 2, 3]) {
      const filePath = join(tmpDir, `phase-nn-fixture-step-${stepNum}.md`);
      const content = await Deno.readTextFile(filePath);
      assertExists(content, `File step-${stepNum}.md must exist`);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-to-requests] each emitted frontmatter passes RequestSchema.parse", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-validate-" });
  const fixturePath = join(FIXTURES_DIR, "phase-nn-fixture.md");

  try {
    const { stderr } = await runGenerator([fixturePath, "--out-dir", tmpDir]);
    assertEquals(stderr, "");

    for (const stepNum of [1, 2, 3]) {
      const filePath = join(tmpDir, `phase-nn-fixture-step-${stepNum}.md`);
      const content = await Deno.readTextFile(filePath);
      const parsed = parseFrontmatter(content);
      assertExists(parsed, `Step ${stepNum} must have frontmatter`);

      const result = RequestSchema.safeParse(parsed);
      assertEquals(result.success, true, `Step ${stepNum} frontmatter must pass RequestSchema`);
      if (result.success) {
        assertEquals(typeof result.data.agent_role, "string");
        assertEquals(result.data.status, "pending");
        assertEquals(typeof result.data.trace_id, "string");
        assertEquals(result.data.priority >= 0 && result.data.priority <= 10, true);
      }
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-to-requests] files named <slug>-step-<N>.md", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-naming-" });
  const fixturePath = join(FIXTURES_DIR, "phase-nn-fixture.md");

  try {
    const { stderr } = await runGenerator([fixturePath, "--out-dir", tmpDir]);
    assertEquals(stderr, "");

    const entries: string[] = [];
    for await (const entry of Deno.readDir(tmpDir)) {
      if (entry.isFile) entries.push(entry.name);
    }

    assertEquals(entries.includes("phase-nn-fixture-step-1.md"), true);
    assertEquals(entries.includes("phase-nn-fixture-step-2.md"), true);
    assertEquals(entries.includes("phase-nn-fixture-step-3.md"), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-to-requests] dry-run prints count without writing", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-dry-" });
  const fixturePath = join(FIXTURES_DIR, "phase-nn-fixture.md");

  try {
    const { stdout, stderr } = await runGenerator([fixturePath, "--out-dir", tmpDir, "--dry-run"]);
    assertEquals(stderr, "");
    assertMatch(stdout, /Would write.*phase-nn-fixture-step/);
    assertMatch(stdout, /agent_role: senior-coder/);
    assertMatch(stdout, /Would write 3 request file/);

    // Verify no files were written
    let fileCount = 0;
    for await (const _entry of Deno.readDir(tmpDir)) {
      fileCount++;
    }
    assertEquals(fileCount, 0, "dry-run must not write files");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-to-requests] missing plan file produces error", async () => {
  const { stderr, stdout } = await runGenerator(["/nonexistent/plan.md", "--dry-run"]);

  // Should contain error message and exit (stderr or stdout captured)
  const output = stdout + stderr;
  const hasError = output.includes("not found") || output.includes("unreadable") || output.includes("Error");
  assertEquals(hasError, true, "must print an error for missing file");
});

Deno.test("[plan-to-requests] empty args produces usage error", async () => {
  const { stdout, stderr } = await runGenerator([]);
  const output = stdout + stderr;
  assertEquals(output.includes("Usage") || output.includes("plan_path"), true, "must print usage for empty args");
});

Deno.test("[plan-to-requests] >10-step plan keeps priorities within 0-10", async () => {
  const planContent = Array.from({ length: 12 }, (_, i) => {
    const stepNum = i + 1;
    return (
      `## Step ${stepNum}\n\n\`\`\`yaml\n# step-manifest\nstep: ${stepNum}\ntitle: "Step ${stepNum}"\n\`\`\`\n\n**Actions:**\n- Do ${stepNum}\n\n**Success Criteria:**\n- [ ] Done ${stepNum}\n`
    );
  }).join("\n");

  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-clamp-" });
  const planPath = join(tmpDir, "phase-12step-plan.md");
  await Deno.writeTextFile(planPath, `# 12-Step Plan\n\n${planContent}`);

  const outDir = join(tmpDir, "out");
  try {
    const { stderr } = await runGenerator([planPath, "--out-dir", outDir]);
    assertEquals(stderr, "");

    for (const stepNum of [1, 6, 10, 11, 12]) {
      const content = await Deno.readTextFile(join(outDir, `phase-12step-plan-step-${stepNum}.md`));
      const frontmatterMatch = content.match(/priority:\s*(\d+)/);
      assertExists(frontmatterMatch, `Step ${stepNum} must have priority`);
      const priority = parseInt(frontmatterMatch[1], 10);
      assertEquals(priority >= 0 && priority <= 10, true, `Step ${stepNum} priority ${priority} must be 0-10`);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-to-requests] heading-scrape fallback produces RequestSchema-valid output", async () => {
  // style-exclude:FIXTURE_READABILITY - Small inline fixture kept for test clarity
  const planContent = `# Plan

## Step 1

**Actions:**
- Do something

**Architecture Notes:**
- Simple

**Planned Tests:**
- Test A

**Success Criteria:**
- [x] Done

## Step 2

**Actions:**
- Do more

**Architecture Notes:**
- Complex

**Planned Tests:**
- Test B

**Success Criteria:**
- [x] Done
`;

  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-scrape-" });
  const planPath = join(tmpDir, "scrape-plan.md");
  await Deno.writeTextFile(planPath, planContent);

  const outDir = join(tmpDir, "out");
  try {
    const { stderr } = await runGenerator([planPath, "--out-dir", outDir]);
    assertEquals(stderr, "");

    // Check files exist and have valid frontmatter
    for (const stepNum of [1, 2]) {
      const content = await Deno.readTextFile(join(outDir, `scrape-plan-step-${stepNum}.md`));
      const parsed = parseFrontmatter(content);
      assertExists(parsed, `Step ${stepNum} must have frontmatter`);

      const result = RequestSchema.safeParse(parsed);
      assertEquals(result.success, true, `Step ${stepNum} heading-scrape must pass RequestSchema`);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-to-requests] duplicate step numbers produce error", async () => {
  const planContent = `# Duplicate Plan

## Step 1

\`\`\`yaml
# step-manifest
step: 1
title: "First"
\`\`\`

**Actions:**
- First

## Step 1

\`\`\`yaml
# step-manifest
step: 1
title: "Duplicate (also step 1)"
\`\`\`

**Actions:**
- Duplicate
`;

  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-dup-" });
  const planPath = join(tmpDir, "dup-plan.md");
  await Deno.writeTextFile(planPath, planContent);

  try {
    const { stdout, stderr } = await runGenerator([planPath, "--dry-run"]);
    const output = stdout + stderr;
    const hasDuplicateError = output.includes("Duplicate") || output.includes("unique");
    assertEquals(hasDuplicateError, true, "must error on duplicate step numbers");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-to-requests] metadata line carries portal and target_branch from manifest", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-meta-" });
  const fixturePath = join(FIXTURES_DIR, "phase-nn-fixture.md");

  try {
    const { stderr } = await runGenerator([fixturePath, "--out-dir", tmpDir]);
    assertEquals(stderr, "");

    // First fixture step: explicit portal/target_branch in manifest
    const step1 = await Deno.readTextFile(join(tmpDir, "phase-nn-fixture-step-1.md"));
    const m1 = step1.match(DOGFOOD_META_RE);
    assertExists(m1, "step 1 must have metadata line");
    assertEquals(m1[1], "exaix-self", "step 1 portal from manifest");
    assertEquals(m1[2], "feat/phase-nn-step-1", "step 1 target_branch from manifest");

    // Third fixture step: no portal/target_branch in manifest → defaults
    const step3 = await Deno.readTextFile(join(tmpDir, "phase-nn-fixture-step-3.md"));
    const m3 = step3.match(DOGFOOD_META_RE);
    assertExists(m3, "step 3 must have metadata line");
    assertEquals(m3[1], "exaix-self", "step 3 portal default");
    assertEquals(m3[2], "feat/phase-nn-fixture-step-3", "step 3 target_branch default derived from slug");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-to-requests] heading-scrape fallback uses default portal and target_branch", async () => {
  // style-exclude:FIXTURE_READABILITY - Small inline fixture kept for test clarity
  const planContent = `# Scrape Only

## Step 1

**Actions:**
- Do something

**Success Criteria:**
- [x] Done

## Step 2

**Actions:**
- Do more

**Success Criteria:**
- [x] Done
`;

  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-scrape-meta-" });
  const planPath = join(tmpDir, "scrape-meta-plan.md");
  await Deno.writeTextFile(planPath, planContent);

  const outDir = join(tmpDir, "out");
  try {
    const { stderr } = await runGenerator([planPath, "--out-dir", outDir]);
    assertEquals(stderr, "");

    for (const stepNum of [1, 2]) {
      const content = await Deno.readTextFile(join(outDir, `scrape-meta-plan-step-${stepNum}.md`));
      const m = content.match(DOGFOOD_META_RE);
      assertExists(m, `step ${stepNum} must have metadata line`);
      assertEquals(m[1], "exaix-self", `step ${stepNum} portal default`);
      assertEquals(m[2], `feat/scrape-meta-plan-step-${stepNum}`, `step ${stepNum} target_branch default`);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

const CONTEXT_FIXTURE_PATH = join(FIXTURES_DIR, "phase-nn-fixture-with-context.md");

Deno.test("[plan-to-requests][context] doc-shaped fixture emits Why This Step Exists with Executive Summary + only shared bullets", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-context-" });
  try {
    const { stdout, stderr } = await runGenerator([CONTEXT_FIXTURE_PATH, "--out-dir", tmpDir]);
    assertEquals(stderr, "");
    assertMatch(stdout, /Wrote 2 request file/);

    // The first generated step shares the scripts/plan_to_requests.ts token with a constraint bullet.
    const step1 = await Deno.readTextFile(join(tmpDir, "phase-nn-fixture-with-context-step-1.md"));
    assertEquals(step1.includes("## Why This Step Exists"), true);
    assertEquals(
      step1.indexOf("## Why This Step Exists") < step1.indexOf("## Actions"),
      true,
      "the why block leads the body, before Actions",
    );
    assertEquals(step1.includes("**The Problem.**"), true, "Executive Summary carried inline");
    assertEquals(step1.includes("outside the bounded summary"), false, "Goal-paragraph bounding holds");
    assertEquals(
      step1.includes("Keep requests concise per `scripts/plan_to_requests.ts` design."),
      true,
      "shared-token constraint bullet included",
    );
    assertEquals(step1.includes("Never expose private submodule trees"), false, "non-matching bullet filtered");
    assertEquals(step1.includes("### Relevant Design Decisions"), false, "no-overlap sub-block omitted");

    // The second generated step overlaps nothing: still gets the summary (always-present why), no bullet lists.
    const step2 = await Deno.readTextFile(join(tmpDir, "phase-nn-fixture-with-context-step-2.md"));
    assertEquals(step2.includes("## Why This Step Exists"), true);
    assertEquals(step2.includes("**The Goal.**"), true);
    assertEquals(step2.includes("### Relevant Constraints"), false);
    assertEquals(step2.includes("### Relevant Design Decisions"), false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-to-requests][context] legacy minimal fixture output unchanged — no Why This Step Exists block", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-context-reg-" });
  try {
    const { stderr } = await runGenerator([join(FIXTURES_DIR, "phase-nn-fixture.md"), "--out-dir", tmpDir]);
    assertEquals(stderr, "");

    for (const stepNum of [1, 2, 3]) {
      const content = await Deno.readTextFile(join(tmpDir, `phase-nn-fixture-step-${stepNum}.md`));
      assertEquals(
        content.includes("## Why This Step Exists"),
        false,
        `step ${stepNum}: docs without an Executive Summary keep legacy output`,
      );
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-to-requests][context] a real repo phase doc yields requests far smaller than the source doc", async () => {
  const realDoc = join(REPO_ROOT, "exaix-dev-docs", "planning", "phase-171-packages-team-submodule-extraction.md");
  // The planning corpus lives in a submodule; absent in bare checkouts → nothing to prove.
  const realDocExists = await Deno.stat(realDoc).then(() => true).catch(() => false);
  if (!realDocExists) {
    console.log("[skip-context-size] exaix-dev-docs submodule content not present");
    return;
  }

  const sourceSize = (await Deno.stat(realDoc)).size;
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-real-doc-" });
  try {
    const { stderr } = await runGenerator([realDoc, "--out-dir", tmpDir]);
    assertEquals(stderr, "");

    let totalRequestBytes = 0;
    let requestCount = 0;
    for await (const entry of Deno.readDir(tmpDir)) {
      if (!entry.isFile) continue;
      totalRequestBytes += (await Deno.stat(join(tmpDir, entry.name))).size;
      requestCount++;
    }
    assertExists(requestCount > 0, "real doc must yield at least one request");

    const avgRequestSize = totalRequestBytes / requestCount;
    // "noticeably shorter than the full phase doc, not a second copy of it" — the
    // per-request body is bounded context + one step's four subsections, so the AVERAGE
    // request must stay well under half of the source doc's size.
    assertEquals(
      avgRequestSize < sourceSize / 2,
      true,
      `average request ${
        Math.round(avgRequestSize)
      }B must stay under half of source ${sourceSize}B — a ballooning why-block would approach a full-doc copy`,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

const PLAN_CONTEXT_POINTER_RE =
  /> Full phase context: `\.exa\x2fPlanContext\x2f([^`]+)\.md` \(read this if the context above isn't enough\)\./;
const CONTEXT_SLUG = "phase-nn-fixture-with-context";

/** Minimal stand-in for a delegate worktree: a directory optionally containing a
 *  `.git/` tree, a pre-seeded `.git/info/exclude`, and a tracked `.gitignore`. */
async function makeFakeWorktree(opts: { withGit: boolean; gitignore?: string }): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "plan-to-req-wt-" });
  if (opts.withGit) {
    await Deno.mkdir(join(root, ".git", "info"), { recursive: true });
  }
  if (opts.gitignore !== undefined) {
    await Deno.writeTextFile(join(root, ".gitignore"), opts.gitignore);
  }
  return root;
}

Deno.test("[plan-to-requests][plan-context] generator copies the phase doc to .exa/PlanContext/<slug>.md under --plan-context-root", async () => {
  const wt = await makeFakeWorktree({ withGit: true });
  try {
    const { code, stderr } = await runGenerator([
      CONTEXT_FIXTURE_PATH,
      "--out-dir",
      join(wt, "Workspace", "Requests"),
      "--plan-context-root",
      wt,
    ]);
    assertEquals(code, 0);
    assertEquals(stderr, "");

    const copied = await Deno.readTextFile(join(wt, ".exa", "PlanContext", `${CONTEXT_SLUG}.md`));
    assertEquals(copied, await Deno.readTextFile(CONTEXT_FIXTURE_PATH), "copy is byte-identical to the source doc");
  } finally {
    await Deno.remove(wt, { recursive: true });
  }
});

Deno.test("[plan-to-requests][plan-context] generated request body references the copied relative path", async () => {
  const wt = await makeFakeWorktree({ withGit: true });
  try {
    const outDir = join(wt, "Workspace", "Requests");
    const { code } = await runGenerator([CONTEXT_FIXTURE_PATH, "--out-dir", outDir, "--plan-context-root", wt]);
    assertEquals(code, 0);

    for (const stepNum of [1, 2]) {
      const request = await Deno.readTextFile(join(outDir, `${CONTEXT_SLUG}-step-${stepNum}.md`));
      assertEquals(request.match(PLAN_CONTEXT_POINTER_RE) !== null, true, `step ${stepNum} must name the path`);
    }
  } finally {
    await Deno.remove(wt, { recursive: true });
  }
});

Deno.test("[plan-to-requests][plan-context][hardened-shape] copy lands inside the plan-context root so containment holds by construction", async () => {
  const wt = await makeFakeWorktree({ withGit: true });
  try {
    const outDir = join(wt, "Workspace", "Requests");
    const { code } = await runGenerator([CONTEXT_FIXTURE_PATH, "--out-dir", outDir, "--plan-context-root", wt]);
    assertEquals(code, 0);

    // The file lives INSIDE the root (OpenCode permitted-path assertion satisfied),
    // and the pointer the request carries is RELATIVE — it resolves from the delegate's
    // cwd (this same root) without any absolute-path dependence.
    const expected = join(wt, ".exa", "PlanContext", `${CONTEXT_SLUG}.md`);
    const stat = await Deno.stat(expected);
    assertEquals(stat.isFile, true);
    const request = await Deno.readTextFile(join(outDir, `${CONTEXT_SLUG}-step-1.md`));
    const m = request.match(PLAN_CONTEXT_POINTER_RE);
    assertExists(m);
    assertEquals(m![1], CONTEXT_SLUG, "pointer must be the bare relative .exa/PlanContext/<slug>.md path");
  } finally {
    await Deno.remove(wt, { recursive: true });
  }
});

Deno.test("[plan-context][relocation] repeated runs leave .git metadata and tracked .gitignore untouched", async () => {
  const GITIGNORE = "dist/\nnode_modules/\n";
  const EXISTING_EXCLUDE = "existing-entry/\n";
  const wt = await makeFakeWorktree({ withGit: true, gitignore: GITIGNORE });
  try {
    const excludePath = join(wt, ".git", "info", "exclude");
    await Deno.writeTextFile(excludePath, EXISTING_EXCLUDE);
    const args = [CONTEXT_FIXTURE_PATH, "--out-dir", join(wt, "Workspace", "Requests"), "--plan-context-root", wt];
    assertEquals((await runGenerator(args)).code, 0);
    assertEquals((await runGenerator(args)).code, 0);

    assertEquals(await Deno.readTextFile(excludePath), EXISTING_EXCLUDE, ".git metadata must remain byte-identical");
    assertEquals(await Deno.readTextFile(join(wt, ".gitignore")), GITIGNORE, "tracked ignore file untouched");
    const copied = join(wt, ".exa", "PlanContext", `${CONTEXT_SLUG}.md`);
    assertEquals((await Deno.stat(copied)).isFile, true, "copy must exist after every sampled run");
  } finally {
    await Deno.remove(wt, { recursive: true });
  }
});

Deno.test("[plan-to-requests][plan-context] --no-copy-doc skips the copy and the pointer line", async () => {
  const wt = await makeFakeWorktree({ withGit: true });
  try {
    const outDir = join(wt, "Workspace", "Requests");
    const { code } = await runGenerator([
      CONTEXT_FIXTURE_PATH,
      "--out-dir",
      outDir,
      "--plan-context-root",
      wt,
      "--no-copy-doc",
    ]);
    assertEquals(code, 0);

    let threwNotFound = false;
    try {
      await Deno.stat(join(wt, ".exa", "PlanContext"));
    } catch {
      threwNotFound = true;
    }
    assertEquals(threwNotFound, true, "no PlanContext dir may be created");

    const request = await Deno.readTextFile(join(outDir, `${CONTEXT_SLUG}-step-1.md`));
    assertEquals(request.match(PLAN_CONTEXT_POINTER_RE), null, "no pointer line either");

    let excludeMissing = false;
    try {
      await Deno.readTextFile(join(wt, ".git", "info", "exclude"));
    } catch {
      excludeMissing = true;
    }
    assertEquals(excludeMissing, true, "exclude must not be touched when nothing is copied");
  } finally {
    await Deno.remove(wt, { recursive: true });
  }
});

Deno.test("[plan-to-requests][plan-context][regression] without --plan-context-root output equals --no-copy-doc mode", async () => {
  const wtA = await makeFakeWorktree({ withGit: false });
  const wtB = await makeFakeWorktree({ withGit: false });
  try {
    const base = [CONTEXT_FIXTURE_PATH];
    const plain = join(wtA, "Workspace", "Requests");
    const noCopy = join(wtB, "Workspace", "Requests");
    assertEquals((await runGenerator([...base, "--out-dir", plain])).code, 0);
    assertEquals(
      (await runGenerator([...base, "--out-dir", noCopy, "--plan-context-root", wtB, "--no-copy-doc"])).code,
      0,
    );

    // Frontmatter carries a per-run random trace_id, so compare request BODIES:
    // omitting the flag must produce the same markdown as explicit opt-out.
    const bodyOf = (md: string): string => md.slice(md.indexOf("\n---\n") + 5);
    for (const stepNum of [1, 2]) {
      const a = await Deno.readTextFile(join(plain, `${CONTEXT_SLUG}-step-${stepNum}.md`));
      const b = await Deno.readTextFile(join(noCopy, `${CONTEXT_SLUG}-step-${stepNum}.md`));
      assertEquals(bodyOf(a), bodyOf(b), `step ${stepNum}: omitting the flag must match explicit opt-out`);
      assertEquals(a.match(PLAN_CONTEXT_POINTER_RE), null);
      assertEquals(a.includes(".exa/PlanContext/"), false);
    }
  } finally {
    await Deno.remove(wtA, { recursive: true });
    await Deno.remove(wtB, { recursive: true });
  }
});

Deno.test("[plan-to-requests][plan-context][security] a '..'-laden plan slug is rejected and nothing is written", async () => {
  const wt = await makeFakeWorktree({ withGit: true });
  try {
    // The slug derives from the plan filename; ".." inside it simulates traversal input.
    const evilDoc = join(await Deno.makeTempDir({ prefix: "evil-src-" }), "phase..evil.md");
    await Deno.writeTextFile(
      evilDoc,
      "# Evil\n\n## Step 1\n\n**Actions:**\n- x\n\n```yaml\n# step-manifest\nstep: 1\ntitle: t\n```\n",
    );

    const { code, stdout, stderr } = await runGenerator([
      evilDoc,
      "--out-dir",
      join(wt, "Workspace", "Requests"),
      "--plan-context-root",
      wt,
    ]);
    assertEquals(code !== 0, true, "must exit non-zero on an unsafe slug");
    assertEquals(
      (stdout + stderr).includes("phase..evil"),
      true,
      "the error must name the rejected slug (rejection-by-validation, not a silent skip)",
    );

    let planContextAbsent = false;
    try {
      await Deno.stat(join(wt, ".exa", "PlanContext"));
    } catch {
      planContextAbsent = true;
    }
    assertEquals(planContextAbsent, true, "nothing may be written into the sandbox on rejection");
  } finally {
    await Deno.remove(wt, { recursive: true });
  }
});

// Phase 173 Step 5 remediation - admission contract (GAP-1)

const REPO_ROOT_ADM = join(import.meta.dirname!, "..", "..");
const FM_SLICE_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

/** Production-split mechanics (mirrors exactl handler's splitFileFrontmatter and the
 *  watcher-shared `---` slice: raw parseYaml cast to IRequestFrontmatter, NO read-time
 *  schema validation) applied to a generated request file. */
function productionFrontmatterOf(generatedFile: string): Record<string, unknown> {
  const content = Deno.readTextFileSync(generatedFile); // tests may sync-read for slicing parity
  const fmSlice = content.match(FM_SLICE_RE);
  assertExists(fmSlice, "generated file must carry frontmatter");
  return parseYamlRaw(fmSlice[1]) as Record<string, unknown>;
}

/** Drives the REAL RequestProcessor.getRequestKindOrFail branch logic via prototype
 *  binding with only the failure-path collaborator stubbed — the consumer-contract
 *  oracle whose absence let GAP-1 hide behind writer-side schema greens. */
async function admissionKindOf(frontmatter: Record<string, unknown>): Promise<RequestKind | null> {
  const proc = Object.create(RequestProcessor.prototype) as {
    statusManager: unknown;
  };
  proc.statusManager = { updateStatus: async () => {} };
  const kind = await (proc as never as {
    getRequestKindOrFail(args: {
      frontmatter: Record<string, unknown>;
      filePath: string;
      traceLogger: IEventLogger;
    }): Promise<RequestKind | null>;
  }).getRequestKindOrFail({
    frontmatter,
    filePath: "generated-dogfood-request.md",
    traceLogger: noopTraceLogger,
  });
  return kind;
}

Deno.test("[plan-context][admission] generated frontmatter carries ONLY agent_role (legacy duplicate key must not return)", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-admit-" });
  try {
    assertEquals((await runGenerator([CONTEXT_FIXTURE_PATH, "--out-dir", tmpDir])).code, 0);
    const file = join(tmpDir, `${CONTEXT_SLUG}-step-1.md`);
    const fm = productionFrontmatterOf(file);
    assertEquals(fm.agent_role, "senior-coder");
    assertEquals(fm.identity, undefined, "GAP-1 root fix: legacy identity key must not coexist with agent_role");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-context][admission] consumer contract: real getRequestKindOrFail returns IDENTITY for generated output", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-admit-kind-" });
  try {
    assertEquals((await runGenerator([CONTEXT_FIXTURE_PATH, "--out-dir", tmpDir])).code, 0);
    const file = join(tmpDir, `${CONTEXT_SLUG}-step-1.md`);
    const fm = productionFrontmatterOf(file);
    const kind = await admissionKindOf(fm);
    assertEquals(
      kind,
      RequestKind.IDENTITY,
      "generated requests must be admitted as identity-kind, not marked FAILED for missing agent field",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-context][admission] manifest identity resolves to a loadable blueprint file", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-admit-bp-" });
  try {
    assertEquals((await runGenerator([CONTEXT_FIXTURE_PATH, "--out-dir", tmpDir])).code, 0);
    const file = join(tmpDir, `${CONTEXT_SLUG}-step-1.md`);
    const fm = productionFrontmatterOf(file);
    assertExists(fm.agent_role, "agent_role must exist before blueprint resolution can be meaningful");
    // Drive the SAME resolver class RequestProcessor admission instantiates.
    const resolver = new BlueprintResolver({ blueprintsPath: join(REPO_ROOT_ADM, "Blueprints") });
    const loaded = await resolver.resolve(String(fm.agent_role), noopTraceLogger);
    assertExists(
      loaded,
      `blueprint '${fm.agent_role}' must load - BlueprintNotFound guard not reachable from generator output`,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[regression][admission] strict RequestSchema accepts canonical generator output", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-admit-schema-" });
  try {
    assertEquals((await runGenerator([CONTEXT_FIXTURE_PATH, "--out-dir", tmpDir])).code, 0);
    const file = join(tmpDir, `${CONTEXT_SLUG}-step-1.md`);
    const fm = productionFrontmatterOf(file);
    assertEquals(RequestSchema.safeParse(fm).success, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-context][relocation][security] pre-existing symlinked PlanContext file is refused", async () => {
  const wt = await makeFakeWorktree({ withGit: false });
  const outside = await Deno.makeTempDir({ prefix: "plan-context-outside-" });
  try {
    const destDir = join(wt, ".exa", "PlanContext");
    const OUTSIDE_SENTINEL = "must remain untouched";
    const outsideTarget = join(outside, "captured-plan.md");
    await Deno.mkdir(destDir, { recursive: true });
    await Deno.writeTextFile(outsideTarget, OUTSIDE_SENTINEL);
    await Deno.symlink(outsideTarget, join(destDir, `${CONTEXT_SLUG}.md`));

    const result = await runGenerator([
      CONTEXT_FIXTURE_PATH,
      "--out-dir",
      join(wt, "Workspace", "Requests"),
      "--plan-context-root",
      wt,
    ]);

    assertEquals(result.code !== 0, true, "symlinked destination must fail closed");
    assertEquals(
      (result.stdout + result.stderr).toLowerCase().includes("symbolic link"),
      true,
      "failure must identify the rejected symbolic link",
    );
    assertEquals(await Deno.readTextFile(outsideTarget), OUTSIDE_SENTINEL, "symlink target must remain untouched");
  } finally {
    await Deno.remove(wt, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

// Phase 174 Step 2 — plan_context_ref frontmatter provenance

Deno.test("[plan-to-requests][plan-context] frontmatter carries plan_context_ref only when a copy occurred", async () => {
  const wt = await makeFakeWorktree({ withGit: true });
  try {
    const outDir = join(wt, "Workspace", "Requests");
    const { code } = await runGenerator([CONTEXT_FIXTURE_PATH, "--out-dir", outDir, "--plan-context-root", wt]);
    assertEquals(code, 0);

    const request = await Deno.readTextFile(join(outDir, `${CONTEXT_SLUG}-step-1.md`));
    const fm = productionFrontmatterOf(join(outDir, `${CONTEXT_SLUG}-step-1.md`));
    assertEquals(fm.plan_context_ref, `.exa/PlanContext/${CONTEXT_SLUG}.md`);
    assertEquals(RequestSchema.safeParse(fm).success, true, "stamped frontmatter must still pass RequestSchema");
    assertEquals(request.includes("plan_context_ref"), true);
  } finally {
    await Deno.remove(wt, { recursive: true });
  }
});

Deno.test("[regression][plan-context] default output (no --plan-context-root) has no plan_context_ref field", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "plan-to-req-no-ref-" });
  try {
    assertEquals((await runGenerator([join(FIXTURES_DIR, "phase-nn-fixture.md"), "--out-dir", tmpDir])).code, 0);
    for (const stepNum of [1, 2, 3]) {
      const content = await Deno.readTextFile(join(tmpDir, `phase-nn-fixture-step-${stepNum}.md`));
      assertEquals(content.includes("plan_context_ref"), false, `step ${stepNum} must omit plan_context_ref`);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[plan-context][metrics] treatment request stays within 3x stripped control across repeated runs", async () => {
  const MAX_TREATMENT_TO_CONTROL_RATIO = 3;
  const wt = await makeFakeWorktree({ withGit: false });
  try {
    const outDir = join(wt, "Workspace", "Requests");
    const args = [CONTEXT_FIXTURE_PATH, "--out-dir", outDir, "--plan-context-root", wt];
    for (const runNumber of [1, 2]) {
      assertEquals((await runGenerator(args)).code, 0, `run ${runNumber} must succeed`);
      const copied = join(wt, ".exa", "PlanContext", `${CONTEXT_SLUG}.md`);
      assertEquals((await Deno.stat(copied)).isFile, true, `run ${runNumber} must retain the copy`);
    }

    const request = await Deno.readTextFile(join(outDir, `${CONTEXT_SLUG}-step-1.md`));
    const whyStart = request.indexOf("## Why This Step Exists");
    const actionsStart = request.indexOf("## Actions");
    assertEquals(whyStart >= 0 && actionsStart > whyStart, true);
    const withoutWhy = request.slice(0, whyStart) + request.slice(actionsStart);
    const strippedControl = withoutWhy.replace(/\n> Full phase context:[^\n]+\n/, "\n");
    assertEquals(
      request.length <= MAX_TREATMENT_TO_CONTROL_RATIO * strippedControl.length,
      true,
      `treatment ${request.length}B must stay within ${MAX_TREATMENT_TO_CONTROL_RATIO}x control ${strippedControl.length}B`,
    );
  } finally {
    await Deno.remove(wt, { recursive: true });
  }
});
