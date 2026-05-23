/**
 * @module RequestCommonTest
 * @path packages/request/tests/request_common_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description Verifies shared request processing utilities, ensuring stable blueprint
 * loading logic, path resolution for agents, and basic state initialization.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { buildParsedRequest, loadBlueprint } from "@exaix/request";
import type { IRequestFrontmatter } from "@exaix/core/request";
Deno.test("loadBlueprint: returns null when blueprint does not exist", async () => {
  const dir = await Deno.makeTempDir();
  const out = await loadBlueprint(dir, "missing");
  assertEquals(out, null);
});

Deno.test("loadBlueprint: reads blueprint when present", async () => {
  const dir = await Deno.makeTempDir();
  const identityId = "agent";
  const path = join(dir, `${identityId}.md`);
  await Deno.writeTextFile(path, "prompt");

  const out = await loadBlueprint(dir, identityId);
  assertEquals(out?.identityId, identityId);
  assertEquals(out?.systemPrompt, "prompt");
});

Deno.test("loadBlueprint: returns null on read error", async () => {
  const dir = await Deno.makeTempDir();
  const identityId = "agent";
  const path = join(dir, `${identityId}.md`);
  // Create a directory with the same name as the file to cause a read error
  await Deno.mkdir(path);

  const out = await loadBlueprint(dir, identityId);
  assertEquals(out, null);
});

Deno.test("buildParsedRequest: trims body and parses skills", () => {
  const frontmatter: IRequestFrontmatter = {
    trace_id: "t1",
    created: new Date().toISOString(),
    status: "pending",
    priority: "p1",
    source: "src",
    created_by: "user",
    skills: '["a","b"]',
  };

  const req = buildParsedRequest(
    "  hello \n",
    frontmatter,
    "req",
    "trace",
  );

  assertEquals(req.userPrompt, "hello");
  assertEquals(req.context.priority, "p1");
  assertEquals(req.context.source, "src");
  assertEquals(req.requestId, "req");
  assertEquals(req.traceId, "trace");
  assertEquals(req.skills, ["a", "b"]);
});
