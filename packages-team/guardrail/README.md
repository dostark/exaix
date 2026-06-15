# @exaix-team/guardrail

Team-edition concurrent guardrail runner (Phase 107). Screens agent output
against configurable policies using a fast-slot LLM, running in parallel with
the primary agent.

## Usage

```typescript
import { GuardrailRunner } from "@exaix-team/guardrail";

const runner = new GuardrailRunner(config.guardrail, screeningProvider, logger);
const incidents = await runner.screen(agentOutput, traceId, iteration);
if (runner.hasBlockingViolation(traceId)) {
  // halt via Plan Amendment gate
}
```

## Edition

Team/Enterprise only. The runner is never constructed in Solo builds — the
`EXAIX_EDITION` check in `PlanExecutor.createAgentExecutor()` prevents it.
