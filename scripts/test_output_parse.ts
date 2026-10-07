#!/usr/bin/env -S deno run -A
/**
 * @module TestOutputParse
 * @path scripts/test_output_parse.ts
 * @description Shared reporter-output parsers for the test runner and the container driver:
 *   ANSI stripping, TAP counts/failures, and the Deno summary line. They moved out of
 *   `scripts/test_parallel.ts` so both the host runner and the in-container driver import
 *   them one-way, which breaks the former cycle.
 * Usage:
 *   Imported as a library by `scripts/test_parallel.ts` and `scripts/test_container_driver.ts`.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [scripts/test_parallel.ts, scripts/test_container_driver.ts]
 */

/** One TAP failure: the test name and its extracted message. */
export interface ITapFailure {
  name: string;
  message: string;
}

/** Parsed test counts for one file (no label or exit code). */
export interface ITestCounts {
  passed: number;
  failed: number;
  ignored: number;
  durationSec: number;
}

export const DOT_REPORTER_SYMBOLS_PATTERN = /^[.,!]+$/;

const SUMMARY_LINE_MS_PATTERN =
  /(?:^|\n)(?:ok|FAILED)\s*\|\s*(\d+)\s+passed(?:\s*\(\d+\s+steps?\))?\s*\|\s*(\d+)\s+failed(?:\s*\(\d+\s+steps?\))?(?:\s*\|\s*(\d+)\s+ignored)?\s*\((\d+)ms\)/;
const SUMMARY_LINE_SEC_PATTERN =
  /(?:^|\n)(?:ok|FAILED)\s*\|\s*(\d+)\s+passed(?:\s*\(\d+\s+steps?\))?\s*\|\s*(\d+)\s+failed(?:\s*\(\d+\s+steps?\))?(?:\s*\|\s*(\d+)\s+ignored)?\s*\((\d+)(?:m(\d+))?s\)/;

/** Strip ANSI escape codes so the regex can match plain text. */
export function stripAnsi(s: string): string {
  // deno-lint-ignore no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

/** TAP has no "ignored" marker, so `ignored` is always 0 for this format. */
export function parseTapOutput(output: string, durationSec: number): ITestCounts {
  const clean = stripAnsi(output);
  const lines = clean.split("\n");
  let passed = 0;
  let failed = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ok ") && !trimmed.startsWith("ok #")) {
      passed++;
    } else if (trimmed.startsWith("not ok ")) {
      failed++;
    }
  }

  return { passed, failed, ignored: 0, durationSec };
}

/** Parses the TAP failure YAML fence and extracts only the message field. */
export function extractTapFailures(output: string): ITapFailure[] {
  const clean = stripAnsi(output);
  const lines = clean.split("\n");
  const failures: ITapFailure[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("not ok ")) {
      const name = trimmed.replace(/^not ok \d+ - /, "").trim();
      let message = "";
      // Next line(s) may be a YAML block with {"message":"..."}
      if (i + 1 < lines.length && lines[i + 1].trim() === "---") {
        for (let j = i + 2; j < lines.length; j++) {
          const yamlLine = lines[j].trim();
          if (
            yamlLine === "..." || yamlLine.startsWith("ok ") || yamlLine.startsWith("not ok ") ||
            yamlLine.startsWith("1..")
          ) {
            break;
          }
          // Try to parse JSON from YAML block
          try {
            const parsed = JSON.parse(yamlLine);
            if (parsed.message) {
              // Strip ANSI from error message
              message = stripAnsi(parsed.message);
            }
          } catch {
            // Not JSON, skip
          }
        }
      }
      failures.push({ name, message: message || "(no details)" });
    }
  }

  return failures;
}

// Parses the Deno test runner summary line.
// Ignored and step counts are optional.
export function parseSummaryLine(output: string): ITestCounts {
  const clean = stripAnsi(output);
  const msMatch = clean.match(SUMMARY_LINE_MS_PATTERN);
  if (msMatch) {
    const [, passed, failed, ignored] = msMatch;
    return {
      passed: parseInt(passed),
      failed: parseInt(failed),
      ignored: ignored !== undefined ? parseInt(ignored) : 0,
      durationSec: 0, // sub-second, rounds to 0
    };
  }

  const secMatch = clean.match(SUMMARY_LINE_SEC_PATTERN);
  if (!secMatch) return { passed: 0, failed: 0, ignored: 0, durationSec: 0 };

  const [, passed, failed, ignored, secOrMin, trailingSec] = secMatch;

  const minutes = trailingSec !== undefined ? parseInt(secOrMin ?? "0") : 0;
  const secs = trailingSec !== undefined ? parseInt(trailingSec) : parseInt(secOrMin ?? "0");
  return {
    passed: parseInt(passed),
    failed: parseInt(failed),
    ignored: ignored !== undefined ? parseInt(ignored) : 0,
    durationSec: minutes * 60 + secs,
  };
}

/** Counts the dot-reporter symbols (`.`, `,`, `!`) in `output`. */
export function parseDotReporterCounts(output: string, durationSec: number): ITestCounts {
  const clean = stripAnsi(output);
  let passed = 0;
  let failed = 0;
  let ignored = 0;

  for (const line of clean.split(/\r?\n/)) {
    if (!DOT_REPORTER_SYMBOLS_PATTERN.test(line)) {
      continue;
    }
    for (const symbol of line) {
      if (symbol === ".") passed++;
      else if (symbol === "!") failed++;
      else if (symbol === ",") ignored++;
    }
  }

  return { passed, failed, ignored, durationSec };
}
