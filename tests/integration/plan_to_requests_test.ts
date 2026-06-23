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
import { RequestSchema } from "@exaix/schemas/request.ts";
import { parseFrontmatter } from "./helpers/parse_frontmatter.ts";

const DOGFOOD_META_RE = /> Dogfood metadata — portal: `([^`]+)`; target_branch: `([^`]+)`/;

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const FIXTURES_DIR = join(REPO_ROOT, "tests", "integration", "fixtures");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "plan_to_requests.ts");

async function runGenerator(args: string[]): Promise<{ stdout: string; stderr: string }> {
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
        assertEquals(typeof result.data.identity_id, "string");
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

    // Step 1: explicit portal/target_branch in manifest
    const step1 = await Deno.readTextFile(join(tmpDir, "phase-nn-fixture-step-1.md"));
    const m1 = step1.match(DOGFOOD_META_RE);
    assertExists(m1, "step 1 must have metadata line");
    assertEquals(m1[1], "exaix-self", "step 1 portal from manifest");
    assertEquals(m1[2], "feat/phase-nn-step-1", "step 1 target_branch from manifest");

    // Step 3: no portal/target_branch in manifest → defaults
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
