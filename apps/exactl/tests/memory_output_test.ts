/**
 * @module MemoryOutputTest
 * @path apps/exactl/tests/memory_output_test.ts
 * @description Runs the memory leaves in process against stubbed command classes and checks the options they pass and the output they print.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/test_utils.ts]
 * @related-files [apps/exactl/src/command_builders/memory_command.ts, apps/exactl/src/command_docs/memory_docs.ts]
 */

import "./helpers/set_test_mode.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { ExaCtlTestContext } from "../src/exactl.ts";
import { ExaCtlSubNoun } from "../src/exactl_constants.ts";
import { withCapturedSink } from "./helpers/captured_output.ts";
import { expectExitWithLogs, withTestMod } from "./helpers/test_utils.ts";

type MemoryCommands = ExaCtlTestContext["memoryCommands"];
type CurationCommands = ExaCtlTestContext["memoryCurationCommands"];
type Proposal = Awaited<ReturnType<CurationCommands["pendingList"]>>[number];
type SearchResults = Awaited<ReturnType<MemoryCommands["search"]>>;

const PROPOSAL = ExaCtlSubNoun.PROPOSAL;
const JSON_FLAGS = ["-o", "json"];

function approval(id: string): Awaited<ReturnType<CurationCommands["pendingApprove"]>> {
  return { id, title: `Title ${id}`, mergedTo: "global" };
}

function proposal(id: string): Proposal {
  return { id, learning: { title: `Title ${id}`, category: "pattern" }, target_project: "api" } as Proposal;
}

Deno.test("memory list prints the summary as JSON", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.memoryCommands.getSummary = () => Promise.resolve({ projects: ["api"], executions: 2, lastActivity: null });
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", "list", ...JSON_FLAGS]);
    });
    assertEquals(JSON.parse(out), { projects: ["api"], executions: 2, lastActivity: null });
  });
});

Deno.test("memory search passes every option and prints the results as JSON", async () => {
  await withTestMod(async (mod, ctx) => {
    let received: Parameters<MemoryCommands["search"]> | undefined;
    ctx.memoryCommands.search = (...args: Parameters<MemoryCommands["search"]>) => {
      received = args;
      return Promise.resolve(
        [{ type: "learning", title: "Found", summary: "S", portal: "my-portal" }] as SearchResults,
      );
    };
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse([
        "memory",
        "search",
        "test query",
        "--portal",
        "my-portal",
        "--tags",
        "tag1,tag2",
        "-n",
        "10",
        "--use-embeddings",
        ...JSON_FLAGS,
      ]);
    });
    assertEquals(received?.[0], "test query");
    assertEquals(received?.[1], { portal: "my-portal", tags: ["tag1", "tag2"], limit: 10, useEmbeddings: true });
    assertEquals(JSON.parse(out)[0].title, "Found");
  });
});

Deno.test("memory project list prints one row per project", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.memoryCommands.projectList = () => Promise.resolve([{ name: "api", patterns: 1, decisions: 2 }]);
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", "project", "list", ...JSON_FLAGS]);
    });
    assertEquals(JSON.parse(out), [{ name: "api", patterns: 1, decisions: 2 }]);
    const table = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", "project", "list"]);
    });
    assertStringIncludes(table.out, "Patterns");
  });
});

Deno.test("memory execution list passes the portal and the limit", async () => {
  await withTestMod(async (mod, ctx) => {
    let received: Parameters<MemoryCommands["executionList"]>[0];
    ctx.memoryCommands.executionList = (options) => {
      received = options;
      return Promise.resolve([]);
    };
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", "execution", "list", "--portal", "api", "-n", "5", ...JSON_FLAGS]);
    });
    assertEquals(received, { portal: "api", limit: 5 });
    assertEquals(JSON.parse(out), []);
  });
});

Deno.test("memory proposal list --eligible lists the eligible proposals", async () => {
  await withTestMod(async (mod, ctx) => {
    let eligible: boolean | undefined;
    ctx.memoryCurationCommands.pendingList = (flag) => {
      eligible = flag;
      return Promise.resolve([proposal("p-1")]);
    };
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", PROPOSAL, "list", "--eligible", ...JSON_FLAGS]);
    });
    assertEquals(eligible, true);
    assertEquals(JSON.parse(out)[0].title, "Title p-1");
    assertEquals(JSON.parse(out)[0].scope, "api");
  });
});

Deno.test("memory proposal approve --all prints one result per approved proposal", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.memoryCurationCommands.pendingApproveAll = () => Promise.resolve([approval("p-1"), approval("p-2")]);
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", PROPOSAL, "approve", "--all", "--yes", ...JSON_FLAGS]);
    });
    assertEquals(JSON.parse(out).map((result: { id: string }) => result.id), ["p-1", "p-2"]);
  });
});

Deno.test("memory proposal approve --dry-run lists the eligible proposals and approves nothing", async () => {
  await withTestMod(async (mod, ctx) => {
    let approved = false;
    ctx.memoryCurationCommands.pendingApproveDryRun = () => Promise.resolve([proposal("p-1")]);
    ctx.memoryCurationCommands.pendingApprove = () => {
      approved = true;
      return Promise.reject(new Error("must not approve"));
    };
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", PROPOSAL, "approve", "--dry-run", ...JSON_FLAGS]);
    });
    assertEquals(approved, false);
    assertEquals(JSON.parse(out)[0].id, "p-1");
  });
});

Deno.test("memory proposal approve with ids approves each id in order", async () => {
  await withTestMod(async (mod, ctx) => {
    const seen: string[] = [];
    ctx.memoryCurationCommands.pendingApprove = (id) => {
      seen.push(id);
      return Promise.resolve(approval(id));
    };
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", PROPOSAL, "approve", "p-1", "p-2", ...JSON_FLAGS]);
    });
    assertEquals(seen, ["p-1", "p-2"]);
    assertEquals(JSON.parse(out).map((result: { id: string }) => result.id), ["p-1", "p-2"]);
  });
});

Deno.test("memory proposal approve stops at the first failed id and reports the approved ones", async () => {
  await withTestMod(async (mod, ctx) => {
    const seen: string[] = [];
    ctx.memoryCurationCommands.pendingApprove = (id) => {
      seen.push(id);
      return id === "p-2" ? Promise.reject(new Error(`Proposal not found: ${id}`)) : Promise.resolve(approval(id));
    };
    let printed = "";
    const original = ctx.outputSink.out;
    ctx.outputSink.out = (text) => {
      printed += text;
      return Promise.resolve();
    };
    let failure: Error | undefined;
    try {
      await mod.__test_command.parse(["memory", PROPOSAL, "approve", "p-1", "p-2", "p-3", ...JSON_FLAGS]);
    } catch (error) {
      failure = error as Error;
    } finally {
      ctx.outputSink.out = original;
    }
    assertStringIncludes(failure?.message ?? "", "Proposal not found: p-2");
    assertEquals(seen, ["p-1", "p-2"]);
    assertEquals(JSON.parse(printed).id, "p-1");
  });
});

Deno.test("memory proposal approve --dry-run with an id is a usage error", async () => {
  await withTestMod(async (mod) => {
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["memory", PROPOSAL, "approve", "p-1", "--dry-run"]);
    });
    assert(errors.some((line) => line.includes("--dry-run takes no proposal id")));
  });
});

Deno.test("memory proposal reject prints the id, the action and the status it set", async () => {
  await withTestMod(async (mod, ctx) => {
    let received: [string, string] | undefined;
    ctx.memoryCurationCommands.pendingReject = (id, reason) => {
      received = [id, reason];
      return Promise.resolve();
    };
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", PROPOSAL, "reject", "p-1", "--reason", "Too narrow", ...JSON_FLAGS]);
    });
    assertEquals(received, ["p-1", "Too narrow"]);
    assertEquals(JSON.parse(out), { id: "p-1", action: "reject", status: "rejected", reason: "Too narrow" });
  });
});

Deno.test("memory learning remove calls deleteLearning with the id and reason", async () => {
  await withTestMod(async (mod, ctx) => {
    let received: [string, string | undefined] | undefined;
    ctx.memoryCurationCommands.deleteLearning = (learningId, reason) => {
      received = [learningId, reason ?? undefined];
      return Promise.resolve();
    };
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse([
        "memory",
        ExaCtlSubNoun.LEARNING,
        "remove",
        "l-1",
        "--reason",
        "duplicate",
        "--yes",
        ...JSON_FLAGS,
      ]);
    });
    assertEquals(received, ["l-1", "duplicate"]);
    assertEquals(JSON.parse(out), { id: "l-1", action: "remove", status: "deleted" });
  });
});

Deno.test("memory index rebuild passes the embeddings option and prints the result", async () => {
  await withTestMod(async (mod, ctx) => {
    let includeEmbeddings: boolean | undefined;
    ctx.memoryCommands.rebuildIndex = (options) => {
      includeEmbeddings = options?.includeEmbeddings;
      return Promise.resolve({ embeddings: 3 });
    };
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", ExaCtlSubNoun.INDEX, "rebuild", "--include-embeddings", ...JSON_FLAGS]);
    });
    assertEquals(includeEmbeddings, true);
    assertEquals(JSON.parse(out), { id: "memory-index", action: "rebuild", status: "rebuilt", embeddings: 3 });
  });
});

Deno.test("memory project show, execution show and proposal show print one JSON object", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.memoryCommands.projectShow = () =>
      Promise.resolve({ portal: "api", overview: "O", patterns: [], decisions: [], references: [] } as Awaited<
        ReturnType<MemoryCommands["projectShow"]>
      >);
    ctx.memoryCommands.executionShow = () =>
      Promise.resolve({ trace_id: "t-1", status: "completed", portal: "api" } as Awaited<
        ReturnType<MemoryCommands["executionShow"]>
      >);
    ctx.memoryCurationCommands.pendingShow = () => Promise.resolve(proposal("p-1"));
    const project = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", "project", "show", "api", ...JSON_FLAGS]);
    });
    assertEquals(JSON.parse(project.out).portal, "api");
    const execution = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", "execution", "show", "t-1", ...JSON_FLAGS]);
    });
    assertEquals(JSON.parse(execution.out).trace_id, "t-1");
    const pending = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", PROPOSAL, "show", "p-1", ...JSON_FLAGS]);
    });
    assertEquals(JSON.parse(pending.out).id, "p-1");
  });
});

Deno.test("memory project show prints the formatter block for table and markdown", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.memoryCommands.projectShow = () =>
      Promise.resolve(
        { portal: "api", overview: "Overview text", patterns: [], decisions: [], references: [] } as Awaited<
          ReturnType<MemoryCommands["projectShow"]>
        >,
      );
    const table = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", "project", "show", "api"]);
    });
    assertStringIncludes(table.out, "Project Memory: api");
    const markdown = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["memory", "project", "show", "api", "-o", "md"]);
    });
    assertStringIncludes(markdown.out, "# Project Memory: api");
  });
});
