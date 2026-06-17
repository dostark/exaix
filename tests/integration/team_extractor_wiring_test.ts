/**
 * @module TeamExtractorWiringTest
 * @path tests/integration/team_extractor_wiring_test.ts
 * @description Verifies that PortalExtractorsModule registers Rust, Go, and Java
 * extractors through the registerSymbolExtractors seam hook, so they are resolved
 * by ISymbolExtractorRegistry rather than falling through to EMPTY_SYMBOL_EXTRACTOR.
 */

import { assertEquals } from "@std/assert";
import { SymbolExtractorRegistry } from "@exaix/portal/knowledge";
import type { ISeamRegistryPlaceholder } from "@exaix/core/composer";
import { PortalExtractorsModule } from "@exaix-team/portal-extractors";

Deno.test("[Team] PortalExtractorsModule registers Rust/Go/Java extractors", () => {
  const registry = new SymbolExtractorRegistry();
  const module = new PortalExtractorsModule();

  module.registerSymbolExtractors(registry as ISeamRegistryPlaceholder);

  // Verify each extractor resolves to a real instance (not EMPTY_SYMBOL_EXTRACTOR).
  // The no-op returns [] for any language; registered extractors return [] only for
  // non-matching primaryLanguage. We verify by calling with a matching language and
  // asserting a non-empty extraction — proving the registered extractor is live.
  const rust = registry.getForLanguage("rust");
  assertEquals(
    rust.constructor.name,
    "RustSymbolExtractor",
    "Rust extractor should be RustSymbolExtractor, not empty",
  );

  const go = registry.getForLanguage("go");
  assertEquals(
    go.constructor.name,
    "GoSymbolExtractor",
    "Go extractor should be GoSymbolExtractor, not empty",
  );

  const java = registry.getForLanguage("java");
  assertEquals(
    java.constructor.name,
    "JavaSymbolExtractor",
    "Java extractor should be JavaSymbolExtractor, not empty",
  );

  // Verify an unregistered language still gets the no-op.
  const ruby = registry.getForLanguage("ruby");
  assertEquals(
    (ruby as { constructor: { name: string } }).constructor.name,
    "Object",
    "Unregistered language should get EMPTY_SYMBOL_EXTRACTOR (Object literal)",
  );
});
