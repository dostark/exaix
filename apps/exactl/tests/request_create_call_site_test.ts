/**
 * @module RequestCreateCallSiteTest
 * @path apps/exactl/tests/request_create_call_site_test.ts
 * @description Phase 157 Step 1 — `exactl request` stamps `scenario_id`/`step_id` into the
 *   created request's frontmatter from EXA_SCENARIO_ID/EXA_STEP_ID, the env vars the scenario
 *   runner exports per step. This is the transport's CLI end: a `submit-request` step running
 *   `exactl request --file $REQUEST_FIXTURE` under those env vars produces a request file the
 *   daemon later parses into IParsedRequest.scenarioId/stepId (buildParsedRequest), which
 *   AgentRunner threads into IModelOptions.callSite. Absent when the env vars are unset,
 *   which is every invocation outside the scenario framework.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/handlers/request_create_handler.ts, packages/request/src/common.ts]
 */

import { assertEquals } from "@std/assert";
import { assert } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { parse as parseYaml } from "@std/yaml";
import { withEnv } from "@exaix/testing";
import { RequestCommands } from "../src/commands/request_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

interface ICreatedFrontmatter {
  scenario_id?: string;
  step_id?: string;
}

function splitFrontmatter(content: string): ICreatedFrontmatter {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  assert(match, "created request file must start with a frontmatter block");
  return parseYaml(match[1]) as ICreatedFrontmatter;
}

describe("exactl request stamps scenario_id/step_id from EXA_SCENARIO_ID/EXA_STEP_ID", () => {
  let requestCommands: RequestCommands;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await createCliTestContext({ createDirs: ["Workspace/Requests"] });
    cleanup = result.cleanup;
    requestCommands = new RequestCommands(result.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("stamps scenario_id and step_id when both env vars are set", async () => {
    await withEnv({ EXA_SCENARIO_ID: "flow_blueprints", EXA_STEP_ID: "submit-request" }, async () => {
      const result = await requestCommands.create("Implement feature X");
      assert(result.path);
      const frontmatter = splitFrontmatter(await Deno.readTextFile(result.path));
      assertEquals(frontmatter.scenario_id, "flow_blueprints");
      assertEquals(frontmatter.step_id, "submit-request");
    });
  });

  it("omits scenario_id and step_id when the env vars are unset", async () => {
    await withEnv({ EXA_SCENARIO_ID: null, EXA_STEP_ID: null }, async () => {
      const result = await requestCommands.create("Implement feature X");
      assert(result.path);
      const frontmatter = splitFrontmatter(await Deno.readTextFile(result.path));
      assertEquals(frontmatter.scenario_id, undefined);
      assertEquals(frontmatter.step_id, undefined);
    });
  });
});
