/**
 * @module ProviderFactoryReasonCodeTest
 * @path packages/ai/tests/provider_factory_reason_code_test.ts
 * @description Ensures only typed provider factory errors expose a reason code.
 * @architectural-layer Tests
 * @dependencies [@exaix/ai]
 * @related-files [packages/ai/src/errors.ts]
 */
import { assertEquals } from "@std/assert";
import {
  getProviderFailureReason,
  ProviderCallPolicyError,
  ProviderFactoryError,
  ProviderProtocolError,
} from "../src/errors.ts";

Deno.test("factory reason extraction ignores arbitrary error properties", () => {
  assertEquals(
    getProviderFailureReason(new ProviderProtocolError("Invalid compatible response", "openai-chat")),
    "protocol_invalid",
  );
  assertEquals(
    getProviderFailureReason(new ProviderFactoryError("denied", "net_permission_denied")),
    "net_permission_denied",
  );
  assertEquals(
    getProviderFailureReason(Object.assign(new Error("forged"), { reasonCode: "credential_missing" })),
    undefined,
  );
  assertEquals(
    getProviderFailureReason(new ProviderCallPolicyError("unsupported_call_option", "local-test")),
    "unsupported_call_option",
  );
  assertEquals(
    getProviderFailureReason(new ProviderCallPolicyError("pricing_unavailable", "openai")),
    "pricing_unavailable",
  );
  assertEquals(getProviderFailureReason(new ProviderFactoryError("forged", "remote-secret" as never)), undefined);
});
