/**
 * @module ValidateAgentsDocsTest
 * @path tests/scripts/validate_agents_docs_test.ts
 * @description Checks that evidence is outside the agent-document validation scope.
 * @architectural-layer Test
 * @related-files [scripts/validate_agents_docs.ts]
 */
import { assertEquals } from "@std/assert";
import { isAgentEvidencePath } from "../../scripts/validate_agents_docs.ts";

Deno.test("agent docs validation skips only the relocated evidence subtree", () => {
  assertEquals(isAgentEvidencePath("exaix-dev-docs/evidence/phase-234/result.md"), true);
  assertEquals(isAgentEvidencePath(".copilot/skills/evidence/SKILL.md"), false);
  assertEquals(isAgentEvidencePath("exaix-dev-docs/evidence-guide.md"), false);
});
