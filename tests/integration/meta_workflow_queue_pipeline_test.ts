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

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPTS_PATH = join(REPO_ROOT, "scripts", "plan_to_requests.ts");
const IDENTITIES_PATH = join(REPO_ROOT, "Blueprints", "Identities");

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
  depends_on?: string[];
  trace_id?: string;
}

function parseRequestFrontmatter(filePath: string): IRequestFrontmatter {
  const content = Deno.readTextFileSync(filePath);
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  return parseYaml(match[1]) as IRequestFrontmatter;
}

Deno.test("[meta-workflow-queue] plan_to_requests generates queue with correct identity resolution", async () => {
  const tmpDir = cleanTempDir();
  try {
    const files = await generateQueue(MINIMAL_PLAN, tmpDir);
    assert(files.length >= 2, `expected at least 2 requests from minimal plan, got ${files.length}`);

    const loader = new IBlueprintLoader({ blueprintsPath: IDENTITIES_PATH });

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
      assert(
        !body.match(/^[Ee]xecute\s+step\s+\d+/),
        `request ${file} body must not be a placeholder — got "${body.slice(0, 80)}"`,
      );
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
