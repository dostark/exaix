/**
 * @module BuildParsedRequestTest
 * @path packages/request/tests/build_parsed_request_test.ts
 * @description Tests for buildParsedRequest() — validates that IModelIntent fields
 *   from request frontmatter are forwarded to IParsedRequest (GAP-11 fix).
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/request]
 * @related-files [packages/request/src/common.ts]
 */

import { assertEquals } from "@std/assert";
import { buildParsedRequest } from "@exaix/request";
import type { IRequestFrontmatter } from "@exaix/core/request";
import { RequestSource } from "@exaix/core";

function makeFrontmatter(overrides: Partial<IRequestFrontmatter> = {}): IRequestFrontmatter {
  return {
    trace_id: "trace-1",
    created: new Date().toISOString(),
    status: "pending" as const,
    priority: "normal",
    source: RequestSource.CLI,
    created_by: "user",
    ...overrides,
  };
}

Deno.test("[GAP-11] buildParsedRequest forwards model_size from frontmatter", () => {
  const fm = makeFrontmatter({ model_size: "M" });
  const req = buildParsedRequest("test body", fm, "req-1", "trace-1");
  assertEquals(req.model_size, "M");
});

Deno.test("[GAP-11] buildParsedRequest forwards thinking from frontmatter", () => {
  const fm = makeFrontmatter({ thinking: true, effort: "high" });
  const req = buildParsedRequest("test body", fm, "req-2", "trace-2");
  assertEquals(req.thinking, true);
  assertEquals(req.effort, "high");
});

Deno.test("[GAP-11] buildParsedRequest forwards characteristics from frontmatter", () => {
  const fm = makeFrontmatter({ characteristics: ["cheapest", "fastest"] });
  const req = buildParsedRequest("test body", fm, "req-3", "trace-3");
  assertEquals(req.characteristics, ["cheapest", "fastest"]);
});

Deno.test("[GAP-11] buildParsedRequest forwards preferred_provider and model from frontmatter", () => {
  const fm = makeFrontmatter({ preferred_provider: "anthropic", model: "anthropic:claude-sonnet" });
  const req = buildParsedRequest("test body", fm, "req-4", "trace-4");
  assertEquals(req.preferred_provider, "anthropic");
  assertEquals(req.model, "anthropic:claude-sonnet");
});

Deno.test("[GAP-11] buildParsedRequest sets undefined when frontmatter has no IModelIntent fields", () => {
  const fm = makeFrontmatter();
  const req = buildParsedRequest("test body", fm, "req-5", "trace-5");
  assertEquals(req.model_size, undefined);
  assertEquals(req.thinking, undefined);
  assertEquals(req.characteristics, undefined);
});

// ---------------------------------------------------------------------------
// Phase 142 Step 17 — frontmatter inputs that skill resolution depends on.
// `tags` was never copied (IRequestFrontmatter did not even declare it), and
// `skills` only parsed when written as a JSON string, so a hand-authored YAML
// array raised "frontmatter.skills.trim is not a function".
// ---------------------------------------------------------------------------

Deno.test("[step17] buildParsedRequest forwards frontmatter tags for trigger matching", () => {
  const fm = makeFrontmatter({ tags: ["review", "error-handling"] });
  const req = buildParsedRequest("body", fm, "req-1", "trace-1");
  assertEquals(req.tags, ["review", "error-handling"]);
});

Deno.test("[step17] buildParsedRequest accepts skills written as a YAML array", () => {
  const fm = makeFrontmatter({ skills: ["tdd-methodology", "security-first"] });
  const req = buildParsedRequest("body", fm, "req-1", "trace-1");
  assertEquals(req.skills, ["tdd-methodology", "security-first"]);
});

Deno.test("[step17] buildParsedRequest still accepts the CLI's JSON-string skills form", () => {
  const fm = makeFrontmatter({ skills: '["tdd-methodology","security-first"]' });
  const req = buildParsedRequest("body", fm, "req-1", "trace-1");
  assertEquals(req.skills, ["tdd-methodology", "security-first"]);
});

Deno.test("[step17] buildParsedRequest accepts a comma-separated skills string", () => {
  const fm = makeFrontmatter({ skills: "tdd-methodology, security-first" });
  const req = buildParsedRequest("body", fm, "req-1", "trace-1");
  assertEquals(req.skills, ["tdd-methodology", "security-first"]);
});
