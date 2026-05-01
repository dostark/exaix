/**
 * @module GoogleEnhancementsTest
 * @path tests/agents/google_enhancements_test.ts
 * @description Verifies specialized documentation for Google Gemini agents,
 * ensuring correct frontmatter schemas and long-context optimization sections.
 */

import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/yaml";
import { join } from "@std/path";
import { getDefaultPaths } from "@exaix/core/config/paths.ts";
import type { JSONObject } from "@exaix/core/types/json.ts";

const paths = getDefaultPaths(".");
const providersDir = join(paths.blueprints, "../.copilot/providers");
const promptsDir = join(paths.blueprints, "../.copilot/prompts");

Deno.test("Google enhancements: verify sections in google.md", async () => {
  const content = await Deno.readTextFile(join(providersDir, "google.md"));
  assert(content.includes("Key points"));
  assert(content.includes("Canonical prompt (short):"));
  assert(content.includes("Examples"));
  assert(content.includes("Do / Don't"));
});

Deno.test("Google enhancements: verify sections in google-long-context.md", async () => {
  const content = await Deno.readTextFile(join(providersDir, "google-long-context.md"));
  assert(content.includes("Key points"));
  assert(content.includes("Canonical prompt (short):"));
  assert(content.includes("Examples"));
  assert(content.includes("Do / Don't"));
});

Deno.test("Google enhancements: verify frontmatter schema", async () => {
  for (const relPath of ["google.md", "google-long-context.md"]) {
    const content = await Deno.readTextFile(join(providersDir, relPath));
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assert(fmMatch, `Frontmatter not found in ${relPath}`);

    const fm = parse(fmMatch[1]) as JSONObject;
    assertEquals(fm.identity, "google");
    assertEquals(fm.scope, "dev");
    assert(fm.short_summary);
    assert((fm.short_summary as string).length <= 200, `Short summary too long in ${relPath}`);
  }
});

Deno.test("Google enhancements: verify prompt templates", async () => {
  for (const relPath of ["google-quickstart.md", "google-tdd-workflow.md"]) {
    const content = await Deno.readTextFile(join(promptsDir, relPath));
    assert(content.includes("identity: google"), `Agent tag missing in ${relPath}`);
    assert(content.includes("Key points"), `Key points missing in ${relPath}`);
    assert(content.includes("Canonical prompt (short):"), `Canonical prompt missing in ${relPath}`);
    assert(content.includes("Examples"), `Examples missing in ${relPath}`);
  }
});
