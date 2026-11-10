#!/usr/bin/env -S deno run -A
/**
 * @module PlanningWorkspace
 * @path tests/scenario_framework/runner/planning_workspace.ts
 * @description Prepares a planning fixture with an isolated dogfood skill root and config.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/planning_workspace_security_test.ts]
 * Usage: deno run -A tests/scenario_framework/runner/planning_workspace.ts <workspace-root> <case-id>
 */
import { copy } from "@std/fs";
import { join } from "@std/path";
import { parse, stringify } from "@std/toml";
import { z } from "zod";
import { PathResolver } from "@exaix/portal";
import { createMockConfig, REPO_ROOT } from "@exaix/testing";
import { resolveCellConfig } from "./matrix_expander.ts";

/** Prepares an existing, scenario-owned case fixture without touching the source checkout. */
export async function preparePlanningWorkspace(root: string, caseId: string): Promise<{
  worktree: string;
  configPath: string;
}> {
  const match = /^p234-s([136])-c[1-5]$/.exec(caseId);
  if (!match) throw new Error("Invalid planning case");
  const skills = { "1": "fix-bug", "3": "test-development", "6": "plan" };
  const skill = skills[match[1] as keyof typeof skills];
  const fixture = match[1] === "6" ? caseId : `p234-s${match[1]}`;
  if (/["\\\r\n]/.test(root)) throw new Error("Unsupported workspace path");
  const resolver = new PathResolver(createMockConfig(root));
  const worktree = await resolver.validatePath(join(root, fixture), [root]);
  if (!(await Deno.stat(worktree)).isDirectory) throw new Error("Planning worktree is not a directory");
  const target = await resolver.validatePath(join(worktree, ".copilot/skills", skill), [worktree]);
  const configPath = await resolver.validatePath(join(root, "exa.config.toml"), [root]);
  const preset = await Deno.readTextFile(join(REPO_ROOT, "configs/dogfood.toml"));
  const base = parse(resolveCellConfig(preset, { workspaceRoot: root, worktreePath: worktree }));
  const codexCase = /^p234-s3-c[124]$/.test(caseId) || match[1] === "6" || caseId === "p234-s1-c2";
  const livePreset = codexCase ? "configs/dogfood.codex-terra-61.toml" : "configs/dogfood.claude-sonnet.toml";
  const live = parse(await Deno.readTextFile(join(REPO_ROOT, livePreset)));
  const systemSchema = z.object({ allow_net: z.array(z.string()) }).passthrough();
  const system = systemSchema.parse(base.system);
  const liveSystem = systemSchema.parse(live.system);
  const config = {
    ...base,
    system: { ...system, allow_net: [...new Set([...system.allow_net, ...liveSystem.allow_net])] },
    ai: live.ai,
    models: live.models,
    agents: live.agents,
    model_presets: live.model_presets,
    request_analysis: live.request_analysis,
    ...(live.cli_delegate ? { cli_delegate: live.cli_delegate } : {}),
  };
  await copy(join(REPO_ROOT, ".copilot/skills", skill), target);
  await Deno.writeTextFile(configPath, stringify(config));
  return { worktree, configPath };
}

if (import.meta.main) {
  const [root, caseId] = Deno.args;
  if (!root || !caseId) throw new Error("Provide workspace and planning case identity");
  console.log(JSON.stringify(await preparePlanningWorkspace(root, caseId)));
}
