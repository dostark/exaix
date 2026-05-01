/**
 * @module SharedConstantsTest
 * @path tests/shared/constants_test.ts
 * @description Verifies shared flow namespace constants are exported with stable values.
 * @architectural-layer Tests
 * @related-files ["packages/core/src/types/constants.ts"]
 */

import { assertEquals } from "@std/assert";
import {
  DEFAULT_NAMESPACE_MAX_BYTES,
  FLOW_EVENT_NAMESPACE_INITIALIZED,
  FLOW_EVENT_NAMESPACE_READ,
  FLOW_EVENT_NAMESPACE_WRITE,
} from "@exaix/core";

Deno.test("[SharedConstants] namespace event names and defaults are exported", () => {
  assertEquals(FLOW_EVENT_NAMESPACE_INITIALIZED, "flow.namespace.initialized");
  assertEquals(FLOW_EVENT_NAMESPACE_READ, "flow.namespace.read");
  assertEquals(FLOW_EVENT_NAMESPACE_WRITE, "flow.namespace.write");
  assertEquals(DEFAULT_NAMESPACE_MAX_BYTES, 65_536);
});
