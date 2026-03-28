/**
 * @module ExaCtlAllTest
 * @path tests/cli/exactl_all_test.ts
 * @description Comprehensive orchestration tests for the exactl CLI, verifying the integration
 * between global command routing, test-mode context injection, and primary subcommands (plan, review, daemon).
 */

import "./helpers/set_test_mode.ts";
import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BINARY_VERSION } from "../../src/shared/version.ts";
import { ExaPathDefaults } from "../../src/shared/constants.ts";
import {
  FlowInputSource,
  MemoryBankSource,
  MemoryOperation,
  PortalOperation,
  PortalStatus,
  RequestPriority,
  RequestSource,
  ReviewType,
  VerificationStatus,
} from "../../src/shared/enums.ts";
import { MemoryStatus } from "../../src/shared/status/memory_status.ts";
import { captureAllOutputs, captureConsoleOutput } from "./helpers/console_utils.ts";
import { expectExitWithLogs, withTestMod } from "./helpers/test_utils.ts";
import type { FlowCommands } from "../../src/cli/commands/flow_commands.ts";
import type { IRequestOptions } from "../../src/shared/types/request.ts";
import type { RequestStatusType } from "../../src/shared/status/request_status.ts";
import type { PlanStatusType } from "../../src/shared/status/plan_status.ts";
import type { IPlanMetadata } from "../../src/shared/types/plan.ts";
import type { BlueprintCreateOptions, BlueprintRemoveOptions } from "../../src/cli/commands/blueprint_commands.ts";

/*
  Note: This test file exercises the top-level CLI parsing and command
  dispatch behavior using the module's internal test-mode context
  (via `__test_getContext()` / `__test_command`). It intentionally
  uses lightweight in-process stubs (no tempdir or real DB) so these
  tests remain fast and focused on CLI wiring rather than full
  integration with filesystem/DB helpers. For filesystem and DB
  integration, use the other CLI test modules that rely on
  `initTestDbService()` / `createCliTestContext()`.
*/

// ---- Basic module export sanity tests ----
Deno.test("exactl exposes test context when EXA_TEST_MODE=1", async () => {
  await withTestMod((mod, _ctx) => {
    assertExists(mod.__test_getContext);
    const c = mod.__test_getContext();
    assertEquals(c.IN_TEST_MODE, true);
    assertExists(c.requestCommands);
    assertExists(c.planCommands);
    assertExists(c.flowCommands);
  });
});

// ---- Parse-based command tests (merged from existing test suite) ----
Deno.test("plan approve calls planCommands.approve", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.planCommands.approve = (id: string) => {
      called = true;
      assertEquals(id, "plan-123");
      return Promise.resolve();
    };
    await mod.__test_command.parse(["plan", "approve", "plan-123"]);
    assert(called);
  });
});

Deno.test("review reject calls reviewCommands.reject", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.reviewCommands.reject = (id: string, reason: string) => {
      called = true;
      assertEquals(id, "cs-1");
      assertEquals(reason, "not-good");
      return Promise.resolve();
    };
    await mod.__test_command.parse(["review", "reject", "cs-1", "-r", "not-good"]);
    assert(called);
  });
});

Deno.test("portal add invokes portalCommands.add", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.portalCommands.add = (target: string, alias: string) => {
      called = true;
      assertEquals(alias, "MyAlias");
      assert(target.includes("/tmp"));
      return Promise.resolve();
    };
    await mod.__test_command.parse(["portal", MemoryOperation.ADD, "/tmp/some/path", "MyAlias"]);
    assert(called);
  });
});

Deno.test("git branches prints list (calls gitCommands.listBranches)", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.gitCommands.listBranches = (_pattern?: string) =>
      Promise.resolve([
        {
          name: "main",
          is_current: true,
          last_commit: "abc123",
          last_commit_date: new Date().toISOString(),
          trace_id: undefined,
        },
      ]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([PortalOperation.GIT, "branches"]);
    });
    assert(out.includes("main"));
  });
});

Deno.test("daemon status prints info (calls daemonCommands.status)", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.daemonCommands.status = () =>
      Promise.resolve({ version: "v1", workspace_schema_version: "1.0.0", running: true, pid: 999, uptime: "1m" });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["daemon", "status"]);
    });
    assert(out.includes("daemon"));
  });
});

Deno.test("blueprint remove calls blueprintCommands.remove", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.blueprintCommands.remove = (id: string, opts?: BlueprintRemoveOptions) => {
      called = true;
      assertEquals(id, "agent-x");
      assertEquals(opts?.force, true);
      return Promise.resolve();
    };
    await mod.__test_command.parse(["blueprint", "remove", "agent-x", "--force"]);
    assert(called);
  });
});

Deno.test("request list shows 'No requests found' when empty", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.list = () => Promise.resolve([]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "list"]);
    });
    assert(out.includes("No requests found") || out.includes("count: 0"));
  });
});

Deno.test("request list prints entries when present", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.list = () =>
      Promise.resolve([
        {
          trace_id: "abcd1234efgh5678",
          priority: RequestPriority.CRITICAL,
          identity: "agent-x",
          created_by: "tester",
          created: "now",
          status: MemoryStatus.PENDING,
          filename: "/tmp/req.md",
          path: "/tmp",
          source: RequestSource.CLI as RequestSource,
        },
      ]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "list"]);
    });
    assert(out.includes("🔴") || out.includes("abcd1234"));
  });
});

Deno.test("request show prints content when request exists", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.show = (id: string) =>
      Promise.resolve({
        metadata: {
          trace_id: id,
          status: MemoryStatus.PENDING,
          priority: RequestPriority.NORMAL,
          identity: MemoryBankSource.IDENTITY,
          created_by: "tester",
          created: "time",
          filename: "/tmp/req.md",
          path: "/tmp",
          source: RequestSource.CLI as RequestSource,
        },
        content: "Hello world",
      });

    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "show", "trace-1"]);
    });
    assert(out.includes("Hello world"));
  });
});

Deno.test("plan list shows entries and status icons", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.planCommands.list = () => Promise.resolve([{ id: "p1", status: "review", trace_id: "t1" }]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["plan", "list"]);
    });
    assert(out.includes("🔍") || out.includes("p1"));
  });
});

Deno.test("review list prints entries when present", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.list = () =>
      Promise.resolve([
        {
          request_id: "req-1",
          branch: "feat/x",
          files_changed: 2,
          created_at: new Date().toISOString(),
          trace_id: "trace-1",
          identity_id: "agent-1",
          diff: "",
          commits: [],
        },
      ]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["review", "list"]);
    });
    assert(out.includes("feat/x") || out.includes("req-1"));
  });
});

Deno.test("git log prints commits when present", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.gitCommands.logByTraceId = (_t: string) =>
      Promise.resolve([{ sha: "deadbeef1234", message: "Fix", author: "me", date: new Date().toISOString() }]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([PortalOperation.GIT, "log", "-t", "deadbeef"]);
    });
    assert(out.includes("deadbeef") || out.includes("Fix"));
  });
});

Deno.test("git status prints clean state when empty arrays", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.gitCommands.status = () =>
      Promise.resolve({ branch: "main", modified: [], added: [], deleted: [], untracked: [] });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([PortalOperation.GIT, "status"]);
    });
    assert(out.includes("main") && out.includes("clean") || out.includes("git.status"));
  });
});

Deno.test("portal list prints hint when empty", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.portalCommands.list = () => Promise.resolve([]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["portal", "list"]);
    });
    assert(out.includes("Add a portal") || out.includes("count: 0"));
  });
});

Deno.test("portal show prints details", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.portalCommands.show = (_alias: string) =>
      Promise.resolve({
        alias: "MyPortal",
        targetPath: "/tmp/portal-target",
        symlinkPath: join(ExaPathDefaults.portals, "MyPortal"),
        status: PortalStatus.ACTIVE,
        contextCardPath: join(ExaPathDefaults.memoryProjects, "MyPortal/portal.md"),
        permissions: "read",
        created: "now",
        lastVerified: "never",
      });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["portal", "show", "MyPortal"]);
    });
    assert(out.includes("MyPortal") && out.includes("/tmp/portal-target"));
  });
});

Deno.test("blueprint list prints hint when empty and list when present", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.list = () => Promise.resolve([]);
    const emptyOut = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["blueprint", "list"]);
    });
    assert(emptyOut.includes("Create a blueprint"));
    ctx.blueprintCommands.list = () =>
      Promise.resolve([{
        identity_id: "a1",
        name: "A",
        model: "mock",
        capabilities: ["c1"],
        created: "now",
        created_by: "tester",
        version: "1.0.0",
      }]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["blueprint", "list"]);
    });
    assert(out.includes("a1") || out.includes("A"));
  });
});

Deno.test("blueprint validate invalid triggers exit", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.validate = (_id: string) => Promise.resolve({ valid: false, errors: ["bad"] });
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["blueprint", "validate", "bad-agent"]);
    });
    assert(errors.some((e: string) => e.includes("Invalid")));
  });
});

Deno.test("request --file outputs JSON when --json specified", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.createFromFile = (_file: string, _opts?: { [key: string]: unknown }) =>
      Promise.resolve({
        filename: "/tmp/exa-test/request-1.md",
        trace_id: "trace-1234",
        priority: RequestPriority.NORMAL,
        identity: "default",
        path: "/tmp",
        source: RequestSource.FILE,
        created_by: "tester",
        created: "now",
        status: MemoryStatus.PENDING,
      });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "--file", "/tmp/some.md", "--json"]);
    });
    assert(out.includes("{") && out.includes('"trace_id"') && out.includes("trace-1234"));
  });
});

Deno.test("request --file prints human output when no --json", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.createFromFile = (_file: string, _opts?: { [key: string]: unknown }) =>
      Promise.resolve({
        filename: "/tmp/exa-test/request-2.md",
        trace_id: "trace-5678",
        priority: RequestPriority.HIGH,
        identity: "tester",
        path: "/tmp",
        source: RequestSource.FILE,
        created_by: "tester",
        created: "now",
        status: MemoryStatus.PENDING,
      });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "--file", "/tmp/some.md"]);
    });
    assert(out.includes("request.created") || out.includes("trace-5678"));
  });
});

Deno.test("request inline create handles create errors and exits", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.create = (_desc: string, _opts?: IRequestOptions, _source?: RequestSource) => {
      throw new Error("create failed");
    };

    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "Do something"]);
    });
    assert(errors.some((e: string) => e.includes("create failed")));
  });
});

Deno.test("request show handles not found and exits", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.show = (_id: string) => {
      throw new Error("not found");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "show", "missing"]);
    });
    assert(errors.some((e: string) => e.includes("not found")));
  });
});

Deno.test("portal verify summarizes healthy and broken portals", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.portalCommands.verify = () =>
      Promise.resolve([{ alias: "A", status: VerificationStatus.OK, issues: [] }, {
        alias: "B",
        status: VerificationStatus.FAILED,
        issues: ["missing"],
      }]);
    const outs = await captureAllOutputs(async () => {
      await mod.__test_command.parse(["portal", "verify"]);
    });
    const joined = [...outs.logs, ...outs.warns, ...outs.errs].join("\n");
    assert(joined.includes("healthy") || joined.includes("broken"));
  });
});

Deno.test("plan show prints content", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.planCommands.show = (id: string) =>
      Promise.resolve({
        metadata: { id, status: "review", trace_id: "t1" } as IPlanMetadata,
        content: "Plan details here",
      });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["plan", "show", "plan-1"]);
    });
    assert(out.includes("Plan details here"));
  });
});

Deno.test("review show prints commits and diff", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.show = (_id: string) =>
      Promise.resolve({
        request_id: "req-1",
        branch: "feat/x",
        files_changed: 1,
        commits: [{ sha: "abcdef123456", message: "Initial", timestamp: new Date().toISOString() }],
        diff: "---a\n+++b\n",
        trace_id: "t1",
        created_at: new Date().toISOString(),
        type: ReviewType.CODE,
        identity_id: "agent-1",
      });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["review", "show", "cs-1"]);
    });

    assert(out.includes("abcdef12") && out.includes("---a"));
  });
});

Deno.test("review show --diff outputs only diff", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.show = (_id: string) =>
      Promise.resolve({
        request_id: "req-1",
        branch: "feat/x",
        files_changed: 1,
        commits: [{ sha: "abcdef123456", message: "Initial", timestamp: new Date().toISOString() }],
        diff: "diff --git a/file.txt b/file.txt\n---a\n+++b\n",
        trace_id: "t1",
        created_at: new Date().toISOString(),
        type: ReviewType.CODE,
        identity_id: "agent-1",
      });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["review", "show", "cs-1", "--diff"]);
    });

    // Should output only the diff, no formatted messages
    assertEquals(out, "diff --git a/file.txt b/file.txt\n---a\n+++b\n\n");
    assert(!out.includes("review.show"));
    assert(!out.includes("abcdef12"));
  });
});

Deno.test("request inline --dry-run logs dry_run and creates file", async () => {
  await withTestMod(async (mod, ctx) => {
    let created = false;
    ctx.requestCommands.create = (_desc: string, _opts?: IRequestOptions, _source?: RequestSource) => {
      created = true;
      return Promise.resolve({
        filename: "/tmp/req.md",
        trace_id: "t1",
        priority: RequestPriority.NORMAL,
        identity: "a",
        path: "/tmp",
        source: RequestSource.CLI as const,
        created_by: "tester",
        created: "now",
        status: MemoryStatus.PENDING,
      });
    };
    const { logs, warns, errs } = await captureAllOutputs(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "Inline-dry", "--dry-run"]);
    });
    const joined = logs.concat(warns, errs).join("\n");
    assert(created);
    assert(joined.includes("cli.dry_run") || joined.includes("would_create"));
  });
});

Deno.test("blueprint ls alias calls blueprintCommands.list", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.blueprintCommands.list = () => {
      called = true;
      return Promise.resolve([]);
    };
    await mod.__test_command.parse(["blueprint", "ls"]);
    assert(called);
  });
});

Deno.test("flow list calls flowCommands.listFlows", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.flowCommands.listFlows = (_opts?: Parameters<FlowCommands["listFlows"]>[0]) => {
      called = true;
      return Promise.resolve();
    };
    await mod.__test_command.parse(["flow", "list"]);
    assert(called);
  });
});

Deno.test("dashboard show calls dashboardCommands.show", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.dashboardCommands.show = () => {
      called = true;
      return Promise.resolve();
    };
    await mod.__test_command.parse(["dashboard"]);
    assert(called);
  });
});

if (Deno.env.get("RUN_EXACTL_TEST")) {
  Deno.test("exactl: --version prints version and exits", async () => {
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-check", "--quiet", "src/cli/exactl.ts", "--version"],
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout, stderr } = await cmd.output();
    const out = new TextDecoder().decode(stdout);
    const err = new TextDecoder().decode(stderr);
    if (!out && err) throw new Error(`exactl did not produce stdout. stderr: ${err}`);
    assertStringIncludes(out + err, "1.0.0");
  });
} else {
  Deno.test({ name: "exactl: --version prints version and exits (skipped)", ignore: true, fn: () => {} });
}

Deno.test("request without description exits with error", async () => {
  await withTestMod(async (mod, _ctx) => {
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST]);
    });
    assert(errors.some((e: string) => e.includes("Description required")));
  });
});

Deno.test("request list --json outputs JSON", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.list = (_s?: RequestStatusType) =>
      Promise.resolve([
        {
          trace_id: "t1",
          priority: RequestPriority.NORMAL,
          identity: "a",
          created_by: "u",
          created: "t",
          status: MemoryStatus.PENDING,
          filename: "f",
          path: "p",
          source: RequestSource.CLI,
        },
      ]);
    const outs = await captureAllOutputs(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "list", "--json"]);
    });
    assert(outs.logs.some((l) => l.includes('"trace_id"') || l.includes("cli.output")));
  });
});

Deno.test("plan revise passes comments to planCommands.revise", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.planCommands.revise = (id: string, comments: string[]) => {
      called = true;
      assertEquals(id, "p-1");
      assertEquals(comments, ["c1", "c2"]);
      return Promise.resolve();
    };
    await mod.__test_command.parse(["plan", "revise", "p-1", "-c", "c1", "-c", "c2"]);
    assert(called);
  });
});

Deno.test("git log prints no commits when none found", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.gitCommands.logByTraceId = (_t: string) => Promise.resolve([]);
    const outs = await captureAllOutputs(async () => {
      await mod.__test_command.parse([PortalOperation.GIT, "log", "-t", "nope"]);
    });
    assert(outs.logs.some((l) => l.includes("No commits found") || l.includes("git.log")));
  });
});

Deno.test("portal remove --keep-card preserves context card", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.portalCommands.remove = (alias: string, opts?: { keepCard?: boolean }) => {
      called = true;
      assertEquals(alias, "KeepMe");
      assertEquals(opts?.keepCard, true);
      return Promise.resolve();
    };
    await mod.__test_command.parse(["portal", "remove", "KeepMe", "--keep-card"]);
    assert(called);
  });
});

Deno.test("daemon logs supports --follow option", async () => {
  await withTestMod(async (mod, ctx) => {
    let calledWithFollow = false;
    ctx.daemonCommands.logs = (_lines?: number, follow?: boolean) => {
      calledWithFollow = follow === true;
      return Promise.resolve();
    };
    await mod.__test_command.parse(["daemon", "logs", "--follow"]);
    assert(calledWithFollow);
  });
});

Deno.test("blueprint create error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.create = (_id: string, _opts: BlueprintCreateOptions) => {
      throw new Error("boom");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([
        "blueprint",
        "create",
        "agent-x",
        "-n",
        "Name",
        "-m",
        "mock:test",
      ]);
    });
    assert(errors.some((e: string) => e.includes("boom")));
  });
});

Deno.test("request inline --json prints JSON output", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.create = (_desc: string, _opts?: IRequestOptions, _source?: RequestSource) => {
      return Promise.resolve({
        filename: "/tmp/r.md",
        trace_id: "t-json",
        priority: RequestPriority.NORMAL,
        identity: "a",
        path: "/tmp",
        source: RequestSource.CLI as const,
        created_by: "tester",
        created: "now",
        status: MemoryStatus.PENDING,
      });
    };
    const outs = await captureAllOutputs(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "make json", "--json"]);
    });
    assert(outs.logs.some((l) => l.includes('"trace_id"') || l.includes("cli.output")));
  });
});

Deno.test("plan list empty prints hint", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.planCommands.list = (_s?: PlanStatusType) => Promise.resolve([]);
    const outs = await captureAllOutputs(async () => {
      await mod.__test_command.parse(["plan", "list"]);
    });
    assert(outs.logs.some((l) => l.includes("No plans found") || l.includes("plan.list")));
  });
});

Deno.test("git branches passes pattern option to listBranches", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.gitCommands.listBranches = (pattern?: string) => {
      assertEquals(pattern, "feat/*");
      return Promise.resolve([]);
    };
    await mod.__test_command.parse([PortalOperation.GIT, "branches", "--pattern", "feat/*"]);
  });
});

Deno.test("review show error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.show = (_id: string) => {
      throw new Error("not found");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["review", "show", "cs-1"]);
    });
    assert(errors.some((e: string) => e.includes("not found")));
  });
});

Deno.test("portal verify with alias invokes portalCommands.verify", async () => {
  await withTestMod(async (mod, ctx) => {
    let calledWithAlias = false;
    ctx.portalCommands.verify = (alias?: string) => {
      calledWithAlias = alias === "MyPortal";
      return Promise.resolve([]);
    };
    await mod.__test_command.parse(["portal", "verify", "MyPortal"]);
    assert(calledWithAlias);
  });
});

Deno.test("blueprint create successful prints created message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.create = (id: string, opts: BlueprintCreateOptions) =>
      Promise.resolve({
        identity_id: id,
        name: opts.name ?? id,
        model: opts.model ?? "mock:test",
        path: "/tmp",
        capabilities: [],
        created: "now",
        created_by: "tester",
        version: "1.0.0",
      });
    const outs = await captureAllOutputs(async () => {
      await mod.__test_command.parse(["blueprint", "create", "agent-y", "-n", "N", "-m", "mock:test"]);
    });
    assert(outs.logs.some((l) => l.includes("blueprint.created") || l.includes("agent-y")));
  });
});

// ---- Additional focused tests to improve coverage for src/cli/exactl.ts ----

Deno.test("exactl: --version prints version and exits (in-process)", async () => {
  await withTestMod(async (mod, _ctx) => {
    const origExit = Deno.exit;
    const origLog = console.log;
    let out = "";
    console.log = (msg: string) => (out += msg + "\n");
    // Use Object.defineProperty to safely mock Deno.exit since it might be read-only in some environments
    const exitMock = (code?: number) => {
      throw new Error(`DENO_EXIT:${code ?? 0}`);
    };

    try {
      (Deno as typeof Deno & { exit: (code?: number) => never }).exit = exitMock;
      await mod.__test_command.parse(["--version"]);
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.startsWith("DENO_EXIT:")) throw e;
    } finally {
      (Deno as typeof Deno & { exit: (code?: number) => never }).exit = origExit;
      console.log = origLog;
    }
    assertStringIncludes(out, BINARY_VERSION);
  });
});

Deno.test("request --file --dry-run prints human output", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.createFromFile = (_file: string, _opts?: IRequestOptions) =>
      Promise.resolve({
        filename: "/tmp/exa-test/request-file.md",
        trace_id: "trace-file-1",
        priority: RequestPriority.NORMAL,
        identity: "file-agent",
        path: "/tmp",
        source: RequestSource.FILE,
        created_by: "tester",
        created: "now",
        status: MemoryStatus.PENDING,
      });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "--file", "/tmp/some.md", "--dry-run"]);
    });
    assert(out.includes("request.created") || out.includes("trace-file-1"));
  });
});

Deno.test("request --file --json --dry-run prints JSON output", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.createFromFile = (_file: string, _opts?: IRequestOptions) =>
      Promise.resolve({
        filename: "/tmp/exa-test/request-file2.md",
        trace_id: "trace-file-2",
        priority: RequestPriority.HIGH,
        identity: "file-agent",
        path: "/tmp",
        source: RequestSource.FILE,
        created_by: "tester",
        created: "now",
        status: MemoryStatus.PENDING,
      });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([
        FlowInputSource.REQUEST,
        "--file",
        "/tmp/some.md",
        "--json",
        "--dry-run",
      ]);
    });
    assert(out.includes('"trace_id"') || out.includes("trace-file-2"));
  });
});

Deno.test("request --file errors exit with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.createFromFile = (_file: string, _opts?: IRequestOptions) => {
      throw new Error("file missing");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "--file", "/tmp/missing.md"]);
    });
    assert(errors.some((e: string) => e.includes("file missing")));
  });
});

Deno.test("request inline --dry-run with --json prefers dry-run", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.create = (_desc: string, _opts?: IRequestOptions, _source?: RequestSource) =>
      Promise.resolve({
        filename: "/tmp/req.md",
        trace_id: "t-dry",
        priority: RequestPriority.NORMAL,
        identity: "a",
        path: "/tmp",
        source: RequestSource.CLI,
        created_by: "tester",
        created: "now",
        status: MemoryStatus.PENDING,
      });
    const outs = await captureAllOutputs(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "Do something", "--dry-run", "--json"]);
    });
    const joined = [...outs.logs, ...outs.warns, ...outs.errs].join("\n");
    assert(joined.includes("cli.dry_run") && !joined.includes('"trace_id"'));
  });
});

Deno.test("plan list passes status filter to planCommands.list", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.planCommands.list = (status?: string) => {
      assertEquals(status, "review");
      return Promise.resolve([{ id: "p-filter", status: "review", trace_id: "t" }]);
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["plan", "list", "--status", "review"]);
    });
    assert(out.includes("p-filter"));
  });
});

Deno.test("blueprint validate valid prints success", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.validate = (_id: string) => Promise.resolve({ valid: true, warnings: [], errors: [] });
    const outs = await captureAllOutputs(async () => {
      await mod.__test_command.parse(["blueprint", "validate", "good-agent"]);
    });
    const joined = [...outs.logs, ...outs.warns, ...outs.errs].join("\n");
    assert(joined.includes("valid") || joined.includes("✅") || joined.includes("blueprint.valid"));
  });
});
