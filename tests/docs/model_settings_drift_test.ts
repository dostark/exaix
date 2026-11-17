/**
 * @module ModelSettingsDriftTest
 * @path tests/docs/model_settings_drift_test.ts
 * @description Verifies that the generated blocks of the committed Model Settings page equal what the binding catalog, the preset rows and the scenario files render now, and that each free-standing variable of the page is still read by the file that the page names.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, scripts/generate_model_settings.ts]
 * @related-files ["scripts/generate_model_settings.ts"]
 */

import { assertEquals, assertNotMatch, assertStringIncludes } from "@std/assert";
import { readUserGuide } from "./helpers.ts";
import { join } from "@std/path";
import { MODEL_SETTINGS_DOC, OTHER_VARIABLES, renderModelSettings } from "../../scripts/generate_model_settings.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const REGENERATE_HINT = "Run `deno task docs:models` and commit the result.";

Deno.test("[model settings] the generated blocks equal what the catalog, the presets and the scenarios render", async () => {
  const committed = await Deno.readTextFile(MODEL_SETTINGS_DOC);
  assertEquals(committed, await renderModelSettings(committed), REGENERATE_HINT);
});

Deno.test("[model settings] every free-standing variable is still read by the file that the page names", async () => {
  for (const variable of OTHER_VARIABLES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, variable.readBy));
    assertStringIncludes(text, variable.name, `${variable.readBy} no longer names ${variable.name}`);
  }
});

Deno.test("[model settings] the User Guide points to the page and no longer holds the moved sections", async () => {
  const guide = await readUserGuide();
  assertStringIncludes(guide, "Model_Settings.md");
  assertNotMatch(guide, /#### 2\.4\.1 API Key Configuration/);
});
