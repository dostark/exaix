/**
 * @module CheckScenarioDeclarativeTest
 * @path tests/scripts/check_scenario_declarative_test.ts
 * @description Tests for scripts/check_scenario_declarative.ts — the declarative-purity
 *   validator for scenario YAMLs. Verifies the shell-step classifier, that a declarative-only
 *   scenario yields zero violations, that procedural steps are reported with the right category
 *   and line number, and that a multi-file scan aggregates correctly.
 * @architectural-layer Script (test)
 * @dependencies [@std/assert, @std/fs, @std/path]
 * @related-files [scripts/check_scenario_declarative.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import {
  analyzeScenarioYaml,
  classifyShellStep,
  scanFrameworkRawShell,
  scanFrameworkRawShellDir,
  scanScenarioDir,
} from "../../scripts/check_scenario_declarative.ts";

const DECLARATIVE_YAML = `schema_version: "1.0.0"
id: "declarative-only"
pack: "smoke"
portals: []
mode_support: ["auto"]
steps:
  - id: "start-daemon"
    type: "exactl"
    command: "daemon"
    args: ["start"]
  - id: "wait-ready"
    type: "wait-for-journal-event"
    event_type: "daemon.ready"
    timeout_sec: 30
    input_criteria: []
    output_criteria: []
  - id: "assert-created"
    type: "json-assert"
    command: "request"
`;

const PROCEDURAL_YAML = `schema_version: "1.0.0"
id: "procedural"
pack: "smoke"
portals: []
mode_support: ["auto"]
steps:
  - id: "setup-repo"
    type: "shell"
    command: "sh"
    args: ['-c', 'cp -r "$FRAMEWORK_HOME/fixtures/x" "$WORKSPACE_ROOT/todo-app" && git init -q']
  - id: "approve-review"
    type: "shell"
    command: "sh"
    args: ['-c', 'trace_id=$(sqlite3 "$WORKSPACE_ROOT/.exa/journal.db" "SELECT trace_id FROM activity LIMIT 1"); exactl review approve "request-$trace_id"']
  - id: "verify-tests"
    type: "shell"
    command: "sh"
    args: ['-c', 'cd "$WORKSPACE_ROOT/todo-app" && deno test src/']
  - id: "probe-file"
    type: "shell"
    command: "sh"
    args: ['-c', 'test ! -f /tmp/escaped.txt && echo ok']
`;

Deno.test("[scenario-declarative] classifier recognizes each procedural category", () => {
  assertEquals(classifyShellStep("sh", ["-c", `sqlite3 "$WORKSPACE_ROOT/.exa/journal.db" "SELECT 1"`]), "journal-sql");
  assertEquals(classifyShellStep("sh", ["-c", `"$FRAMEWORK_HOME/bin/exactl" review approve request-x`]), "exactl-glue");
  assertEquals(classifyShellStep("sh", ["-c", "cd todo-app && deno test src/"]), "test-run");
  assertEquals(
    classifyShellStep("cp", ["-r", "$FRAMEWORK_HOME/Blueprints", "$WORKSPACE_ROOT/Blueprints"]),
    "sandbox-setup",
  );
  assertEquals(classifyShellStep("sh", ["-c", "sed -i s/a/b/ file.ts"]), "sandbox-setup");
  assertEquals(classifyShellStep("sh", ["-c", "test ! -f /tmp/x && echo nope"]), "filesystem-probe");
  assertEquals(classifyShellStep("sh", ["-c", "true"]), "inline-script");
});

Deno.test("[scenario-declarative] declarative-only scenario has zero violations", () => {
  assertEquals(analyzeScenarioYaml(DECLARATIVE_YAML), []);
});

Deno.test("[scenario-declarative] procedural steps are reported with category and line", () => {
  const violations = analyzeScenarioYaml(PROCEDURAL_YAML);
  assertEquals(violations.length, 4);
  const byId = Object.fromEntries(violations.map((v) => [v.step_id, v]));
  assertEquals(byId["setup-repo"].category, "sandbox-setup");
  assertEquals(byId["approve-review"].category, "journal-sql");
  assertEquals(byId["verify-tests"].category, "test-run");
  assertEquals(byId["probe-file"].category, "filesystem-probe");
  // Line numbers point at the step's `- id:` marker in the raw text.
  assertEquals(byId["setup-repo"].line, 7);
  assertEquals(byId["approve-review"].line, 11);
});

Deno.test("[scenario-declarative] multi-file scan aggregates and reports non-ok", async () => {
  const root = await Deno.makeTempDir({ prefix: "scenario-declarative-" });
  try {
    await ensureDir(join(root, "scenarios", "a"));
    await ensureDir(join(root, "scenarios", "b"));
    await Deno.writeTextFile(join(root, "scenarios", "a", "clean.yaml"), DECLARATIVE_YAML);
    await Deno.writeTextFile(join(root, "scenarios", "b", "dirty.yaml"), PROCEDURAL_YAML);

    const report = await scanScenarioDir(join(root, "scenarios"));
    assertEquals(report.scenariosScanned, 2);
    assertEquals(report.totalSteps, 3 + 4);
    assertEquals(report.ok, false);
    assertEquals(report.violations.length, 4);
    assertEquals(report.categories["journal-sql"], 1);
    assertEquals(report.categories["test-run"], 1);
    assertEquals(report.categories["sandbox-setup"], 1);
    assertEquals(report.categories["filesystem-probe"], 1);
    assertEquals(report.categories["inline-script"], 0);
    assert(report.violations.every((v) => v.file === "a/clean.yaml" || v.file === "b/dirty.yaml"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[scenario-declarative] raw-shell scanner flags low-level binaries but allows deno/exactl", () => {
  const clean = [
    '  const cmd = new Deno.Command("deno", { args, cwd });',
    '  await new Deno.Command(options.exactlExecutable ?? "exactl", { args });',
    "  const svc = new GitService({ config, repoPath });",
    "  await Deno.remove(path, { recursive: true });",
    "  await copy(source, target, { overwrite: true });",
  ].join("\n");
  assertEquals(scanFrameworkRawShell(clean), [], `clean source flagged: ${clean}`);

  const dirty = [
    '  await new Deno.Command("git", { args, cwd });',
    '  const r = await new Deno.Command("sqlite3", { args });',
    '  new Deno.Command("sh", ["-c", "cp x y"]);',
  ].join("\n");
  const violations = scanFrameworkRawShell(dirty);
  assertEquals(violations.length, 3);
  assertEquals(violations.map((v) => v.bin), ["git", "sqlite3", "sh"]);
  assertEquals(violations[0].line, 1);
  assertEquals(violations[1].line, 2);
});

Deno.test("[scenario-declarative] framework raw-shell scan aggregates across files", async () => {
  const root = await Deno.makeTempDir({ prefix: "scenario-rawshell-" });
  try {
    await ensureDir(join(root, "a"));
    await ensureDir(join(root, "b"));
    await Deno.writeTextFile(
      join(root, "a", "ok.ts"),
      '  const cmd = new Deno.Command("deno", { args });\n',
    );
    await Deno.writeTextFile(
      join(root, "b", "dirty.ts"),
      '  const out = await new Deno.Command("git", { args, cwd }).output();\n',
    );
    const report = await scanFrameworkRawShellDir(root);
    assertEquals(report.filesScanned, 2);
    assertEquals(report.ok, false);
    assertEquals(report.violations.length, 1);
    assertEquals(report.violations[0].file, "b/dirty.ts");
    assertEquals(report.violations[0].bin, "git");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
