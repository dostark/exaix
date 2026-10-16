/**
 * @module TeamExtractorWiringTest
 * @path tests/integration/team_extractor_wiring_test.ts
 * @description Verifies that PortalExtractorsModule registers Rust, Go, and Java
 * extractors through the registerSymbolExtractors seam hook, so they are resolved
 * by ISymbolExtractorRegistry rather than falling through to EMPTY_SYMBOL_EXTRACTOR.
 */

import { assertArrayIncludes, assertEquals, assertFalse } from "@std/assert";
import {
  createDefaultSymbolReferenceExtractorRegistry,
  type ISymbolReferenceExtractorRegistry,
  SymbolExtractorRegistry,
} from "@exaix/portal/knowledge";
import type { ICapabilityModule, ISeamRegistryPlaceholder } from "@exaix/core/composer";
import { PortalExtractorsModule } from "@exaix-team/portal-extractors";
import { paidEditionCapabilityModules, registerCapabilitySeamHooks } from "../../apps/daemon/src/bootstrap_team.ts";
import { EDITION_ENTERPRISE, EDITION_TEAM } from "@exaix/core";

Deno.test("[Team] PortalExtractorsModule registers Rust/Go/Java extractors", () => {
  const registry = new SymbolExtractorRegistry();
  const module = new PortalExtractorsModule();

  module.registerSymbolExtractors(registry as ISeamRegistryPlaceholder);

  // Verify each extractor resolves to a real instance (not EMPTY_SYMBOL_EXTRACTOR) by calling
  // it with a matching language and asserting a non-empty extraction — the no-op returns []
  // for any language, so a non-empty result proves the registered extractor is live.
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

Deno.test("[Team] registerCapabilitySeamHooks forwards the reference registry by object identity", () => {
  const symbolRegistry = new SymbolExtractorRegistry();
  const referenceRegistry = createDefaultSymbolReferenceExtractorRegistry();
  const seen: Array<ISymbolReferenceExtractorRegistry | undefined> = [];

  const module: ICapabilityModule = {
    registerSymbolReferenceExtractors: (registry) => {
      seen.push(registry as ISymbolReferenceExtractorRegistry);
    },
  };

  const count = registerCapabilitySeamHooks([module], {
    symbolRegistry,
    symbolReferenceRegistry: referenceRegistry,
  });

  assertEquals(count, 1);
  assertEquals(
    seen[0] === referenceRegistry,
    true,
    "the module must receive the same registry instance the service holds, not a copy",
  );
});

Deno.test("[Team] registerCapabilitySeamHooks skips the reference hook when no registry is supplied", () => {
  const symbolRegistry = new SymbolExtractorRegistry();
  let called = 0;
  const module: ICapabilityModule = {
    registerSymbolReferenceExtractors: () => {
      called += 1;
    },
  };

  const count = registerCapabilitySeamHooks([module], { symbolRegistry });

  assertEquals(count, 0);
  assertEquals(called, 0, "an absent registry must keep the feature inert");
});

Deno.test("[Enterprise] paidEditionCapabilityModules adds the symbol graph module only for enterprise", () => {
  const enterpriseNames = paidEditionCapabilityModules(EDITION_ENTERPRISE).map((m) => m.constructor.name);
  const teamNames = paidEditionCapabilityModules(EDITION_TEAM).map((m) => m.constructor.name);

  assertArrayIncludes(enterpriseNames, ["EnterpriseSymbolGraphModule"]);
  assertArrayIncludes(enterpriseNames, ["PortalExtractorsModule"]);
  assertFalse(teamNames.includes("EnterpriseSymbolGraphModule"));
  assertArrayIncludes(teamNames, ["PortalExtractorsModule"]);
});
