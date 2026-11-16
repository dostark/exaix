/**
 * @module ProviderSettingsDriftTest
 * @path tests/docs/provider_settings_drift_test.ts
 * @description Verifies that the committed provider settings reference equals what the binding catalog, the preset rows and the scenario files render now, and that each free-standing variable of the page is still read by the file that the page names.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, scripts/generate_provider_settings.ts]
 * @related-files ["scripts/generate_provider_settings.ts"]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  OTHER_VARIABLES,
  PROVIDER_SETTINGS_DOC,
  renderProviderSettings,
} from "../../scripts/generate_provider_settings.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const REGENERATE_HINT = "Run `deno task docs:providers` and commit the result.";

Deno.test("[provider settings] the committed reference equals what the catalog, the presets and the scenarios render", async () => {
  const committed = await Deno.readTextFile(PROVIDER_SETTINGS_DOC);
  assertEquals(committed, await renderProviderSettings(), REGENERATE_HINT);
});

Deno.test("[provider settings] every free-standing variable is still read by the file that the page names", async () => {
  for (const variable of OTHER_VARIABLES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, variable.readBy));
    assertStringIncludes(text, variable.name, `${variable.readBy} no longer names ${variable.name}`);
  }
});

Deno.test("[provider settings] the User Guide points to the reference", async () => {
  const guide = await Deno.readTextFile(join(REPO_ROOT, "docs", "Exaix_User_Guide.md"));
  assertStringIncludes(guide, "Exaix_Provider_Settings.md");
});
