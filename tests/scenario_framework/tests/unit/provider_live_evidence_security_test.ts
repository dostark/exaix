/**
 * @module ProviderLiveEvidenceSecurityTest
 * @path tests/scenario_framework/tests/unit/provider_live_evidence_security_test.ts
 * @description Verifies that binding evidence rejects scenario paths before writing files.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/provider_live_evidence.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import { writeProviderLiveEvidence } from "../../runner/provider_live_evidence.ts";

Deno.test("[security] binding evidence rejects scenario path traversal before writing", async () => {
  const outputDir = await Deno.makeTempDir();
  try {
    for (const scenarioId of ["../escape", "nested/scenario", "scenario\\escape"]) {
      await assertRejects(
        () =>
          writeProviderLiveEvidence({
            scenarioId,
            outputDir,
            configPath: `${outputDir}/exa.config.toml`,
            activities: [],
            outcome: "success",
            suiteScore: 1,
            exitCode: 0,
          }),
        Error,
        "Invalid scenario ID",
      );
    }
    assertEquals(Array.from(Deno.readDirSync(outputDir)), []);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});
