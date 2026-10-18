/**
 * @module ExaixLintPlugin
 * @path packages/lint-policy/plugin.ts
 * @description Entry point for the exaix Deno lint plugin. It imports the validated style-rule
 *   catalog and default-exports the plugin. `deno lint` loads it through `deno.json` `lint.plugins`.
 * @architectural-layer Tooling
 * @dependencies [@exaix/lint-rules]
 * @related-files [packages/lint-policy/catalog.json, packages/lint-rules/mod.ts]
 */

import catalog from "./catalog.json" with { type: "json" };
import { createLintPlugin, parseCatalog } from "@exaix/lint-rules";

export default createLintPlugin("exaix", parseCatalog(catalog));
