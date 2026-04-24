/**
 * @module SetTestModeHelper
 * @path tests/cli/helpers/set_test_mode.ts
 * @description Provides utilities for injecting 'test mode' state into CLI command
 * execution, ensuring isolation and predictable behavior for automated tests.
 */

Deno.env.set("EXA_TEST_MODE", "1");
Deno.env.set("EXA_TEST_CLI_MODE", "1");

// Eagerly load the module at top level to avoid it being "loaded during the test" attribution
// We await it to ensure initialization completes before we unset the flags
// style-exclude:REQUIRED_FOR_TEST - This runtime import is required for CLI test mode initialization and must occur before env reset.
await import("../../../src/cli/exactl.ts");

// Clean up so we don't pollute other tests run in the same process
Deno.env.delete("EXA_TEST_MODE");
Deno.env.delete("EXA_TEST_CLI_MODE");
