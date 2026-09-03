/**
 * @module MetaWorkflowQueuePipelineTest
 * @path tests/integration/meta_workflow_queue_pipeline_test.ts
 * @description Phase 150 Step 5 — CI token-free variant of the meta-workflow queue
 *   pipeline. Validates that plan_to_requests.ts generates correct queue entries from
 *   a plan with step manifests: identities resolve, depends_on ordering is consistent,
 *   and each request carries content suitable for a non-empty brief objective.
 */
import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { IBlueprintLoader } from "@exaix/core/blueprint";
import { isContentlessBrief } from "@exaix/core/planning";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPTS_PATH = join(REPO_ROOT, "scripts", "plan_to_requests.ts");
const AGENTS_PATH = join(REPO_ROOT, "Blueprints", "Agents");

const MINIMAL_PLAN = join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "meta_workflow_minimal_plan.md",
);

function cleanTempDir(): string {
  const dir = Deno.makeTempDirSync({ prefix: "meta-workflow-queue-" });
  return dir;
}

async function generateQueue(
  planPath: string,
  outDir: string,
): Promise<string[]> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", SCRIPTS_PATH, planPath, "--out-dir", outDir],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  assertEquals(output.stderr.length, 0, new TextDecoder().decode(output.stderr));
  const stdout = new TextDecoder().decode(output.stdout);
  assertStringIncludes(stdout, "Wrote");

  const files: string[] = [];
  for await (const entry of Deno.readDir(outDir)) {
    if (entry.name.endsWith(".md")) {
      files.push(join(outDir, entry.name));
    }
  }
  files.sort();
  return files;
}

interface IRequestFrontmatter {
  identity_id?: string;
  title?: string;
  tags?: string[];
  trace_id?: string;
}

function parseRequestFrontmatter(filePath: string): IRequestFrontmatter {
  const content = Deno.readTextFileSync(filePath);
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  return parseYaml(match[1]) as IRequestFrontmatter;
}

// `plan_to_requests.ts` emits `depends_on` into the request BODY (not the frontmatter) —
// see the `bodyLines` assembly in that script. Reading it off the frontmatter yields
// `undefined` for every request and silently asserts nothing.
function parseDependsOn(filePath: string): number[] {
  const content = Deno.readTextFileSync(filePath);
  const match = content.match(/^depends_on:\s*(\[[^\]]*\])\s*$/m);
  if (!match) return [];
  return JSON.parse(match[1]) as number[];
}

/** Step number from the authoritative `step-N` tag, not from the file path. */
function stepNumberOf(fm: IRequestFrontmatter): number | undefined {
  for (const tag of fm.tags ?? []) {
    const match = tag.match(/^step-(\d+)$/);
    if (match) return Number.parseInt(match[1], 10);
  }
  return undefined;
}

Deno.test("[meta-workflow-queue] plan_to_requests generates queue with correct identity resolution", async () => {
  const tmpDir = cleanTempDir();
  try {
    const files = await generateQueue(MINIMAL_PLAN, tmpDir);
    assert(files.length >= 2, `expected at least 2 requests from minimal plan, got ${files.length}`);

    const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });

    for (const file of files) {
      const fm = parseRequestFrontmatter(file);
      assertExists(fm.identity_id, `request ${file} is missing identity_id`);
      const blueprint = await loader.load(fm.identity_id!);
      assertExists(blueprint, `identity '${fm.identity_id}' from ${file} must resolve through IBlueprintLoader`);
      assertEquals(blueprint.identityId, fm.identity_id, `identity_id mismatch`);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[meta-workflow-queue] generated requests carry non-empty content for brief objective", async () => {
  const tmpDir = cleanTempDir();
  try {
    const files = await generateQueue(MINIMAL_PLAN, tmpDir);

    for (const file of files) {
      const content = Deno.readTextFileSync(file);
      // Content after frontmatter — this is what becomes the request body / brief objective
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1].trim() : "";
      assert(
        body.length > 0,
        `request ${file} must have non-empty body content for brief objective`,
      );
      // Bind to the production guard rather than re-implementing its pattern: this is the
      // exact predicate the daemon's onCodeChangesDelegate applies before prepareBrief, so a
      // generated request that passes here would survive the contentless-brief check.
      assert(
        !isContentlessBrief(body),
        `request ${file} body must not be a contentless/placeholder objective — got "${body.slice(0, 80)}"`,
      );
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[meta-workflow-queue] every plan step reaches the queue", async () => {
  const tmpDir = cleanTempDir();
  try {
    const files = await generateQueue(MINIMAL_PLAN, tmpDir);
    const planText = Deno.readTextFileSync(MINIMAL_PLAN);
    const planSteps = [...planText.matchAll(/^#{2,3}\s+Step\s+(\d+)/gm)]
      .map((m) => Number.parseInt(m[1], 10));
    assert(planSteps.length > 0, "fixture must declare at least one step");

    const queued = files
      .map((file) => stepNumberOf(parseRequestFrontmatter(file)))
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b);

    assertEquals(
      queued,
      planSteps.sort((a, b) => a - b),
      "every step in the plan must produce a request — a dropped step leaves the queue with a dangling dependency",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("[meta-workflow-queue] depends_on chain is consistent and acyclic", async () => {
  const tmpDir = cleanTempDir();
  try {
    const files = await generateQueue(MINIMAL_PLAN, tmpDir);
    assert(files.length >= 2, `expected at least 2 requests, got ${files.length}`);

    const requests = files.map((file) => ({
      file,
      step: stepNumberOf(parseRequestFrontmatter(file)),
      dependsOn: parseDependsOn(file),
    }));

    const queuedSteps = new Set<number>();
    for (const { file, step } of requests) {
      assertExists(step, `request ${file} must carry a step-N tag`);
      queuedSteps.add(step);
    }

    const head = Math.min(...queuedSteps);
    for (const { file, step, dependsOn } of requests) {
      // Only the head of the chain may declare no dependency; every other request must.
      if (step !== head) {
        assert(
          dependsOn.length > 0,
          `request ${file} (step ${step}) must declare a non-empty depends_on`,
        );
      }

      // Existence and ordering hold for every declared dependency, head included —
      // a dependency on a step that never reached the queue is a broken chain.
      for (const dep of dependsOn) {
        assert(
          queuedSteps.has(dep),
          `request ${file} depends on step ${dep}, which is not in the queue ` +
            `(queued: ${[...queuedSteps].sort((a, b) => a - b).join(", ")})`,
        );
        assert(
          dep < step!,
          `request ${file} (step ${step}) depends on step ${dep}, which is not earlier — the chain must be acyclic`,
        );
      }
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
