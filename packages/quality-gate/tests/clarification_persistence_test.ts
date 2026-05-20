/**
 * @module ClarificationPersistenceTest
 * @path packages/quality-gate/tests/clarification_persistence_test.ts
 * @description Tests for clarification session JSON persistence helpers.
 * @architectural-layer Domain
 * @related-files [packages/quality-gate/src/clarification_persistence.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import type { IRequestSpecification } from "@exaix/schemas/request_specification.ts";
import { ClarificationSessionStatus, type IClarificationSession } from "@exaix/schemas/clarification_session.ts";
import { loadClarification, renderSpecificationAsPrompt, saveClarification } from "@exaix/quality-gate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// renderSpecificationAsPrompt
// ---------------------------------------------------------------------------

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
  assertEquals(result.includes("## Summary"), true);
  assertEquals(result.includes("Implement JWT authentication"), true);
  assertEquals(result.includes("## Goals"), true);
  assertEquals(result.includes("## Success Criteria"), true);
  assertEquals(result.includes("## Scope"), true);
  assertEquals(result.includes("## Constraints"), true);
  assertEquals(result.includes("## Context"), true);
});

Deno.test("[clarification_persistence] renderSpecificationAsPrompt omits empty sections", () => {
  const result = renderSpecificationAsPrompt(MINIMAL_SPEC);
  assertEquals(result.includes("## Goals"), false);
  assertEquals(result.includes("## Success Criteria"), false);
  assertEquals(result.includes("## Scope"), false);
  assertEquals(result.includes("## Constraints"), false);
  assertEquals(result.includes("## Context"), false);
  assertEquals(result.includes("## Summary"), true);
});

Deno.test("[clarification_persistence] renderSpecificationAsPrompt always includes summary", () => {
  const result = renderSpecificationAsPrompt(MINIMAL_SPEC);
  assertEquals(result.includes("## Summary"), true);
  assertEquals(result.includes("Deploy to production"), true);
});

Deno.test("[clarification_persistence] renderSpecificationAsPrompt handles minimal spec (summary only)", () => {
  const result = renderSpecificationAsPrompt(MINIMAL_SPEC);
  assertEquals(result.trim().length > 0, true);
  assertEquals(result.includes("## Summary\nDeploy to production"), true);
});
