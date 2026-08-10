/**
 * @module ExternalTemplateMechanicsTest
 * @path tests/scenario_framework/tests/unit/external_template_mechanics_test.ts
 * @description CI-safe, docker-free, token-free proof of external_bench_task's template
 *   mechanics: the rendered scenario carries the right step shape (delegate + verify-tests,
 *   no process/daemon steps — bare-cell shaped, per Architecture Notes), the right tags,
 *   sentinel-based portal mounting (never a hardcoded todo-app path), and the request
 *   fixture is threaded through to the delegate step as the content sentinel — mirroring
 *   bare_cell_scoring_test.ts's existing structural-assertion pattern for the swe_tasks bare
 *   template. Phase 144 Step 2.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_templates.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { renderExternalBenchTaskTemplate } from "../../runner/scenario_templates.ts";

const REQUEST_FIXTURE = "fixtures/requests/external/log-summary.md";

function render() {
  return renderExternalBenchTaskTemplate({
    id: "external-log-summary",
    title: "External: Terminal-Bench log-summary",
    requestFixture: REQUEST_FIXTURE,
    portalDir: "external/terminal_bench/log-summary",
    oracleTestsDir: "log-summary/oracle_tests",
    scopedTestCmd: "cd /app && pytest tests/test_outputs.py -rA",
    tool: "claude-code",
    benchmarkVersion: "d28711d0da2675d0bb1d56de45ae5df6082438a3",
    scoringWeights: { tests_pass: 0.5 },
  });
}

Deno.test("[ExternalTemplateMechanics] renders a credential-staging setup step before delegate + verify-tests, no process/daemon steps", () => {
  const yaml = render();
  const parsed = parseYaml(yaml) as { steps: Array<{ id: string }> };
  const ids = parsed.steps.map((s) => s.id);
  assertEquals(ids, ["stage-claude-credentials", "bare-delegate", "verify-tests"]);
});

Deno.test("[ExternalTemplateMechanics] the credential-staging step re-stages into a STABLE, gitignored path — never a generation-time-random temp dir that would go stale before a later re-run", () => {
  const yaml = render();
  assert(
    yaml.includes("$FRAMEWORK_HOME/output/.eval-jail-creds/claude"),
    "the staging step and the delegate's mount must reference the same stable, run-time-expanded path",
  );
  assert(
    !yaml.includes("eval-jail-creds-") || !/eval-jail-creds-[0-9a-f]{16,}/.test(yaml),
    "must never bake a Deno.makeTempDirSync()-style random suffix into the persisted scenario YAML",
  );
});

Deno.test("[ExternalTemplateMechanics] carries the bench:terminal-bench, bench-version, docker, and provider-live tags", () => {
  const yaml = render();
  const parsed = parseYaml(yaml) as { tags: string[] };
  assertEquals(
    parsed.tags.sort(),
    [
      "bench-version:d28711d0da2675d0bb1d56de45ae5df6082438a3",
      "bench:terminal-bench",
      "docker",
      "provider-live",
    ],
  );
});

Deno.test("[ExternalTemplateMechanics] pack is external_terminal_bench, distinct from the internal swe_tasks pack", () => {
  const yaml = render();
  const parsed = parseYaml(yaml) as { pack: string };
  assertEquals(parsed.pack, "external_terminal_bench");
});

Deno.test("[ExternalTemplateMechanics] the portal mount is sentinel-based against the given portalDir — never the hardcoded todo-app path", () => {
  const yaml = render();
  assert(
    yaml.includes("$FRAMEWORK_HOME/fixtures/portals/external/terminal_bench/log-summary"),
    "mount source must reference the given external portal directory",
  );
  assert(!yaml.includes("todo-app"), "external tasks must never mount the internal todo-app fixture");
});

Deno.test("[ExternalTemplateMechanics] the request fixture content sentinel is threaded into the delegate step", () => {
  const yaml = render();
  assert(yaml.includes("$REQUEST_FIXTURE_CONTENT"), "delegate args must carry the content sentinel");
  assert(yaml.includes(`request_fixture: "${REQUEST_FIXTURE}"`), "request_fixture must be set to the given fixture");
});

Deno.test("[ExternalTemplateMechanics] the verify step runs the task's own scoped_test_cmd inside the same jailed mount, unmodified", () => {
  const yaml = render();
  assert(
    yaml.includes("cd /app && pytest tests/test_outputs.py -rA"),
    "verify step must run the benchmark's own scoped_test_cmd verbatim — no Exaix-authored assertions (Design Decision 3)",
  );
});

Deno.test("[ExternalTemplateMechanics] an unsupported tool throws at render time, not a silent no-op", () => {
  let threw = false;
  try {
    renderExternalBenchTaskTemplate({
      id: "x",
      title: "x",
      requestFixture: REQUEST_FIXTURE,
      portalDir: "external/terminal_bench/x",
      oracleTestsDir: "x/oracle_tests",
      scopedTestCmd: "true",
      tool: "not-a-real-tool",
      benchmarkVersion: "d28711d0da2675d0bb1d56de45ae5df6082438a3",
    });
  } catch {
    threw = true;
  }
  assert(threw, "an unknown delegate tool must fail loudly at template-render time");
});
