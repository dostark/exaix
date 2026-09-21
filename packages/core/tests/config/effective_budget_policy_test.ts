/**
 * @module EffectiveBudgetPolicyTest
 * @path packages/core/tests/config/effective_budget_policy_test.ts
 * @description Verifies canonical prompt-budget policy resolution across TOML and Config DB.
 * @architectural-layer Test
 * @related-files [packages/core/src/config/effective_budget_policy.ts]
 */

import { assertEquals } from "@std/assert";
import { resolveEffectiveBudgetPolicy } from "@exaix/core/config";
import { ConfigSchema } from "@exaix/schemas/config.ts";

Deno.test("[budget config] Config DB override wins over public TOML and legacy policy", () => {
  const config = ConfigSchema.parse({
    system: {},
    budget: { cost_target_tokens_per_request: 10_000 },
    budget_enforcement: { costTargetTokens: 20_000 },
  });
  const overrideReader = {
    get<T>(key: string): T | undefined {
      assertEquals(key, "budget.cost_target_tokens_per_request");
      return 30_000 as T;
    },
  };

  assertEquals(resolveEffectiveBudgetPolicy(config, overrideReader).costTargetTokens, 30_000);
});

Deno.test("[budget config] public TOML wins over the legacy camelCase compatibility field", () => {
  const config = ConfigSchema.parse({
    system: {},
    budget: { cost_target_tokens_per_request: 10_000 },
    budget_enforcement: { costTargetTokens: 20_000 },
  });

  assertEquals(resolveEffectiveBudgetPolicy(config).costTargetTokens, 10_000);
});

Deno.test("[budget config] unset public ceiling preserves the legacy policy", () => {
  const config = ConfigSchema.parse({
    system: {},
    budget_enforcement: { cloud: false, local: true, costTargetTokens: 20_000 },
  });

  assertEquals(resolveEffectiveBudgetPolicy(config), {
    cloud: false,
    local: true,
    enabled: undefined,
    costTargetTokens: 20_000,
  });
});
