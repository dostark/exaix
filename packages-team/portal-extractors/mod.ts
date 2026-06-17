/**
 * @module PortalExtractorsPackage
 * @path packages-team/portal-extractors/mod.ts
 * @ungrounded
 * @description Team-edition portal symbol extractors package (Phase 119).
 * Provides PortalExtractorsModule — an ICapabilityModule that registers
 * extended-language ISymbolExtractor implementations (Rust, Go, Java, …)
 * through the edition-composer seam, gated by CAP_EXTENDED_LANG_EXTRACTION.
 * The Python extractor ships in Solo (MIT) via the default registry and is
 * not part of this Team module.
 * @architectural-layer Portal
 * @related-files [packages/core/src/composer/edition_composer.ts]
 */

export { PortalExtractorsModule } from "./src/portal_extractors_module.ts";
export { RustSymbolExtractor } from "./src/rust_symbol_extractor.ts";
export { GoSymbolExtractor } from "./src/go_symbol_extractor.ts";
export { JavaSymbolExtractor } from "./src/java_symbol_extractor.ts";
