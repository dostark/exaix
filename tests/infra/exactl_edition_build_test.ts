/**
 * @module ExaCtlEditionBuildTest
 * @path tests/infra/exactl_edition_build_test.ts
 * @description Verifies compiled CLI edition help and source dependency-graph isolation.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/fs]
 * @related-files [scripts/ci.ts, apps/exactl/main.ts, exaix-team/apps/exactl/main.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";

const ROOT = Deno.cwd();
const TARGET = Deno.build.target;
const SOLO_BINARY = join(ROOT, "dist", "bin", `exactl-solo-${TARGET}`);
const TEAM_BINARY = join(ROOT, "dist", "bin", `exactl-team-${TARGET}`);

async function ensureEditionBuild(edition: "solo" | "team", binary: string): Promise<void> {
  if (await exists(binary)) return;
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "scripts/ci.ts", "build", "--compile", "--edition", edition, "--targets", TARGET],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
}

async function journalHelp(binary: string): Promise<string> {
  const output = await new Deno.Command(binary, { args: ["journal", "--help"], stdout: "piped", stderr: "piped" })
    .output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout);
}

Deno.test("compiled exactl editions isolate the Team OTel command by graph and dispatch", async () => {
  await ensureEditionBuild("solo", SOLO_BINARY);
  await ensureEditionBuild("team", TEAM_BINARY);

  const soloHelp = await journalHelp(SOLO_BINARY);
  const teamHelp = await journalHelp(TEAM_BINARY);
  assertEquals(soloHelp.includes("export-otel"), false);
  assertStringIncludes(teamHelp, "export-otel");

  const info = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", "apps/exactl/main.ts"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(info.code, 0, new TextDecoder().decode(info.stderr));
  const graph = JSON.parse(new TextDecoder().decode(info.stdout)) as { modules: Array<{ specifier: string }> };
  assert(
    graph.modules.every((module) => !module.specifier.includes("exaix-team/packages/otel-export")),
    "Solo exactl graph must not contain the Team OTel exporter module",
  );
});
