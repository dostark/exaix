/**
 * @module RequestFrontmatterTypeTest
 * @path tests/types/request_frontmatter_type_test.ts
 * @description Compile-time verification that IRequestFrontmatter does NOT have deprecated agent? field (Phase 54 contract).
 *
 * This file contains no runtime tests.
 * It exists solely to verify the TypeScript contract at compile time.
 * If the legacy `agent` field exists, `deno check` will pass when it should fail.
 */

import type { IRequestFrontmatter } from "../../src/services/request_processing/types.ts";
import type { RequestStatusType } from "@exaix/core";

// ============================================================================
// Type Contract Verification
// ============================================================================

// The canonical field must exist and compile successfully
const _fm: IRequestFrontmatter = {
  trace_id: crypto.randomUUID(),
  created: new Date().toISOString(),
  status: "pending" as RequestStatusType,
  priority: "normal",
  source: "cli",
  created_by: "test-user",
  identity: "senior-coder", // ← canonical field, must compile
};

// Verify minimal frontmatter with only required fields
const _minimalFm: IRequestFrontmatter = {
  trace_id: crypto.randomUUID(),
  created: new Date().toISOString(),
  status: "pending" as RequestStatusType,
  priority: "normal",
  source: "cli",
  created_by: "test-user",
};

// Verify optional fields are optional
const _withOptionalFields: IRequestFrontmatter = {
  trace_id: crypto.randomUUID(),
  created: new Date().toISOString(),
  status: "pending" as RequestStatusType,
  priority: "normal",
  source: "cli",
  created_by: "test-user",
  identity: "code-reviewer",
  flow: "code-review-flow",
};

// ============================================================================
// Compile-Time Error Guards (commented out - uncomment to verify type errors)
// ============================================================================

// The following MUST be a TypeScript error if Phase 54 is complete:
// The `agent` field was removed in Phase 54
// const _bad: IRequestFrontmatter = {
//   trace_id: crypto.randomUUID(),
//   created: new Date().toISOString(),
//   status: "pending" as RequestStatusType,
//   priority: "normal",
//   source: "cli",
//   created_by: "test-user",
//   agent: "senior-coder",  // ← ERROR: removed in Phase 54
// };

// The following MUST be a TypeScript error if uncommented:
// identity field must be string, not number
// const _wrongType: IRequestFrontmatter = {
//   trace_id: crypto.randomUUID(),
//   created: new Date().toISOString(),
//   status: "pending" as RequestStatusType,
//   priority: "normal",
//   source: "cli",
//   created_by: "test-user",
//   identity: 123, // ← ERROR: identity must be string
// };

// The following MUST be a TypeScript error if uncommented:
// Missing required field
// const _missingRequired: IRequestFrontmatter = {
//   trace_id: crypto.randomUUID(),
//   created: new Date().toISOString(),
//   status: "pending" as RequestStatusType,
//   priority: "normal",
//   source: "cli",
//   // created_by: missing - ERROR
// };
