#!/usr/bin/env -S deno run -A
/**
 * @module ExaixLintPlugin
 * @path scripts/config/exaix_lint_plugin.ts
 * @description Repository entry point for the exaix Deno lint plugin. It imports the
 *   validated style-rule catalog and default-exports the plugin. Usage: loaded by
 *   `deno lint` through `deno.json` `lint.plugins`; never run directly.
 */

import catalog from "./style_rule_catalog.json" with { type: "json" };
import { createLintPlugin, parseCatalog } from "@exaix/lint-rules";

export default createLintPlugin("exaix", parseCatalog(catalog));
