/**
 * @module RequirementsArtifact
 * @path tests/scenario_framework/runner/requirements_artifact.ts
 * @description Reads a request-bound plan through the canonical workspace path resolver.
 * @architectural-layer Test
 * @dependencies [@exaix/portal, @exaix/testing, @std/yaml, zod]
 * @related-files [tests/scenario_framework/tests/unit/requirements_artifact_security_test.ts]
 */
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import { parse } from "@std/yaml";
import { z } from "zod";

const REQUEST_ID = /^request-[a-f0-9]{8}$/;
const HeaderSchema = z.object({ request_id: z.string(), trace_id: z.string().uuid() });

/** Rejects traversal, symlink escape, and content attributed to another request. */
export async function readRequirementsArtifact(root: string, requestId: string): Promise<string> {
  if (!REQUEST_ID.test(requestId)) throw new Error("Invalid request identity");
  const resolver = new PathResolver(createMockConfig(root));
  const path = await resolver.resolve(`@Workspace/Plans/${requestId}_plan.md`);
  const content = await Deno.readTextFile(path);
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
  const parsed = HeaderSchema.safeParse(header === undefined ? null : parse(header));
  if (
    !parsed.success || parsed.data.request_id !== requestId ||
    `request-${parsed.data.trace_id.slice(0, 8)}` !== requestId
  ) {
    throw new Error("Request identity mismatch");
  }
  return content;
}

/** Lists plan identities after resolving the workspace directory. */
export async function requirementsPlanIds(root: string): Promise<string[]> {
  const resolver = new PathResolver(createMockConfig(root));
  const plans = await resolver.resolve("@Workspace/Plans");
  const ids: string[] = [];
  for await (const entry of Deno.readDir(plans)) {
    const id = entry.name.replace(/_plan\.md$/, "");
    if (entry.isFile && entry.name.endsWith("_plan.md") && REQUEST_ID.test(id)) ids.push(id);
  }
  return ids;
}
