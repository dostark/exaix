/**
 * @module CommitTemplateTest
 * @path tests/scripts/commit_template_test.ts
 * @description Verifies the existence and basic structure of the commit message template.
 */

import { assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe("templates/commit_msg.template", () => {
  it("exists and contains all mandatory headers", async () => {
    const content = await Deno.readTextFile("templates/commit_msg.template");
    assertStringIncludes(content, "what:", "Template should have 'what:' header");
    assertStringIncludes(content, "rationale:", "Template should have 'rationale:' header");
    assertStringIncludes(content, "tests:", "Template should have 'tests:' header");
    assertStringIncludes(content, "who:", "Template should have 'who:' header");
    assertStringIncludes(content, "impact:", "Template should have 'impact:' header");
  });
});
