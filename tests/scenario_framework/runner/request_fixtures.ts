// deno-lint-ignore-file no-explicit-any
/**
 * @module ScenarioFrameworkRequestFixtures
 * @path tests/scenario_framework/runner/request_fixtures.ts
 * @description Loads plain-text request fixtures from the scenario framework
 * tree and validates that scenario definitions reference fixture files instead
 * of embedding prompt bodies inline.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/tests/unit/request_fixture_loader_test.ts, tests/scenario_framework/README.md]
 */

import { extname, isAbsolute, resolve } from "@std/path";
import { type IScenario, ScenarioSchema } from "../schema/scenario_schema.ts";
import type { JSONValue } from "@exaix/core/types/json.ts";

export interface IRequestFixtureLoadOptions {
  frameworkHome: string;
  requestFixturePath: string;
}

export interface IRequestFixture {
  relativePath: string;
  absolutePath: string;
  content: string;
}

type RawScenario = JSONValue;

const ALLOWED_REQUEST_FIXTURE_EXTENSIONS = [".md", ".txt"] as const;
const EMBEDDED_REQUEST_CONTENT_KEYS = ["request_body", "request_text", "prompt_body", "prompt_text"] as const;

interface IUnknownMap {
  [key: string]: any;
}

export async function loadRequestFixture(
  options: IRequestFixtureLoadOptions,
): Promise<IRequestFixture> {
  const frameworkHome = resolve(options.frameworkHome);

  if (isAbsolute(options.requestFixturePath)) {
    throw new Error("request fixture path must be framework-relative");
  }

  const absolutePath = resolve(frameworkHome, options.requestFixturePath);
  const allowedPrefix = `${frameworkHome}/`;
  if (absolutePath !== frameworkHome && !absolutePath.startsWith(allowedPrefix)) {
    throw new Error("request fixture path escapes framework home");
  }

  const extension = extname(options.requestFixturePath).toLowerCase();
  if (!ALLOWED_REQUEST_FIXTURE_EXTENSIONS.includes(extension as (typeof ALLOWED_REQUEST_FIXTURE_EXTENSIONS)[number])) {
    throw new Error(`unsupported request fixture extension: ${extension || "<none>"}`);
  }

  let content: string;
  try {
    content = await Deno.readTextFile(absolutePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`request fixture not found: ${options.requestFixturePath}`);
    }
    throw error;
  }

  if (content.trim().length === 0) {
    throw new Error(`request fixture is empty: ${options.requestFixturePath}`);
  }

  return {
    relativePath: options.requestFixturePath,
    absolutePath,
    content,
  };
}

export function ensureScenarioUsesFixtureOnly(rawScenario: RawScenario): IScenario {
  const forbiddenKeyPath = findEmbeddedRequestKey(rawScenario, []);
  if (forbiddenKeyPath) {
    throw new Error(`embedded request content is not allowed in scenario definitions: ${forbiddenKeyPath}`);
  }

  return ScenarioSchema.parse(rawScenario);
}

function findEmbeddedRequestKey(node: RawScenario, path: string[]): string | null {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const nestedPath = findEmbeddedRequestKey(node[index], [...path, String(index)]);
      if (nestedPath) {
        return nestedPath;
      }
    }
    return null;
  }

  if (!isUnknownMap(node)) {
    return null;
  }

  for (const [key, value] of Object.entries(node)) {
    if (isEmbeddedRequestContentKey(key)) {
      return [...path, key].join(".");
    }

    const nestedPath = findEmbeddedRequestKey(value, [...path, key]);
    if (nestedPath) {
      return nestedPath;
    }
  }

  return null;
}

function isUnknownMap(value: any): value is IUnknownMap {
  return typeof value === "object" && value !== null;
}

function isEmbeddedRequestContentKey(key: string): boolean {
  return EMBEDDED_REQUEST_CONTENT_KEYS.includes(key as (typeof EMBEDDED_REQUEST_CONTENT_KEYS)[number]);
}
