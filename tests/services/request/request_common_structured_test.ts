/**
 * @module RequestCommonStructuredTest
 * @path tests/services/request/request_common_structured_test.ts
 * @description Tests for structured expectations (acceptance_criteria,
 * expected_outcomes, scope) propagation in buildParsedRequest().
 * Phase 49, Step 10.
 * @architectural-layer Tests
 * @related-files [.copilot/planning/phase-49-quality-pipeline-hardening.md]
 */
import { assertEquals } from "@std/assert";
import { buildParsedRequest } from "../../../src/services/request/request_common.ts";
import { RequestStatus } from "@exaix/core/status";

const BASE_FRONTMATTER = {
  priority: "normal",
  source: "test",
  title: "Test request",
  status: RequestStatus.PENDING,
  trace_id: "trace-base",
  created: "2025-01-01T00:00:00.000Z",
  created_by: "test",
};

Deno.test(
  "[buildParsedRequest] includes acceptance_criteria in context",
  () => {
    const fm = {
      ...BASE_FRONTMATTER,
      acceptance_criteria: ["All tests pass", "No regressions"],
    };
    const req = buildParsedRequest("Do something", fm, "req-1", "trace-1");
    assertEquals(req.context.acceptance_criteria, ["All tests pass", "No regressions"]);
  },
);

Deno.test(
  "[buildParsedRequest] includes expected_outcomes in context",
  () => {
    const fm = {
      ...BASE_FRONTMATTER,
      expected_outcomes: ["Server returns 200", "DB updated"],
    };
    const req = buildParsedRequest("Do something", fm, "req-2", "trace-2");
    assertEquals(req.context.expected_outcomes, ["Server returns 200", "DB updated"]);
  },
);

Deno.test(
  "[buildParsedRequest] includes scope in context",
  () => {
    const fm = {
      ...BASE_FRONTMATTER,
      scope: { include: ["src/api/**"], exclude: ["src/api/legacy/**"] },
    };
    const req = buildParsedRequest("Do something", fm, "req-3", "trace-3");
    assertEquals(req.context.scope, { include: ["src/api/**"], exclude: ["src/api/legacy/**"] });
  },
);

Deno.test(
  "[buildParsedRequest] works without structured expectations",
  () => {
    const req = buildParsedRequest("Do something", BASE_FRONTMATTER, "req-4", "trace-4");
    assertEquals(req.context.acceptance_criteria, undefined);
    assertEquals(req.context.expected_outcomes, undefined);
    assertEquals(req.context.scope, undefined);
  },
);
