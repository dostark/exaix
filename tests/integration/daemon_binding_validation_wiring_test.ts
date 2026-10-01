/**
 * @module DaemonBindingValidationWiringTest
 * @path tests/integration/daemon_binding_validation_wiring_test.ts
 * @description Guards that the daemon hands ModelBindingService the registries its validation
 *   table reads. Without them native-tools and pricing checks judge against nothing.
 */

import { assertStringIncludes } from "@std/assert";

Deno.test("[wiring] the daemon constructs ModelBindingService with adapter metadata and the model registry", async () => {
  const source = await Deno.readTextFile(new URL("../../apps/daemon/main.ts", import.meta.url));
  const start = source.indexOf("new ModelBindingService({");
  const block = source.slice(start, source.indexOf("});", start));
  assertStringIncludes(block, "getAdapterMetadata: (adapter) => ProviderRegistry.getProviderMetadata(adapter)");
  assertStringIncludes(block, "modelRegistry,");
});
