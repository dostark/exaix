/**
 * @module RequestQualityGateTest
 * @path tests/services/quality_gate/request_quality_gate_test.ts
 * @description Tests for the RequestQualityGate orchestrator service, covering
 * heuristic/hybrid/llm assessment modes, threshold routing, enrichment, activity
 * logging, and the disabled-gate short-circuit.
 * @architectural-layer Services
 * @related-files [src/services/quality_gate/request_quality_gate.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { createMockProvider } from "../../helpers/mock_provider.ts";
import { createOutputValidator } from "../../../src/services/output_validator.ts";
import { RequestQualityRecommendation } from "../../../src/shared/schemas/request_quality_assessment.ts";
import { QualityGateMode } from "../../../src/shared/enums.ts";
import type { IEventLogger } from "../../../src/services/event_logger.ts";
import type { ILogEvent } from "../../../src/services/common/types.ts";
import type { IModelProvider } from "../../../src/ai/types.ts";
import { RequestQualityGate } from "../../../src/services/quality_gate/request_quality_gate.ts";
import { buildQualityGateConfig } from "../../../src/services/quality_gate/request_quality_gate.ts";
import type { IRequestQualityGateConfig } from "../../../src/shared/interfaces/i_request_quality_gate_service.ts";
import {
  DEFAULT_MAX_CLARIFICATION_ROUNDS,
  DEFAULT_QG_ENRICHMENT_THRESHOLD,
  DEFAULT_QG_MINIMUM_THRESHOLD,
  DEFAULT_QG_PROCEED_THRESHOLD,
} from "../../../src/shared/constants.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Config that turns on hybrid mode with default thresholds. */
function makeConfig(
  overrides: Partial<IRequestQualityGateConfig> = {},
): IRequestQualityGateConfig {
  return {
    enabled: true,
    mode: QualityGateMode.HYBRID,
    thresholds: {
      minimum: DEFAULT_QG_MINIMUM_THRESHOLD,
      enrichment: DEFAULT_QG_ENRICHMENT_THRESHOLD,
      proceed: DEFAULT_QG_PROCEED_THRESHOLD,
    },
    autoEnrich: false,
    blockUnactionable: false,
    maxClarificationRounds: 5,
    ...overrides,
  };
}

/** Mock IEventLogger that tracks logged events; class implements IEventLogger structurally. */
class MockEventLogger implements IEventLogger {
  readonly loggedEvents: ILogEvent[] = [];
  log(event: ILogEvent): Promise<void> {
    this.loggedEvents.push(event);
    return Promise.resolve();
  }
  info(_a: string, _t: string | null): Promise<void> {
    return Promise.resolve();
  }
  warn(_a: string, _t: string | null): Promise<void> {
    return Promise.resolve();
  }
  error(_a: string, _t: string | null): Promise<void> {
    return Promise.resolve();
  }
  fatal(_a: string, _t: string | null): Promise<void> {
    return Promise.resolve();
  }
  debug(_a: string, _t: string | null): Promise<void> {
    return Promise.resolve();
  }
  child(_overrides: Partial<ILogEvent>): IEventLogger {
    return this;
  }
}

/** Builds a mock IEventLogger that tracks logged events. */
function createMockEventLogger(): MockEventLogger {
  return new MockEventLogger();
}

/** Returns a valid JSON assessment payload that the LlmQualityAssessor can parse. */
function makeLlmAssessmentResponse(score: number, recommendation: string): string {
  return JSON.stringify({ score, level: "good", issues: [], recommendation });
}
// Requests known to score at specific ranges with the heuristic:
//   HIGH_SCORE (>=70):  action verb + file ref + acceptance criteria
//   MID_SCORE  (20-69): no action verbs, moderate length
//   LOW_SCORE  (<20):   fewer than 20 characters total
const HIGH_SCORE_REQUEST = "Implement JWT validation in src/auth.ts — must return 401 on invalid token";
// score: base 50 + file_ref +15 + acceptance_criteria +20 = 85 → PROCEED
const MID_SCORE_REQUEST = "The authentication system is broken and users cannot log in to the application";
// score: base 50 – no_action_verbs 20 = 30 → NEEDS_CLARIFICATION (in hybrid borderline range)

const LOW_SCORE_REQUEST = "ok"; // < 20 chars → score = 10 → REJECT

// ---------------------------------------------------------------------------
// Mode: heuristic
// ---------------------------------------------------------------------------

Deno.test("[RequestQualityGate] heuristic mode avoids LLM calls", async () => {
  let generateCalled = false;
  const trackingProvider: IModelProvider = {
    id: "tracking",
    generate: (_prompt: string): Promise<string> => {
      generateCalled = true;
      return Promise.resolve(makeLlmAssessmentResponse(75, "proceed"));
    },
  };

  const gate = new RequestQualityGate(
    makeConfig({ mode: QualityGateMode.HEURISTIC }),
    trackingProvider,
    createOutputValidator({}),
  );

  await gate.assess(HIGH_SCORE_REQUEST);
  assertEquals(generateCalled, false);
});

// ---------------------------------------------------------------------------
// Mode: hybrid
// ---------------------------------------------------------------------------

Deno.test("[RequestQualityGate] hybrid mode skips LLM for high scores", async () => {
  let generateCalled = false;
  const trackingProvider: IModelProvider = {
    id: "tracking",
    generate: (_prompt: string): Promise<string> => {
      generateCalled = true;
      return Promise.resolve(makeLlmAssessmentResponse(90, "proceed"));
    },
  };

  const gate = new RequestQualityGate(
    makeConfig({ mode: QualityGateMode.HYBRID }),
    trackingProvider,
    createOutputValidator({}),
  );

  await gate.assess(HIGH_SCORE_REQUEST);
  assertEquals(generateCalled, false);
});

Deno.test("[RequestQualityGate] hybrid mode calls LLM for borderline scores", async () => {
  let generateCalled = false;
  const trackingProvider: IModelProvider = {
    id: "tracking",
    generate: (_prompt: string): Promise<string> => {
      generateCalled = true;
      return Promise.resolve(makeLlmAssessmentResponse(40, "needs-clarification"));
    },
  };

  const gate = new RequestQualityGate(
    makeConfig({ mode: QualityGateMode.HYBRID }),
    trackingProvider,
    createOutputValidator({}),
  );

  await gate.assess(MID_SCORE_REQUEST);
  assertEquals(generateCalled, true);
});

// ---------------------------------------------------------------------------
// Recommendation routing
// ---------------------------------------------------------------------------

Deno.test("[RequestQualityGate] recommends proceed above threshold", async () => {
  const gate = new RequestQualityGate(
    makeConfig({ mode: QualityGateMode.HEURISTIC }),
  );
  const result = await gate.assess(HIGH_SCORE_REQUEST);
  assertEquals(result.recommendation, RequestQualityRecommendation.PROCEED);
});

Deno.test("[RequestQualityGate] recommends auto-enrich in enrichment range", async () => {
  // action verb + file ref, no acceptance criteria keywords → score 65 → AUTO_ENRICH
  const gate = new RequestQualityGate(
    makeConfig({ mode: QualityGateMode.HEURISTIC }),
  );
  const result = await gate.assess("Create a new configuration file at src/config/settings.ts");
  assertEquals(result.recommendation, RequestQualityRecommendation.AUTO_ENRICH);
});

Deno.test("[RequestQualityGate] recommends needs-clarification in poor range", async () => {
  const gate = new RequestQualityGate(
    makeConfig({ mode: QualityGateMode.HEURISTIC }),
  );
  const result = await gate.assess(MID_SCORE_REQUEST);
  assertEquals(result.recommendation, RequestQualityRecommendation.NEEDS_CLARIFICATION);
});

// ---------------------------------------------------------------------------
// AutoEnrich
// ---------------------------------------------------------------------------

Deno.test("[RequestQualityGate] enriches request when autoEnrich enabled", async () => {
  const enrichedText = "Improved: Create config file with full schema validation and defaults";
  const gate = new RequestQualityGate(
    makeConfig({ mode: QualityGateMode.HEURISTIC, autoEnrich: true }),
    createMockProvider([enrichedText]),
    createOutputValidator({}),
  );

  // action verb + file ref → score 65 → AUTO_ENRICH → enrichment triggered
  const result = await gate.assess("Create a new configuration file at src/config/settings.ts");
  assertEquals(result.recommendation, RequestQualityRecommendation.AUTO_ENRICH);
  assertEquals(result.enrichedBody, enrichedText);
});

// ---------------------------------------------------------------------------
// BlockUnactionable
// ---------------------------------------------------------------------------

Deno.test("[RequestQualityGate] blocks unactionable when configured", async () => {
  const gate = new RequestQualityGate(
    makeConfig({ mode: QualityGateMode.HEURISTIC, blockUnactionable: true }),
  );
  const result = await gate.assess(LOW_SCORE_REQUEST);
  assertEquals(result.recommendation, RequestQualityRecommendation.REJECT);
});

// ---------------------------------------------------------------------------
// Activity logging
// ---------------------------------------------------------------------------

Deno.test("[RequestQualityGate] logs quality_assessed activity", async () => {
  const mockLogger = createMockEventLogger();
  const gate = new RequestQualityGate(
    makeConfig({ mode: QualityGateMode.HEURISTIC }),
    undefined,
    undefined,
    mockLogger,
  );

  await gate.assess(HIGH_SCORE_REQUEST, { requestId: "req-123" });

  assertEquals(mockLogger.loggedEvents.length, 1);
  assertExists(mockLogger.loggedEvents[0]);
  assertEquals(mockLogger.loggedEvents[0].action, "request.quality_assessed");
  assertEquals(mockLogger.loggedEvents[0].target, "req-123");
});

// ---------------------------------------------------------------------------
// Disabled gate
// ---------------------------------------------------------------------------

Deno.test("[RequestQualityGate] handles disabled gate (returns proceed)", async () => {
  const gate = new RequestQualityGate(
    makeConfig({ enabled: false }),
  );
  const result = await gate.assess(LOW_SCORE_REQUEST);
  assertEquals(result.recommendation, RequestQualityRecommendation.PROCEED);
});

// ---------------------------------------------------------------------------
// Config wiring — buildQualityGateConfig
// ---------------------------------------------------------------------------

Deno.test("[buildQualityGateConfig] maps enabled flag from config", () => {
  const cfg = buildQualityGateConfig({ enabled: false });
  assertEquals(cfg.enabled, false);
});

Deno.test("[buildQualityGateConfig] maps mode from config", () => {
  const cfg = buildQualityGateConfig({ mode: QualityGateMode.LLM });
  assertEquals(cfg.mode, QualityGateMode.LLM);
});

Deno.test("[buildQualityGateConfig] maps auto_enrich → autoEnrich", () => {
  const cfg = buildQualityGateConfig({ auto_enrich: false });
  assertEquals(cfg.autoEnrich, false);
});

Deno.test("[buildQualityGateConfig] maps block_unactionable → blockUnactionable", () => {
  const cfg = buildQualityGateConfig({ block_unactionable: true });
  assertEquals(cfg.blockUnactionable, true);
});

Deno.test("[buildQualityGateConfig] maps max_clarification_rounds → maxClarificationRounds", () => {
  const cfg = buildQualityGateConfig({ max_clarification_rounds: 3 });
  assertEquals(cfg.maxClarificationRounds, 3);
});

Deno.test("[buildQualityGateConfig] maps thresholds from config", () => {
  const cfg = buildQualityGateConfig({
    thresholds: { minimum: 10, enrichment: 40, proceed: 60 },
  });
  assertEquals(cfg.thresholds.minimum, 10);
  assertEquals(cfg.thresholds.enrichment, 40);
  assertEquals(cfg.thresholds.proceed, 60);
});

Deno.test("[buildQualityGateConfig] uses defaults when fields absent", () => {
  const cfg = buildQualityGateConfig({});
  assertEquals(cfg.enabled, true);
  assertEquals(cfg.mode, QualityGateMode.HYBRID);
  assertEquals(cfg.autoEnrich, true);
  assertEquals(cfg.blockUnactionable, false);
  assertEquals(cfg.maxClarificationRounds, DEFAULT_MAX_CLARIFICATION_ROUNDS);
  assertEquals(cfg.thresholds.minimum, DEFAULT_QG_MINIMUM_THRESHOLD);
  assertEquals(cfg.thresholds.enrichment, DEFAULT_QG_ENRICHMENT_THRESHOLD);
  assertEquals(cfg.thresholds.proceed, DEFAULT_QG_PROCEED_THRESHOLD);
});
