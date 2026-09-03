/**
 * @module RequestCreateFromFileFrontmatterTest
 * @path apps/exactl/tests/request_create_from_file_frontmatter_test.ts
 * @description Phase 142 Step 17F — `exactl request --file` must honour frontmatter the
 *   submitted file already carries.
 *
 *   `createFromFile` read the file whole and handed it to `create()` as the free-text
 *   description, which wraps it in a NEWLY generated frontmatter block. Any frontmatter the
 *   file carried therefore ended up as literal text inside the request BODY, below a
 *   `# Request` heading — so `skills:`, `tags:`, `agent_role:` and the rest were silently
 *   dropped on every file submission. That is why the whole skill_eval pack resolved
 *   `pinned_skill_ids: []` under the default identity no matter what its fixtures pinned:
 *   the pins never reached the request file the daemon parsed.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/handlers/request_create_handler.ts, packages/request/src/common.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { assert } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { RequestCommands } from "../src/commands/request_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

/** The created request file's frontmatter fields these tests assert on. */
interface ICreatedFrontmatter {
  identity_id?: string;
  priority?: string;
  /** The CLI writes these JSON-encoded; unquoted JSON is also valid YAML, so a reader
   * may see either the raw string or an already-parsed array. */
  skills?: string[] | string;
  tags?: string[] | string;
  subject?: string;
  model?: string;
}

/** Read a list field back regardless of which of the two shapes YAML produced. */
function asList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? JSON.parse(value) as string[] : [];
}

function splitFrontmatter(content: string): { frontmatter: ICreatedFrontmatter; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  assert(match, "created request file must start with a frontmatter block");
  return { frontmatter: parseYaml(match[1]) as ICreatedFrontmatter, body: match[2] ?? "" };
}

describe("request --file honours the submitted file's own frontmatter", () => {
  let tempDir: string;
  let requestCommands: RequestCommands;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await createCliTestContext({ createDirs: ["Workspace/Requests"] });
    tempDir = result.tempDir;
    cleanup = result.cleanup;
    requestCommands = new RequestCommands(result.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  async function submit(fixture: string): Promise<{ frontmatter: ICreatedFrontmatter; body: string }> {
    const inputFile = join(tempDir, "input.md");
    await Deno.writeTextFile(inputFile, fixture);
    const result = await requestCommands.createFromFile(inputFile);
    assert(result.path, "created request must report a path");
    return splitFrontmatter(await Deno.readTextFile(result.path));
  }

  // style-exclude:SMALL_FIXTURE_OK - the frontmatter/body split IS the subject of the test
  const PINNED = `---
trace_id: "fixture-trace"
status: "pending"
priority: "high"
agent_role: "senior-coder"
skills: [tdd-methodology, security-first]
tags: [review, quality]
---

# Skill Batch

Evaluate the pinned skills.
`;

  it("carries skills: through to the created request's frontmatter", async () => {
    const { frontmatter } = await submit(PINNED);
    assertEquals(asList(frontmatter.skills), ["tdd-methodology", "security-first"]);
  });

  it("carries tags: through — the trigger matcher scores against them", async () => {
    const { frontmatter } = await submit(PINNED);
    assertEquals(asList(frontmatter.tags), ["review", "quality"]);
  });

  it("carries agent_role: and priority: through", async () => {
    const { frontmatter } = await submit(PINNED);
    assertEquals(frontmatter.identity_id, "senior-coder");
    assertEquals(frontmatter.priority, "high");
  });

  it("leaves the file's frontmatter out of the request body", async () => {
    // The regression: the raw YAML was pasted into the body, so the daemon parsed the
    // CLI's wrapper frontmatter and treated the real one as prose.
    const { body } = await submit(PINNED);
    assertEquals(body.includes("trace_id:"), false, "body must not contain the file's raw frontmatter");
    assertEquals(body.includes("skills: ["), false);
    assertStringIncludes(body, "Evaluate the pinned skills.");
  });

  it("mints a fresh trace_id rather than reusing the file's", async () => {
    // Two submissions of the same fixture are two distinct requests; a reused trace_id
    // would collide in the journal.
    const first = await submit(PINNED);
    const second = await submit(PINNED);
    const firstTrace = (first.frontmatter as { trace_id?: string }).trace_id;
    const secondTrace = (second.frontmatter as { trace_id?: string }).trace_id;
    assert(firstTrace && secondTrace && firstTrace !== secondTrace, "each submission gets its own trace_id");
    assertEquals(firstTrace, firstTrace?.trim());
    assertEquals(firstTrace === "fixture-trace", false);
  });

  it("lets an explicit CLI flag win over the file's frontmatter", async () => {
    const inputFile = join(tempDir, "input.md");
    await Deno.writeTextFile(inputFile, PINNED);
    const result = await requestCommands.createFromFile(inputFile, { agent_role: "researcher" });
    assert(result.path);
    const { frontmatter } = splitFrontmatter(await Deno.readTextFile(result.path));
    assertEquals(frontmatter.identity_id, "researcher", "the flag stated at invocation is the more explicit intent");
  });

  it("accepts a file whose frontmatter declares a flow, without an identity conflict", async () => {
    // A flow declared in file frontmatter bypasses the CLI's flow/identity exclusion guard
    // (that guard only fires on the `--flow` flag), so it must not conflict with the
    // default identity that options.identity always carries.
    await Deno.mkdir(join(tempDir, "Blueprints", "Flows"), { recursive: true });
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Flows", "api-design.flow.yaml"), "id: api-design\n");

    const inputFile = join(tempDir, "flow.md");
    await Deno.writeTextFile(
      inputFile,
      '---\ntrace_id: "flow-trace"\nstatus: "pending"\nflow: "api-design"\n---\n\nExecute the flow.\n',
    );

    const result = await requestCommands.createFromFile(inputFile, { agent_role: "default" });
    assert(result.path, "a flow request submitted by file must be created");
    const { frontmatter } = splitFrontmatter(await Deno.readTextFile(result.path));
    assertEquals((frontmatter as { flow?: string }).flow, "api-design", "the flow must reach the request file");
  });

  it("omits identity from a flow request's frontmatter, which the daemon requires", async () => {
    // A flow request's frontmatter must omit `identity` entirely: `create()` always
    // populates `agent` from options.identity as a fallback, but the daemon rejects
    // any request carrying both `flow` and `agent`/`identity` fields.
    await Deno.mkdir(join(tempDir, "Blueprints", "Flows"), { recursive: true });
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Flows", "api-design.flow.yaml"), "id: api-design\n");

    const inputFile = join(tempDir, "flow2.md");
    await Deno.writeTextFile(
      inputFile,
      '---\ntrace_id: "flow-trace-2"\nstatus: "pending"\nflow: "api-design"\n---\n\nExecute the flow.\n',
    );

    const result = await requestCommands.createFromFile(inputFile, { agent_role: "default" });
    assert(result.path);
    const { frontmatter } = splitFrontmatter(await Deno.readTextFile(result.path));

    assertEquals((frontmatter as { flow?: string }).flow, "api-design");
    assertEquals(frontmatter.identity_id, undefined, "a flow request must carry no identity");
  });

  it("still accepts a plain file with no frontmatter at all", async () => {
    const { body } = await submit("Implement feature from file");
    assertStringIncludes(body, "Implement feature from file");
  });
});
