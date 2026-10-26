/**
 * @module CiSubmoduleInitTest
 * @path tests/scripts/ci_submodule_init_test.ts
 * @description Checks that every CI job that initializes the exaix-team submodule also initializes unslop-ts, that no workflow gives unslop-ts a secret, and that the Dockerfile copies it.
 * @architectural-layer Tooling
 * @dependencies [@std/assert, @std/path, @std/yaml]
 * @related-files [tests/scripts/ci_wiring_test.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");
const TEAM_INIT = "git submodule update --init --depth 1 exaix-team";
const TEAM_INIT_ANY = /git submodule update --init[^\n]*exaix-team/;
const ENGINE_INIT = "git submodule update --init --depth 1 unslop-ts";
const ENGINE_STEP_NAME = "Init unslop-ts submodule";
const EXPECTED_JOB_COUNT = 12;

async function pathExists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true).catch(() => false);
}

const HAS_WORKFLOWS = await pathExists(WORKFLOWS_DIR);
const HAS_DOCKER_FILES = await pathExists(join(REPO_ROOT, "Dockerfile")) &&
  await pathExists(join(REPO_ROOT, ".dockerignore"));
const HAS_DEVCONTAINER = await pathExists(join(REPO_ROOT, ".devcontainer", "devcontainer.json"));
if (!HAS_WORKFLOWS || !HAS_DOCKER_FILES || !HAS_DEVCONTAINER) {
  console.warn(
    "ci_submodule_init_test ignores the tests whose files are absent: .github, Dockerfile, or .devcontainer.",
  );
}

interface IStep {
  readonly name?: string;
  readonly run?: string;
}

interface IWorkflow {
  readonly jobs?: { readonly [job: string]: { readonly steps?: readonly IStep[] } };
}

interface IJobRef {
  readonly file: string;
  readonly job: string;
  readonly steps: readonly IStep[];
}

async function workflowJobs(): Promise<IJobRef[]> {
  const jobs: IJobRef[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".yml")) continue;
    const workflow = parse(await Deno.readTextFile(join(WORKFLOWS_DIR, entry.name))) as IWorkflow;
    for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
      jobs.push({ file: entry.name, job, steps: definition.steps ?? [] });
    }
  }
  return jobs;
}

function initsTeam(job: IJobRef): boolean {
  return job.steps.some((step) => TEAM_INIT_ANY.test(step.run ?? ""));
}

Deno.test({
  name: "every job that inits the team submodule also inits unslop-ts, after it",
  ignore: !HAS_WORKFLOWS,
  fn: async () => {
    const teamJobs = (await workflowJobs()).filter(initsTeam);
    assertEquals(teamJobs.length, EXPECTED_JOB_COUNT);
    const missing: string[] = [];
    for (const job of teamJobs) {
      const teamIndex = job.steps.findIndex((step) => TEAM_INIT_ANY.test(step.run ?? ""));
      const engineIndex = job.steps.findIndex((step) => step.run?.trim() === ENGINE_INIT);
      if (engineIndex <= teamIndex) missing.push(`${job.file}:${job.job}`);
    }
    assertEquals(missing, []);
  },
});

Deno.test({
  name: "the unslop-ts step is named alike in every job and carries no token",
  ignore: !HAS_WORKFLOWS,
  fn: async () => {
    for (const job of (await workflowJobs()).filter(initsTeam)) {
      const step = job.steps.find((candidate) => candidate.run?.includes("unslop-ts"));
      assertEquals(step?.name, ENGINE_STEP_NAME, `${job.file}:${job.job}`);
      assertEquals(step?.run?.includes("secrets."), false, `${job.file}:${job.job} must not pass a secret`);
    }
  },
});

Deno.test({
  name: "no workflow references an unslop-ts secret",
  ignore: !HAS_WORKFLOWS,
  fn: async () => {
    const offenders: string[] = [];
    for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
      if (!entry.name.endsWith(".yml")) continue;
      const text = await Deno.readTextFile(join(WORKFLOWS_DIR, entry.name));
      const lines = text.split("\n").filter((line) => /unslop/i.test(line) && line.includes("secrets."));
      if (lines.length > 0) offenders.push(entry.name);
    }
    assertEquals(offenders, []);
  },
});

Deno.test({
  name: "the Dockerfile copies unslop-ts into the builder and warms it in the dev-test cache",
  ignore: !HAS_DOCKER_FILES,
  fn: async () => {
    const dockerfile = await Deno.readTextFile(join(REPO_ROOT, "Dockerfile"));
    const builder = dockerfile.slice(dockerfile.indexOf("AS builder"), dockerfile.indexOf("AS cli-claude"));
    assertStringIncludes(builder, "COPY unslop-ts/ unslop-ts/");
    assertStringIncludes(builder, "COPY exaix-team/ exaix-team/");
    const devTest = dockerfile.slice(dockerfile.indexOf("AS dev-test"));
    assertStringIncludes(devTest, "unslop-ts/mod.ts");
    assertStringIncludes(devTest, "unslop-ts/src");
    assertStringIncludes(devTest, "COPY docs/CODE_STYLE.md docs/CODE_STYLE.md");
    const dockerignore = await Deno.readTextFile(join(REPO_ROOT, ".dockerignore"));
    assertStringIncludes(dockerignore, "!docs/CODE_STYLE.md");
  },
});

Deno.test({
  name: "the team-submodule step text is the same in every job, so the unslop-ts step can follow it",
  ignore: !HAS_WORKFLOWS,
  fn: async () => {
    const texts = new Set<string>();
    for (const job of (await workflowJobs()).filter(initsTeam)) {
      const step = job.steps.find((candidate) => TEAM_INIT_ANY.test(candidate.run ?? ""));
      texts.add((step?.run ?? "").includes(TEAM_INIT) ? "standard" : `${job.file}:${job.job}`);
    }
    assertEquals([...texts], ["standard"]);
  },
});

Deno.test({
  name: "the devcontainer initializes unslop-ts in onCreateCommand, before updateContentCommand needs it",
  ignore: !HAS_DEVCONTAINER,
  fn: async () => {
    const text = await Deno.readTextFile(join(REPO_ROOT, ".devcontainer", "devcontainer.json"));
    const onCreate = /"onCreateCommand":\s*"([^"]*)"/.exec(text)?.[1] ?? "";
    assertStringIncludes(onCreate, "git submodule update --init unslop-ts");
    assertEquals(text.indexOf('"onCreateCommand"') < text.indexOf('"updateContentCommand"'), true);
  },
});
