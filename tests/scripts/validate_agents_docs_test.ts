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

Deno.test("agent docs validation accepts archived phase plans", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "scripts/validate_agents_docs.ts"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
});
