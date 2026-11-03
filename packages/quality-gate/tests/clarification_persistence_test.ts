/**
 * @module ClarificationPersistenceTest
 * @path packages/quality-gate/tests/clarification_persistence_test.ts
 * @description Tests for clarification session JSON persistence helpers.
 * @architectural-layer Domain
 * @related-files [packages/quality-gate/src/clarification_persistence.ts]
 */

import { assertEquals, assertExists, assertFalse } from "@std/assert";
import { join } from "@std/path";
import type { IRequestSpecification } from "@exaix/schemas/request_specification.ts";
import { ClarificationSessionStatus, type IClarificationSession } from "@exaix/schemas/clarification_session.ts";
import { loadClarification, renderSpecificationAsPrompt, saveClarification } from "@exaix/quality-gate";

// Helpers

function makeTempDir(): Promise<string> {
  return Deno.makeTempDir({ prefix: "clari_test_" });
}

function makeSession(requestId: string): IClarificationSession {
  return {
    requestId,
    originalBody: "Fix the authentication bug",
    rounds: [],
    status: ClarificationSessionStatus.ACTIVE,
    qualityHistory: [{ round: 0, score: 40, level: "poor" }],
  };
}

// Tests

Deno.test("[ClarificationPersistence] saves session as JSON sibling file", async () => {
  const dir = await makeTempDir();
  try {
    const requestPath = join(dir, "my_request.md");
    const session = makeSession("req-save-test");

    await saveClarification(requestPath, session);

    const expectedPath = join(dir, "my_request_clarification.json");
    const stat = await Deno.stat(expectedPath);
    assertExists(stat);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ClarificationPersistence] loads previously saved session", async () => {
  const dir = await makeTempDir();
  try {
    const requestPath = join(dir, "my_request.md");
    const session = makeSession("req-load-test");

    await saveClarification(requestPath, session);
    const loaded = await loadClarification(requestPath);

    assertExists(loaded);
    assertEquals(loaded?.requestId, "req-load-test");
    assertEquals(loaded?.status, ClarificationSessionStatus.ACTIVE);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ClarificationPersistence] returns null for missing file", async () => {
  const dir = await makeTempDir();
  try {
    const requestPath = join(dir, "nonexistent.md");
    const loaded = await loadClarification(requestPath);
    assertEquals(loaded, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ClarificationPersistence] returns null for corrupted file", async () => {
  const dir = await makeTempDir();
  try {
    const requestPath = join(dir, "corrupt_request.md");
    const jsonPath = join(dir, "corrupt_request_clarification.json");
    await Deno.writeTextFile(jsonPath, "{ not valid json !!!");

    const loaded = await loadClarification(requestPath);
    assertEquals(loaded, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ClarificationPersistence] uses atomic write", async () => {
  const dir = await makeTempDir();
  try {
    const requestPath = join(dir, "atomic_request.md");
    const session = makeSession("req-atomic-test");

    await saveClarification(requestPath, session);

    // No tmp file should remain after atomic write
    let tmpExists = false;
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name.endsWith(".tmp")) {
        tmpExists = true;
      }
    }
    assertEquals(tmpExists, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// renderSpecificationAsPrompt

const FULL_SPEC: IRequestSpecification = {
  summary: "Implement JWT authentication",
  goals: ["Add POST /auth/login endpoint"],
  successCriteria: ["Returns 200 with JWT on valid credentials"],
  scope: { includes: ["src/api/auth.ts"], excludes: ["user registration"] },
  constraints: ["Use existing jsonwebtoken library"],
  context: ["Existing codebase uses Deno"],
  originalBody: "Make auth work",
};

const MINIMAL_SPEC: IRequestSpecification = {
  summary: "Deploy to production",
  goals: [],
  successCriteria: [],
  scope: { includes: [], excludes: [] },
  constraints: [],
  context: [],
  originalBody: "deploy",
};

Deno.test("[clarification_persistence] renderSpecificationAsPrompt produces all sections for full spec", () => {
  const result = renderSpecificationAsPrompt(FULL_SPEC);
  const resultIncludesSummary: boolean = result.includes("## Summary");
  assertEquals(resultIncludesSummary, true, "result should include '## Summary'");
  const resultIncludesImplementJWTAuthenticati: boolean = result.includes("Implement JWT authentication");
  assertEquals(resultIncludesImplementJWTAuthenticati, true, "result should include 'Implement JWT authentication'");
  const resultIncludesGoals: boolean = result.includes("## Goals");
  assertEquals(resultIncludesGoals, true, "result should include '## Goals'");
  const resultIncludesSuccessCriteria: boolean = result.includes("## Success Criteria");
  assertEquals(resultIncludesSuccessCriteria, true, "result should include '## Success Criteria'");
  const resultIncludesScope: boolean = result.includes("## Scope");
  assertEquals(resultIncludesScope, true, "result should include '## Scope'");
  const resultIncludesConstraints: boolean = result.includes("## Constraints");
  assertEquals(resultIncludesConstraints, true, "result should include '## Constraints'");
  const resultIncludesContext: boolean = result.includes("## Context");
  assertEquals(resultIncludesContext, true, "result should include '## Context'");
});

Deno.test("[clarification_persistence] renderSpecificationAsPrompt omits empty sections", () => {
  const result = renderSpecificationAsPrompt(MINIMAL_SPEC);
  assertFalse(result.includes("## Goals"));
  assertFalse(result.includes("## Success Criteria"));
  assertFalse(result.includes("## Scope"));
  assertFalse(result.includes("## Constraints"));
  assertFalse(result.includes("## Context"));
  const resultIncludesSummary2: boolean = result.includes("## Summary");
  assertEquals(resultIncludesSummary2, true, "result should include '## Summary'");
});

Deno.test("[clarification_persistence] renderSpecificationAsPrompt always includes summary", () => {
  const result = renderSpecificationAsPrompt(MINIMAL_SPEC);
  const resultIncludesSummary3: boolean = result.includes("## Summary");
  assertEquals(resultIncludesSummary3, true, "result should include '## Summary'");
  const resultIncludesDeployToProduction: boolean = result.includes("Deploy to production");
  assertEquals(resultIncludesDeployToProduction, true, "result should include 'Deploy to production'");
});

Deno.test("[clarification_persistence] renderSpecificationAsPrompt handles minimal spec (summary only)", () => {
  const result = renderSpecificationAsPrompt(MINIMAL_SPEC);
  assertEquals(result.trim().length > 0, true);
  const resultIncludesSummaryDeployTo: boolean = result.includes("## Summary\nDeploy to production");
  assertEquals(resultIncludesSummaryDeployTo, true, "result should include '## Summary Deploy to production'");
});
