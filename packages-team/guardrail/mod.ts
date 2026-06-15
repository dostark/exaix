/**
 * @module TeamGuardrail
 * @path packages-team/guardrail/mod.ts
 * @description Team-edition guardrail package — concurrent GuardrailRunner that screens agent
 *   output against configurable policies. Implementation of IGuardrailRunner (Phase 107).
 * @ungrounded
 * @architectural-layer Services
 * @dependencies []
 * @related-files [packages/execution/src/guardrail_runner.ts, packages-team/guardrail/src/guardrail_runner.ts]
 */

export { GuardrailRunner } from "./src/guardrail_runner.ts";
