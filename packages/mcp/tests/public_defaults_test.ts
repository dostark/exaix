/**
 * @module McpPublicDefaultsTest
 * @path packages/mcp/tests/public_defaults_test.ts
 * @description Checks that public MCP defaults retain their canonical values after import cleanup.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/mcp, @exaix/core]
 * @related-files [packages/mcp/mod.ts, packages/mcp/src/constants.ts]
 */

import { assertEquals } from "@std/assert";
import {
  DEFAULT_MCP_AGENT_ROLE_ID,
  DEFAULT_MCP_ENABLED,
  DEFAULT_MCP_HTTP_PORT,
  DEFAULT_MCP_SERVER_NAME,
  DEFAULT_MCP_TRANSPORT,
  DEFAULT_MCP_VERSION,
} from "@exaix/mcp";
import {
  DEFAULT_MCP_AGENT_ROLE_ID as CORE_DEFAULT_MCP_AGENT_ROLE_ID,
  DEFAULT_MCP_ENABLED as CORE_DEFAULT_MCP_ENABLED,
  DEFAULT_MCP_HTTP_PORT as CORE_DEFAULT_MCP_HTTP_PORT,
  DEFAULT_MCP_SERVER_NAME as CORE_DEFAULT_MCP_SERVER_NAME,
  DEFAULT_MCP_TRANSPORT as CORE_DEFAULT_MCP_TRANSPORT,
  DEFAULT_MCP_VERSION as CORE_DEFAULT_MCP_VERSION,
} from "@exaix/core";

Deno.test("import-callers-preserved: MCP entry-point defaults match their canonical owner", () => {
  assertEquals({
    DEFAULT_MCP_AGENT_ROLE_ID,
    DEFAULT_MCP_ENABLED,
    DEFAULT_MCP_HTTP_PORT,
    DEFAULT_MCP_SERVER_NAME,
    DEFAULT_MCP_TRANSPORT,
    DEFAULT_MCP_VERSION,
  }, {
    DEFAULT_MCP_AGENT_ROLE_ID: CORE_DEFAULT_MCP_AGENT_ROLE_ID,
    DEFAULT_MCP_ENABLED: CORE_DEFAULT_MCP_ENABLED,
    DEFAULT_MCP_HTTP_PORT: CORE_DEFAULT_MCP_HTTP_PORT,
    DEFAULT_MCP_SERVER_NAME: CORE_DEFAULT_MCP_SERVER_NAME,
    DEFAULT_MCP_TRANSPORT: CORE_DEFAULT_MCP_TRANSPORT,
    DEFAULT_MCP_VERSION: CORE_DEFAULT_MCP_VERSION,
  });
});
