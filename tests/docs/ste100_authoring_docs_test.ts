/**
 * @module Ste100AuthoringDocsTest
 * @path tests/docs/ste100_authoring_docs_test.ts
 * @description Verifies the Phase 195 documentation deliverables: the STE authoring rule
 * and its documentation exception live in the contributor documentation, the User Guide
 * documents the externally visible communication requirement and its limits, the comment
 * checker companion doc states the checker's limits and the manual migration process, and
 * the scenario-framework README points at the authoring gate tasks.
 */

import { assert, assertStringIncludes } from "@std/assert";

const CONTRIBUTING_PATH = "CONTRIBUTING.md";
const USER_GUIDE_PATH = "docs/Exaix_User_Guide.md";
const COMMENTS_DOC_PATH = "scripts/check_ste100_comments.md";
const SCENARIO_README_PATH = "tests/scenario_framework/README.md";
const BLUEPRINTS_SKILLS_README_PATH = "Blueprints/Skills/README.md";
const DENO_JSON_PATH = "deno.json";
const DOT_COPILOT_README_PATH = ".copilot/README.md";
const BUILDING_WITH_AI_AGENTS_PATH = "exaix-dev-docs/dev/Building_with_AI_Agents.md";

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

Deno.test("CONTRIBUTING states the STE requirement and its documentation exception", async () => {
  const contributing = await read(CONTRIBUTING_PATH);
  assertStringIncludes(contributing, "ASD-STE100");
  assertStringIncludes(contributing, "Exaix STE Extension");
  assertStringIncludes(contributing, "documentation");
  assert(
    /exempt/.test(contributing),
    "CONTRIBUTING must state that documentation deliverables are exempt",
  );
});

Deno.test("CONTRIBUTING names the two authoring gate tasks", async () => {
  const contributing = await read(CONTRIBUTING_PATH);
  assertStringIncludes(contributing, "check:agent-prose");
  assertStringIncludes(contributing, "check:ste100-comments");
});

Deno.test("User Guide documents the communication requirement", async () => {
  const guide = await read(USER_GUIDE_PATH);
  const lower = guide.toLowerCase();
  assert(
    lower.includes("asd-ste100") || lower.includes("ste100") || lower.includes("communication requirement"),
    "User Guide must document the communication requirement",
  );
});

Deno.test("User Guide states token savings are not guaranteed", async () => {
  const guide = await read(USER_GUIDE_PATH);
  const lower = guide.toLowerCase();
  assert(
    lower.includes("not guaranteed") && lower.includes("token"),
    "User Guide must state that token savings are not guaranteed by the instruction",
  );
});

Deno.test("Comment checker companion doc documents its limits", async () => {
  const doc = await read(COMMENTS_DOC_PATH);
  const lower = doc.toLowerCase();
  assertStringIncludes(doc, "## Limits");
  assert(
    lower.includes("deterministic") && lower.includes("semantic") && lower.includes("review"),
    "Comment checker companion doc must state its deterministic/semantic/review limits",
  );
});

Deno.test("Comment checker doc documents the manual migration process", async () => {
  const doc = await read(COMMENTS_DOC_PATH);
  assert(
    /manual migration|grandfather|migration/i.test(doc),
    "Comment checker companion doc must document manual migration / grandfathering",
  );
});

Deno.test("Scenario-framework README references the authoring gates", async () => {
  const readme = await read(SCENARIO_README_PATH);
  const lower = readme.toLowerCase();
  assert(
    lower.includes("check:ste100-comments") || lower.includes("check:agent-prose"),
    "Scenario-framework README should reference the STE authoring gate tasks",
  );
});

Deno.test("deno.json declares the authoring gate and index tasks", async () => {
  const denoJson = await read(DENO_JSON_PATH);
  assertStringIncludes(denoJson, '"check:agent-prose"');
  assertStringIncludes(denoJson, '"check:ste100-comments"');
  assertStringIncludes(denoJson, '"check:ste100-comments:staged"');
  assertStringIncludes(denoJson, '"check:skill-index"');
});

Deno.test("Blueprints/Skills README states the authoring communication rule", async () => {
  const readme = await read(BLUEPRINTS_SKILLS_README_PATH);
  const lower = readme.toLowerCase();
  assert(
    lower.includes("communication") && (lower.includes("ste") || lower.includes("concise")),
    "Blueprints/Skills README must state the concise communication authoring rule",
  );
});

Deno.test(".copilot/README mentions the STE authoring rule and the check command", async () => {
  const readme = await read(DOT_COPILOT_README_PATH);
  const lower = readme.toLowerCase();
  assert(
    lower.includes("asd-ste100") && lower.includes("check:agent-prose"),
    ".copilot/README must mention the STE requirement and the check:agent-prose command",
  );
});

Deno.test("Building_with_AI_Agents points to the communication requirement and check command", async () => {
  const readme = await read(BUILDING_WITH_AI_AGENTS_PATH);
  const lower = readme.toLowerCase();
  assert(
    lower.includes("asd-ste100") && lower.includes("check:agent-prose"),
    "Building_with_AI_Agents must point to the STE requirement and the check command",
  );
});
