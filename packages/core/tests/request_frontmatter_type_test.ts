/**
 * @module CoreRequestFrontmatterTypeTest
 * @path packages/core/tests/request_frontmatter_type_test.ts
 * @description Compile-time verification for request frontmatter types owned by @exaix/core.
 *
 * This file contains no runtime tests.
 * It exists solely to verify the TypeScript contract at compile time.
 */

import type { IRequestFrontmatter, ParsedRequestFile, RequestStatusType } from "@exaix/core";

const _frontmatter: IRequestFrontmatter = {
  trace_id: crypto.randomUUID(),
  created: new Date().toISOString(),
  status: "pending" as RequestStatusType,
  priority: "normal",
  source: "cli",
  created_by: "test-user",
  identity: "senior-coder",
};

const _parsedRequest: ParsedRequestFile = {
  frontmatter: _frontmatter,
  body: "request body",
  rawContent: "---\nstatus: pending\n---\nrequest body",
};
