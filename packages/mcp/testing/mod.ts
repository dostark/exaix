/**
 * @module McpTestingPackage
 * @path packages/mcp/testing/mod.ts
 * @related-files []
 * @architectural-layer MCP
 * @ungrounded
 * @description Public test-support surface for MCP package helpers shared across workspace tests.
 */

export { AllowAllPermissionsService } from "./allow_all_permissions.ts";
export { AllowAllConfirmationInterceptor } from "./allow_all_confirmation_interceptor.ts";
export { DenyAllConfirmationInterceptor } from "./deny_all_confirmation_interceptor.ts";
export * from "./test_setup.ts";
export {
  ECHO_TOOL_TEXT_PREFIX,
  type IReferenceServerHandle,
  startReferenceServer,
  STRUCTURED_TOOL_CURRENCY,
} from "../tests/fixtures/reference_mcp_server.ts";
export {
  type IAuthenticatedServerHandle,
  startAuthenticatedReferenceServer,
  WHOAMI_TOOL_IDENTITY,
} from "../tests/fixtures/authenticated_reference_server.ts";
