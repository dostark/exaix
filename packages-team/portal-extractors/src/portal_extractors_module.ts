/**
 * @module PortalExtractorsModule
 * @path packages-team/portal-extractors/src/portal_extractors_module.ts
 * @ungrounded
 * @description ICapabilityModule for Team-edition extended-language symbol extractors
 * (Rust, Go, Java, and the long tail). Asserts CAP_EXTENDED_LANG_EXTRACTION edition
 * mapping and registers each extended-language extractor through the composer seam.
 * The Python extractor is NOT registered here — it ships in Solo (MIT) via
 * createDefaultSymbolExtractorRegistry().
 * @architectural-layer Portal
 * @related-files [packages/core/src/composer/edition_composer.ts, packages/portal/knowledge/symbol_extractor_registry.ts]
 */

import { EDITION_TEAM, LANG_GO, LANG_JAVA, LANG_RUST } from "@exaix/core";
import {
  CAP_EXTENDED_LANG_EXTRACTION,
  CAPABILITY_EDITION,
} from "@exaix/core/composer";
import type {
  ICapabilityModule,
  ISeamRegistryPlaceholder,
} from "@exaix/core/composer";
import type { ISymbolExtractorRegistry } from "@exaix/portal/knowledge";
import { RustSymbolExtractor } from "./rust_symbol_extractor.ts";
import { GoSymbolExtractor } from "./go_symbol_extractor.ts";
import { JavaSymbolExtractor } from "./java_symbol_extractor.ts";

export class PortalExtractorsModule implements ICapabilityModule {
  constructor() {
    if (CAPABILITY_EDITION[CAP_EXTENDED_LANG_EXTRACTION] !== EDITION_TEAM) {
      throw new Error(
        `CAP_EXTENDED_LANG_EXTRACTION maps to "${
          CAPABILITY_EDITION[CAP_EXTENDED_LANG_EXTRACTION]
        }" but is being wired in Team edition. ` +
          "Update CAPABILITY_EDITION or move this wiring to the correct bootstrap.",
      );
    }
  }

  registerSymbolExtractors(registry: ISeamRegistryPlaceholder): void {
    const symRegistry = registry as ISymbolExtractorRegistry;
    symRegistry.register(LANG_RUST, new RustSymbolExtractor());
    symRegistry.register(LANG_GO, new GoSymbolExtractor());
    symRegistry.register(LANG_JAVA, new JavaSymbolExtractor());
  }
}
