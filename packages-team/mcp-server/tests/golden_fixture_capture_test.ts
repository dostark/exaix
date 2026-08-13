/**
 * @module GoldenFixtureCaptureTest
 * @path packages-team/mcp-server/tests/golden_fixture_capture_test.ts
 * @description Step 1 (Phase 163) characterization test: proves the checked-in
 * pre-migration golden-response fixture was generated from a live, unmigrated
 * MCPServer (not hand-written) by re-capturing fresh and asserting deep equality,
 * and that its tools/list capture covers exactly the docs_visible manifest subset
 * (24 entries — MCP_HANDLER + MCP_DOMAIN — not the raw 29-entry TOOL_MANIFEST total,
 * which includes 5 INTERNAL_ONLY entries never exposed via tools/list; Pre-Gap
 * Analysis GAP-4).
 * @architectural-layer MCP (test)
 * @dependencies [packages-team/mcp-server/tests/fixtures/golden_fixture_capture.ts]
 * @related-files [packages-team/mcp-server/tests/fixtures/golden_fixture_capture.ts]
 * @ungrounded
 */
import { assertEquals, assertExists } from "@std/assert";
import { initMCPTest } from "@exaix/mcp/testing";
import { TOOL_MANIFEST, ToolKind } from "@exaix/mcp";
import {
  captureGoldenFixture,
  GOLDEN_FIXTURE_PATH,
  GOLDEN_FIXTURE_SEED_FILES,
  type IGoldenFixtureCapture,
} from "./fixtures/golden_fixture_capture.ts";

const DOCS_VISIBLE_TOOL_COUNT = TOOL_MANIFEST.filter(
  (entry) => entry.kind === ToolKind.MCP_HANDLER || entry.kind === ToolKind.MCP_DOMAIN,
).length;

Deno.test(
  "[golden fixture] pre_migration_golden_responses.json exists and was generated from a live MCPServer instance, not hand-written",
  async () => {
    const fixtureText = await Deno.readTextFile(GOLDEN_FIXTURE_PATH);
    const checkedIn = JSON.parse(fixtureText) as IGoldenFixtureCapture;

    const ctx = await initMCPTest({ initGit: true, fileContent: GOLDEN_FIXTURE_SEED_FILES });
    try {
      const fresh = await captureGoldenFixture(ctx.server);
      assertEquals(
        fresh,
        checkedIn,
        "checked-in pre_migration_golden_responses.json must exactly match a fresh capture from the live, " +
          "unmigrated MCPServer — a mismatch means the fixture is stale or was hand-edited",
      );
    } finally {
      await ctx.cleanup();
    }
  },
);

Deno.test(
  "[golden fixture] tools/list capture covers exactly the docs_visible manifest subset (24 entries), not the raw 29-entry TOOL_MANIFEST total",
  async () => {
    const fixtureText = await Deno.readTextFile(GOLDEN_FIXTURE_PATH);
    const checkedIn = JSON.parse(fixtureText) as IGoldenFixtureCapture;
    const result = checkedIn.toolsList.result as { tools: Array<{ name: string }> };

    assertExists(result?.tools, "tools/list capture must have a result.tools array");
    assertEquals(
      result.tools.length,
      DOCS_VISIBLE_TOOL_COUNT,
      `Expected tools/list to expose exactly the docs_visible manifest subset (${DOCS_VISIBLE_TOOL_COUNT} entries: ` +
        "MCP_HANDLER + MCP_DOMAIN), not TOOL_MANIFEST's raw 29-entry total (which includes 5 INTERNAL_ONLY entries " +
        "never exposed via tools/list)",
    );
    assertEquals(
      DOCS_VISIBLE_TOOL_COUNT,
      24,
      "docs_visible manifest subset must be exactly 24 entries (Pre-Gap Analysis GAP-4)",
    );
  },
);

Deno.test(
  "[golden fixture] covers every tool/resource/prompt category: tools/list, resources/list, prompts/list, and one representative tools/call per live tool category",
  async () => {
    const fixtureText = await Deno.readTextFile(GOLDEN_FIXTURE_PATH);
    const checkedIn = JSON.parse(fixtureText) as IGoldenFixtureCapture;

    assertExists(checkedIn.toolsList.result, "fixture must capture a successful tools/list response");
    assertExists(checkedIn.resourcesList.result, "fixture must capture a successful resources/list response");
    assertExists(checkedIn.promptsList.result, "fixture must capture a successful prompts/list response");

    const categories = ["READ", "WRITE", "GIT", "META", "DOMAIN"];
    for (const category of categories) {
      const response = checkedIn.representativeToolCalls[category];
      assertExists(response, `fixture must include a representative tools/call for category '${category}'`);
      assertEquals(
        response.error,
        undefined,
        `representative tools/call for '${category}' must succeed (no error), got: ${JSON.stringify(response.error)}`,
      );
    }
  },
);
