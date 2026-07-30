/**
 * @module DogfoodClaudeOpenrouterPresetTest
 * @path tests/integration/dogfood_claude_openrouter_preset_test.ts
 * @description Phase 127 Step 1 — verifies the new configs/dogfood.claude.openrouter.toml
 *   preset (the claude-code+openrouter matrix cell) parses against ConfigSchema and
 *   selects the OpenRouter realm via [session_delegate.provider]. Pins the OpenRouter-Claude
 *   1P caveat (GAP-4): the delegate model is an Anthropic slug; the provider block uses only
 *   the real {name, key_env, base_url} fields (no fictional provider.order). The empty
 *   ANTHROPIC_API_KEY (GAP-5) is runtime-injected by resolveDelegateEnv and is already
 *   asserted in packages/session/tests/session_delegate_provider_env_test.ts:52.
 * @architectural-layer Integration
 * @dependencies [@exaix/schemas, @std/toml, @std/path]
 * @related-files [packages/session/src/session_delegate_service.ts, packages/schemas/src/config.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { fromFileUrl, join } from "@std/path";
import { ConfigSchema } from "@exaix/schemas/config.ts";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const PRESET_PATH = join(REPO_ROOT, "configs", "dogfood.claude.openrouter.toml");

const ANTHROPIC_MODEL_PREFIX = "claude-";

Deno.test("[delegate_matrix] dogfood.claude.openrouter.toml parses against the config schema", async () => {
  const raw = await Deno.readTextFile(PRESET_PATH);
  const parsed = ConfigSchema.parse(parseToml(raw));

  assertEquals(parsed.session_delegate?.enabled, true);
  assertEquals(parsed.session_delegate?.tool, "claude-code");
  assertEquals(parsed.session_delegate?.launch_mode, "headless");
  assertEquals(parsed.session_delegate?.gates, ["code_changes"]);
});

Deno.test("[delegate_matrix] preset selects the OpenRouter realm via session_delegate.provider", async () => {
  const raw = await Deno.readTextFile(PRESET_PATH);
  const parsed = ConfigSchema.parse(parseToml(raw));

  const provider = parsed.session_delegate?.provider;
  assertEquals(provider?.name, "openrouter");
  assertEquals(provider?.key_env, "OPENROUTER_API_KEY");
  assertEquals(provider?.base_url, "https://openrouter.ai/api");
});

Deno.test("[delegate_matrix] preset uses only real provider fields — no fictional provider.order (GAP-4)", async () => {
  const raw = await Deno.readTextFile(PRESET_PATH);
  const parsed = ConfigSchema.parse(parseToml(raw));
  // SessionDelegateProviderSchema is {name, key_env, base_url} only. The parsed provider
  // block must carry exactly those keys — no `order` / routing field (the unimplementable
  // pin the pre-gap analysis removed). Asserting on the parsed object (not raw text) avoids
  // false positives from explanatory comments that mention `provider.order`.
  const provider = parsed.session_delegate?.provider ?? {};
  assertEquals(
    Object.keys(provider).sort(),
    ["base_url", "key_env", "name"],
    "delegate provider block must declare only {name, key_env, base_url} — no provider.order",
  );
});

Deno.test("[delegate_matrix] the claude.openrouter preset's session_delegate.model is an Anthropic slug (1P caveat)", async () => {
  const raw = await Deno.readTextFile(PRESET_PATH);
  const parsed = ConfigSchema.parse(parseToml(raw));

  const model = parsed.session_delegate?.model ?? "";
  // The config carries provider:model (colon) form; strip the provider prefix
  const slug = model.includes(":") ? model.slice(model.indexOf(":") + 1) : model;
  assert(
    slug.startsWith(ANTHROPIC_MODEL_PREFIX),
    `claude-code+openrouter delegate model must be an Anthropic slug (the OpenRouter 1P caveat); got "${model}"`,
  );
});
