/**
 * @module PortalExtractorsModule
 * @path packages-team/portal-extractors/src/portal_extractors_module.ts
 * @ungrounded
 * @description ICapabilityModule for Team-edition extended-language symbol extractors
 * (Rust, Go, Java, and the long tail). Asserts CAP_EXTENDED_LANG_EXTRACTION edition
 * mapping and registers each extended-language extractor through the composer seam.
 * The Python extractor is NOT registered here — it ships in Solo (MIT) via
 * createDefaultSymbolExtractorRegistry().
 *
 * Follow-on languages (Rust, Go, Java) will call registry.register() for their
 * extractor in registerSymbolExtractors() once implemented.
 * @architectural-layer Portal
 * @related-files [packages/core/src/composer/edition_composer.ts, packages/portal/knowledge/symbol_extractor_registry.ts]
 */

import { EDITION_TEAM } from "@exaix/core";
import { CAP_EXTENDED_LANG_EXTRACTION, CAPABILITY_EDITION } from "@exaix/core/composer";
import type { ICapabilityModule, ISeamRegistryPlaceholder } from "@exaix/core/composer";

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

  registerSymbolExtractors(_registry: ISeamRegistryPlaceholder): void {
    // Extended-language extractors (Rust, Go, Java, …) will be registered here
    // in follow-on steps. The Python extractor is MIT/Solo and registered in
    // createDefaultSymbolExtractorRegistry(), not through this module.
  }
}
