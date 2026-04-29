/**
 * @module ScenarioFrameworkStepExecutor
 * @path tests/scenario_framework/runner/step_executor.ts
 * @description Executes individual scenario steps for the initial Step 3
 * execution core, capturing stdout, stderr, exit code, timestamps, and
 * combined output for shell and exactl step kinds.
 * Supports wait-for-file steps with polling and timeout.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/config.ts, tests/scenario_framework/tests/unit/scenario_loader_execution_core_test.ts]
 */

import { type IScenarioStep, ScenarioStepType } from "../schema/step_schema.ts";
import { globToRegExp, relative, resolve } from "@std/path";

export interface IExecuteScenarioStepOptions {
  step: IScenarioStep;
  exactlExecutable?: string;
  cwd?: string;
  env?: { [key: string]: string };
  verbose?: boolean;
}

export interface IScenarioStepExecutionResult {
  stepId: string;
  stepType: IScenarioStep["type"];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  combinedOutput: string;
}

const TEXT_DECODER = new TextDecoder();
const WHITESPACE_PATTERN = /\s+/;
const WAIT_FOR_FILE_POLL_INTERVAL_MS = 2000; // Check every 2 seconds

export async function executeScenarioStep(
  options: IExecuteScenarioStepOptions,
): Promise<IScenarioStepExecutionResult> {
  const startedAtEpochMs = Date.now();
  const startedAt = new Date(startedAtEpochMs).toISOString();

  // Handle wait-for-file step type with polling
  if (options.step.type === ScenarioStepType.WAIT_FOR_FILE) {
    return await executeWaitForFileStep(options, startedAt, startedAtEpochMs);
  }

  const commandSpec = buildCommandSpec(options);

  if (options.verbose) {
    console.log(`\n%c > ${commandSpec.executable} ${commandSpec.args.join(" ")}`, "color: green; font-weight: bold;");
  }

  const output = await new Deno.Command(commandSpec.executable, {
    args: commandSpec.args,
    cwd: options.cwd,
    env: options.env,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();

  const completedAtEpochMs = Date.now();
  const completedAt = new Date(completedAtEpochMs).toISOString();
  const stdout = TEXT_DECODER.decode(output.stdout);
  const stderr = TEXT_DECODER.decode(output.stderr);

  return {
    stepId: options.step.id,
    stepType: options.step.type,
    startedAt,
    completedAt,
    durationMs: completedAtEpochMs - startedAtEpochMs,
    exitCode: output.code,
    stdout,
    stderr,
    combinedOutput: `${stdout}${stderr}`,
  };
}

async function executeWaitForFileStep(
  options: IExecuteScenarioStepOptions,
  startedAt: string,
  startedAtEpochMs: number,
): Promise<IScenarioStepExecutionResult> {
  const timeoutSec = options.step.timeout_sec ?? 120; // Default 2 minutes
  const pathPattern = options.step.args?.[0] || "**/*_analysis.json";
  const workspaceRoot = options.cwd || Deno.cwd();
  const timeoutMs = timeoutSec * 1000;

  const pattern = globToRegExp(pathPattern);
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Search for matching files
    const found = await findMatchingFiles(workspaceRoot, pattern);

    if (found.length > 0) {
      const completedAtEpochMs = Date.now();
      const completedAt = new Date(completedAtEpochMs).toISOString();

      if (options.verbose) {
        console.log(
          `\n%c > File found after ${completedAtEpochMs - startedAtEpochMs}ms: ${found[0]}`,
          "color: green; font-weight: bold;",
        );
      }

      return {
        stepId: options.step.id,
        stepType: options.step.type,
        startedAt,
        completedAt,
        durationMs: completedAtEpochMs - startedAtEpochMs,
        exitCode: 0,
        stdout: `File found: ${found[0]}`,
        stderr: "",
        combinedOutput: `File found: ${found[0]}`,
      };
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_FILE_POLL_INTERVAL_MS));
  }

  // Timeout reached
  const completedAtEpochMs = Date.now();
  const completedAt = new Date(completedAtEpochMs).toISOString();

  if (options.verbose) {
    console.log(`\n%c > Timeout after ${timeoutMs}ms waiting for: ${pathPattern}`, "color: red; font-weight: bold;");
  }

  return {
    stepId: options.step.id,
    stepType: options.step.type,
    startedAt,
    completedAt,
    durationMs: completedAtEpochMs - startedAtEpochMs,
    exitCode: 1,
    stdout: "",
    stderr: `Timeout after ${timeoutSec}s waiting for file matching: ${pathPattern}`,
    combinedOutput: `Timeout after ${timeoutSec}s waiting for file matching: ${pathPattern}`,
  };
}

async function findMatchingFiles(root: string, pattern: RegExp): Promise<string[]> {
  const matches: string[] = [];
  const workspaceRoot = root;

  try {
    for await (const entry of Deno.readDir(root)) {
      await checkEntry(entry, root, pattern, matches, workspaceRoot);
    }
  } catch {
    // Directory not accessible
  }

  return matches;
}

async function checkEntry(
  entry: Deno.DirEntry,
  basePath: string,
  pattern: RegExp,
  matches: string[],
  workspaceRoot: string,
): Promise<void> {
  const fullPath = resolve(basePath, entry.name);
  const relPath = relative(workspaceRoot, fullPath);

  if (entry.isFile && (pattern.test(entry.name) || pattern.test(relPath))) {
    matches.push(fullPath);
    return;
  }

  if (entry.isDirectory && !entry.name.startsWith(".")) {
    try {
      for await (const subEntry of Deno.readDir(fullPath)) {
        await checkEntry(subEntry, fullPath, pattern, matches, workspaceRoot);
      }
    } catch {
      // Directory not accessible
    }
  }
}

interface ICommandSpec {
  executable: string;
  args: string[];
}

function buildCommandSpec(options: IExecuteScenarioStepOptions): ICommandSpec {
  if (options.step.type === ScenarioStepType.SHELL) {
    if (!options.step.command) {
      throw new Error(`shell step requires a command: ${options.step.id}`);
    }

    return {
      executable: options.step.command,
      args: options.step.args ?? [],
    };
  }

  if (options.step.type === ScenarioStepType.EXACTL) {
    if (!options.step.command) {
      throw new Error(`exactl step requires a command: ${options.step.id}`);
    }

    return {
      executable: options.exactlExecutable ?? "exactl",
      args: [...tokenizeCommand(options.step.command), ...(options.step.args ?? [])],
    };
  }

  // Virtual success for step types that rely on criteria evaluation only
  return {
    executable: "true",
    args: [],
  };
}

function tokenizeCommand(command: string): string[] {
  return command.split(WHITESPACE_PATTERN).filter((token) => token.length > 0);
}
