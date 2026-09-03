/**
 * @module ClarificationReEntryTest
 * @path packages/quality-gate/tests/clarification_re_entry_test.ts
 * @description Tests the Q&A re-entry contract: `finalizeAndWritePending()` atomic
 * write + frontmatter mutation, `shouldSkipByStatus()` skip semantics for clarification
 * statuses, and the `hasAssessedAt()` bypass flag check.
 * @architectural-layer Domain
 * @related-files [packages/quality-gate/src/clarification_reentry_service.ts]
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ClarificationSessionStatus, type IClarificationSession } from "@exaix/schemas/clarification_session.ts";
import type { IRequestSpecification } from "@exaix/schemas/request_specification.ts";
import { finalizeAndWritePending, hasAssessedAt, shouldSkipByStatus } from "@exaix/quality-gate";
import { RequestSource } from "@exaix/core";
import { RequestStatus } from "@exaix/core/status";

async function makeTempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "clari_reentry_test_" });
}

function makeRequestFile(
  dir: string,
  status: string,
  extraFields: Record<string, string> = {},
): string {
  const filePath = join(dir, "test_request.md");
  const extras = Object.entries(extraFields)
    .map(([k, v]) => `${k}: "${v}"`)
    .join("\n");

  const content = [
    "---",
    `trace_id: "test-trace"`,
    `created: "2026-01-01T00:00:00.000Z"`,
    `status: "${status}"`,
    `priority: "normal"`,
    `agent_role: "senior-coder"`,
    `source: ${RequestSource.CLI}`,
    `created_by: "tester"`,
    extras,
    "---",
    "Fix something",
  ].join("\n");

  Deno.writeTextFileSync(filePath, content);
  return filePath;
}

function makeSession(requestId: string, status = ClarificationSessionStatus.AGENT_SATISFIED): IClarificationSession {
  return {
    requestId,
    originalBody: "Fix something in the system",
    rounds: [],
    status,
    qualityHistory: [{ round: 1, score: 75, level: "good" }],
    refinedBody: {
      summary: "Fix auth module",
      goals: ["Fix login bug"],
      successCriteria: ["Login endpoint returns 200"],
      scope: { includes: ["src/services/auth.ts"], excludes: [] },
      constraints: [],
      context: [],
      originalBody: "Fix something in the system",
    },
  };
}

function makeSpec(): IRequestSpecification {
  return {
    summary: "Fix auth module",
    goals: ["Fix login bug"],
    successCriteria: ["Login endpoint returns 200"],
    scope: { includes: ["src/services/auth.ts"], excludes: [] },
    constraints: [],
    context: [],
    originalBody: "Fix something in the system",
  };
}

Deno.test("[ClarificationReEntry] finalizeAndWritePending writes status: pending to frontmatter", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = makeRequestFile(dir, RequestStatus.REFINING);
    const session = makeSession("req-001");
    const spec = makeSpec();

    await finalizeAndWritePending(filePath, session, spec);

    const content = await Deno.readTextFile(filePath);
    assertStringIncludes(content, "status: pending");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ClarificationReEntry] finalizeAndWritePending writes assessed_at to frontmatter", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = makeRequestFile(dir, RequestStatus.REFINING);
    const session = makeSession("req-002");
    const spec = makeSpec();

    await finalizeAndWritePending(filePath, session, spec);

    const content = await Deno.readTextFile(filePath);
    assertStringIncludes(content, "assessed_at:");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ClarificationReEntry] finalizeAndWritePending is atomic (no .tmp file remains)", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = makeRequestFile(dir, RequestStatus.REFINING);
    const session = makeSession("req-003");
    const spec = makeSpec();

    await finalizeAndWritePending(filePath, session, spec);

    let tmpExists = false;
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name.endsWith(".tmp")) tmpExists = true;
    }
    assertEquals(tmpExists, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ClarificationReEntry] shouldSkipByStatus returns true for NEEDS_CLARIFICATION", () => {
  assertEquals(shouldSkipByStatus(RequestStatus.NEEDS_CLARIFICATION), true);
});

Deno.test("[ClarificationReEntry] shouldSkipByStatus returns true for REFINING", () => {
  assertEquals(shouldSkipByStatus(RequestStatus.REFINING), true);
});

Deno.test("[ClarificationReEntry] shouldSkipByStatus returns false for PENDING", () => {
  assertEquals(shouldSkipByStatus(RequestStatus.PENDING), false);
});

Deno.test("[ClarificationReEntry] hasAssessedAt returns true when assessed_at is present", () => {
  assertEquals(hasAssessedAt({ assessed_at: "2026-01-01T00:00:00.000Z" }), true);
});

Deno.test("[ClarificationReEntry] hasAssessedAt returns false when assessed_at is absent", () => {
  assertEquals(hasAssessedAt({}), false);
});
