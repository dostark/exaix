/**
 * @module DogfoodOpenrouterPresetTest
 * @path tests/integration/dogfood_openrouter_preset_test.ts
 * @description Verifies configs/dogfood.openrouter.toml (the opencode+openrouter matrix cell)
 *   parses against ConfigSchema, selects the OpenRouter realm, and carries a delegate model in the
 *   `provider:model` form that prepareBrief requires. A bare id abandons the code_changes step
 *   with `delegation launch failed` before the delegate spawns.
 * @architectural-layer Integration
 * @dependencies [@exaix/schemas, @std/toml, @std/path]
 * @related-files [packages/session/src/session_delegate_service.ts, packages/session/src/session_adapter_registry.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { fromFileUrl, join } from "@std/path";
import { ConfigSchema } from "@exaix/schemas/config.ts";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const PRESET_PATH = join(REPO_ROOT, "configs", "dogfood.openrouter.toml");

async function loadPreset() {
  return ConfigSchema.parse(parseToml(await Deno.readTextFile(PRESET_PATH)));
}

Deno.test("[delegate_matrix] dogfood.openrouter.toml selects opencode on the OpenRouter realm", async () => {
  const parsed = await loadPreset();

  assertEquals(parsed.session_delegate?.enabled, true);
  assertEquals(parsed.session_delegate?.tool, "opencode");
  assertEquals(parsed.session_delegate?.provider?.name, "openrouter");
  assertEquals(parsed.session_delegate?.provider?.key_env, "OPENROUTER_API_KEY");
});

Deno.test("[delegate_matrix] dogfood.openrouter.toml delegate model is a provider:model id opencode resolves", async () => {
  const parsed = await loadPreset();

  const model = parsed.session_delegate?.model ?? "";
  assert(model.includes(":"), `delegate model must be provider:model, got "${model}"`);
  // opencode --model takes provider/model, and OpenRouter slugs are vendor/model.
  assert(
    model.startsWith("openrouter:") && model.split("/").length === 2,
    `opencode+openrouter delegate model must be openrouter:<vendor>/<model>, got "${model}"`,
  );
});
