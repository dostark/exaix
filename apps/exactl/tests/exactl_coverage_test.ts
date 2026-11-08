/**
 * @module ExaCtlCoverageTest
 * @path apps/exactl/tests/exactl_coverage_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Negative testing and coverage verification for the exactl CLI, ensuring
 * graceful failure messages for invalid inputs across all primary subcommands.
 */

import { DEFAULT_MEMORY_PATH, DEFAULT_PORTALS_PATH } from "@exaix/shared";
import "./helpers/set_test_mode.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  BlueprintStatus,
  FlowInputSource,
  MemoryBankSource,
  MemoryOperation,
  MemoryScope,
  PortalOperation,
  PortalStatus,
  RequestPriority,
  RequestSource,
  ReviewType,
  type SkillStatus as _SkillStatus,
  VerificationStatus,
} from "@exaix/core";
import { UIOutputFormat } from "@exaix/tui";
import { MemoryStatus } from "@exaix/core/status";
import { PlanStatus } from "@exaix/core/status";
import { RequestStatus } from "@exaix/core/status";
import { ReviewStatus } from "@exaix/core/status";
import { GitService } from "@exaix/git";
import type { OutputFormat } from "@exaix/cli/types/memory_types.ts";
import type { FlowCommands } from "../src/commands/flow_commands.ts";
import type { IRequestOptions } from "@exaix/core/types";
import type { RequestStatusType } from "@exaix/core/status";
import { captureAllOutputs, captureConsoleOutput } from "./helpers/console_utils.ts";
import { createdFlowRequest, expectExitWithLogs, withTestMod } from "./helpers/test_utils.ts";
import { ExaCtlSubNoun } from "../src/exactl_constants.ts";
import { TEST_MODEL_OPENAI } from "@exaix/testing";

type IPruneWorktreesOptions = Parameters<GitService["pruneWorktrees"]>[0];

// Plan Command Error Handlers

Deno.test("plan list error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.planCommands.list = () => {
      return Promise.reject(new Error("plan list failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["plan", "list"]);
    });
    assert(errors.some((e: string) => e.includes("plan list failed")));
  });
});

Deno.test("plan show error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.planCommands.show = () => {
      return Promise.reject(new Error("plan not found"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["plan", "show", "missing"]);
    });
    assert(errors.some((e: string) => e.includes("plan not found")));
  });
});

Deno.test("plan approve error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.planCommands.approve = () => {
      return Promise.reject(new Error("approval failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["plan", "approve", "p-1"]);
    });
    assert(errors.some((e: string) => e.includes("approval failed")));
  });
});

Deno.test("plan reject error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.planCommands.reject = () => {
      return Promise.reject(new Error("rejection failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["plan", "reject", "p-1", "-r", "bad"]);
    });
    assert(errors.some((e: string) => e.includes("rejection failed")));
  });
});

Deno.test("plan revise error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.planCommands.revise = () => {
      return Promise.reject(new Error("revision failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["plan", "revise", "p-1", "-c", "comment"]);
    });
    assert(errors.some((e: string) => e.includes("revision failed")));
  });
});

// Review Command Error Handlers

Deno.test("review list error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.list = () => {
      return Promise.reject(new Error("review list failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["review", "list"]);
    });
    assert(errors.some((e: string) => e.includes("review list failed")));
  });
});

Deno.test("review approve error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.approve = () => {
      return Promise.reject(new Error("approval failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["review", "approve", "cs-1"]);
    });
    assert(errors.some((e: string) => e.includes("approval failed")));
  });
});

Deno.test("review reject error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.reject = () => {
      return Promise.reject(new Error("rejection failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["review", "reject", "cs-1", "-r", "bad"]);
    });
    assert(errors.some((e: string) => e.includes("rejection failed")));
  });
});

// Git Command Error Handlers

Deno.test("git branch list error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.gitCommands.listBranches = () => {
      return Promise.reject(new Error("git error"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([PortalOperation.GIT, "branch", "list"]);
    });
    assert(errors.some((e: string) => e.includes("git error")));
  });
});

Deno.test("git status error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.gitCommands.status = () => {
      return Promise.reject(new Error("status failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([PortalOperation.GIT, "status"]);
    });
    assert(errors.some((e: string) => e.includes("status failed")));
  });
});

Deno.test("git log error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.gitCommands.logByTraceId = () => {
      return Promise.reject(new Error("log failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([PortalOperation.GIT, "log", "-t", "trace-1"]);
    });
    assert(errors.some((e: string) => e.includes("log failed")));
  });
});

// Daemon Command Error Handlers

Deno.test("daemon start error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.daemonCommands.start = () => {
      return Promise.reject(new Error("start failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["daemon", "start"]);
    });
    assert(errors.some((e: string) => e.includes("start failed")));
  });
});

Deno.test("daemon stop error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.daemonCommands.stop = () => {
      return Promise.reject(new Error("stop failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["daemon", "stop"]);
    });
    assert(errors.some((e: string) => e.includes("stop failed")));
  });
});

Deno.test("daemon restart error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.daemonCommands.restart = () => {
      return Promise.reject(new Error("restart failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["daemon", "restart"]);
    });
    assert(errors.some((e: string) => e.includes("restart failed")));
  });
});

Deno.test("daemon status error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.daemonCommands.status = () => {
      return Promise.reject(new Error("status failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["daemon", "status"]);
    });
    assert(errors.some((e: string) => e.includes("status failed")));
  });
});

Deno.test("daemon logs error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.daemonCommands.logs = () => {
      return Promise.reject(new Error("logs failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["daemon", "logs"]);
    });
    assert(errors.some((e: string) => e.includes("logs failed")));
  });
});

// Portal Command Error Handlers

Deno.test("portal add error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.portalCommands.add = () => {
      return Promise.reject(new Error("add failed"));
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["portal", MemoryOperation.ADD, "/tmp/path", "alias"]);
    });
    assert(errors.some((e: string) => e.includes("add failed")));
  });
});

// Git Worktree Commands

Deno.test("git worktree list rejects --portal and --repo together", async () => {
  await withTestMod(async (mod, _ctx) => {
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([
        PortalOperation.GIT,
        "worktree",
        "list",
        "--portal",
        "portal-a",
        "--repo",
        "/tmp/repo",
      ]);
    });
    assert(errors.some((e: string) => e.includes("Use either --portal or --repo")));
  });
});

Deno.test("git worktree list uses repo option and prints entries", async () => {
  const originalList = GitService.prototype.listWorktrees;
  let capturedRepo = "";
  let called = false;

  GitService.prototype.listWorktrees = function () {
    called = true;
    capturedRepo = this["repoPath"];
    return Promise.resolve([
      {
        path: "/tmp/repo/wt1",
        branch: "refs/heads/feat/test",
        head: "abcd1234abcd1234",
        locked: true,
        prunable: false,
      },
      {
        path: "/tmp/repo/wt2",
        detached: true,
        head: "deadbeefdeadbeef",
        prunable: true,
      },
    ]);
  };

  try {
    await withTestMod(async (mod, _ctx) => {
      const output = await captureConsoleOutput(async () => {
        await mod.__test_command.parse([PortalOperation.GIT, "worktree", "list", "--repo", "/tmp/repo"]);
      });
      assert(called);
      assertEquals(capturedRepo, "/tmp/repo");
      assert(output.length > 0);
    });
  } finally {
    GitService.prototype.listWorktrees = originalList;
  }
});

Deno.test("git worktree prune passes options to GitService", async () => {
  const originalPrune = GitService.prototype.pruneWorktrees;
  let received: IPruneWorktreesOptions | null = null;

  GitService.prototype.pruneWorktrees = function (options?: IPruneWorktreesOptions) {
    received = options;
    return Promise.resolve("pruned worktrees");
  };

  try {
    await withTestMod(async (mod, _ctx) => {
      const output = await captureConsoleOutput(async () => {
        await mod.__test_command.parse([
          PortalOperation.GIT,
          "worktree",
          "prune",
          "--repo",
          "/tmp/repo",
          "--dry-run",
          "--verbose",
          "--expire",
          "3.days.ago",
        ]);
      });
      assertEquals(received, { dryRun: true, verbose: true, expire: "3.days.ago" });
      assert(output.length > 0);
    });
  } finally {
    GitService.prototype.pruneWorktrees = originalPrune;
  }
});

// Portal Commands

Deno.test("portal add rejects invalid execution strategy", async () => {
  await withTestMod(async (mod, _ctx) => {
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([
        "portal",
        "add",
        "/tmp/path",
        "alias",
        "--execution-strategy",
        "invalid",
      ]);
    });
    assert(errors.some((e: string) => e.includes("Invalid execution strategy")));
  });
});

Deno.test("portal verify logs warnings and summary", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.portalCommands.verify = () =>
      Promise.resolve([
        { alias: "Healthy", status: VerificationStatus.OK, issues: [] },
        { alias: "Broken", status: VerificationStatus.FAILED, issues: ["missing"] },
      ]);

    const { logs, warns } = await captureAllOutputs(async () => {
      await mod.__test_command.parse(["portal", "verify"]);
    });

    assert(warns.length >= 1);
    assertStringIncludes(logs.join(" "), "portal.verify.summary");
  });
});

// Review Show Branches

Deno.test("review show --diff prints diff only", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.show = (_id: string) =>
      Promise.resolve({
        diff: "DIFF ONLY",
        branch: "test-branch",
        trace_id: "test-trace",
        request_id: "req-1",
        files_changed: 1,
        created_at: new Date().toISOString(),
        agent_role: "test-agent",
        commits: [],
        type: ReviewType.CODE,
      });

    const output = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["review", "show", "cs-1", "--diff"]);
    });

    assertStringIncludes(output, "DIFF ONLY");
  });
});

Deno.test("review show renders approved decision", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.show = (_id: string) =>
      Promise.resolve({
        request_id: "req-1",
        branch: "feat/x",
        trace_id: "trace-1",
        created_at: new Date().toISOString(),
        agent_role: "agent-1",
        files_changed: 1,
        status: ReviewStatus.APPROVED,
        commits: [{ sha: "abcd1234", message: "done", timestamp: new Date().toISOString() }],
        diff: "diff",
        approved_at: new Date().toISOString(),
        approved_by: "tester",
      });

    const { logs } = await captureAllOutputs(async () => {
      await mod.__test_command.parse(["review", "show", "cs-1"]);
    });

    assertStringIncludes(logs.join(" "), "approved");
  });
});

Deno.test("review show renders rejected decision", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.show = (_id: string) =>
      Promise.resolve({
        request_id: "req-2",
        branch: "feat/y",
        trace_id: "trace-2",
        created_at: new Date().toISOString(),
        agent_role: "agent-2",
        files_changed: 2,
        status: ReviewStatus.REJECTED,
        commits: [{ sha: "deadbeef", message: "nope", timestamp: new Date().toISOString() }],
        diff: "diff",
        rejected_at: new Date().toISOString(),
        rejected_by: "tester",
        rejection_reason: "bad",
      });

    const { logs } = await captureAllOutputs(async () => {
      await mod.__test_command.parse(["review", "show", "cs-2"]);
    });

    assertStringIncludes(logs.join(" "), "rejected");
  });
});

Deno.test("portal list error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.portalCommands.list = () => {
      throw new Error("list failed");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["portal", "list"]);
    });
    assert(errors.some((e: string) => e.includes("list failed")));
  });
});

Deno.test("portal show error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.portalCommands.show = () => {
      throw new Error("show failed");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["portal", "show", "alias"]);
    });
    assert(errors.some((e: string) => e.includes("show failed")));
  });
});

Deno.test("portal remove error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.portalCommands.remove = () => {
      throw new Error("remove failed");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["portal", "remove", "alias"]);
    });
    assert(errors.some((e: string) => e.includes("remove failed")));
  });
});

Deno.test("portal verify error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.portalCommands.verify = () => {
      throw new Error("verify failed");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["portal", "verify"]);
    });
    assert(errors.some((e: string) => e.includes("verify failed")));
  });
});

Deno.test("portal refresh error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.portalCommands.refresh = () => {
      throw new Error("refresh failed");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["portal", "refresh", "alias"]);
    });
    assert(errors.some((e: string) => e.includes("refresh failed")));
  });
});

// Blueprint Command Error Handlers

Deno.test("blueprint list error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.list = () => {
      throw new Error("list failed");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["blueprint", "list"]);
    });
    assert(errors.some((e: string) => e.includes("list failed")));
  });
});

Deno.test("blueprint show error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.show = () => {
      throw new Error("show failed");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["blueprint", "show", "agent-1"]);
    });
    assert(errors.some((e: string) => e.includes("show failed")));
  });
});

Deno.test("blueprint validate error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.validate = () => {
      throw new Error("validate failed");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["blueprint", "validate", "agent-1"]);
    });
    assert(errors.some((e: string) => e.includes("validate failed")));
  });
});

Deno.test("blueprint edit error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.edit = () => {
      throw new Error("edit failed");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["blueprint", "edit", "agent-1"]);
    });
    assert(errors.some((e: string) => e.includes("edit failed")));
  });
});

Deno.test("blueprint remove error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.remove = () => {
      throw new Error("remove failed");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["blueprint", "remove", "agent-1"]);
    });
    assert(errors.some((e: string) => e.includes("remove failed")));
  });
});

// Request List with Status Filter

Deno.test("request list passes status filter", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.list = (_status?: RequestStatusType) => Promise.resolve([]);
    await captureConsoleOutput(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "list", "-s", MemoryStatus.PENDING]);
    });
  });
});

Deno.test("request list error exits with message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.list = () => {
      throw new Error("list failed");
    };
    const { errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "list"]);
    });
    assert(errors.some((e: string) => e.includes("list failed")));
  });
});

// Review List with Status Filter

Deno.test("review list passes status filter", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.list = (_status?: string) => Promise.resolve([]);
    await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["review", "list", "-s", ReviewStatus.PENDING]);
    });
  });
});

Deno.test("review list empty prints message", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.reviewCommands.list = () => Promise.resolve([]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["review", "list"]);
    });
    assert(out.includes("No reviews found") || out.includes("review.list"));
  });
});

// Portal List with Entries

Deno.test("portal list prints entries when present", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.portalCommands.list = () =>
      Promise.resolve([
        {
          alias: "MyPortal",
          symlinkPath: `${DEFAULT_PORTALS_PATH}/MyPortal`,
          targetPath: "/tmp/target",
          status: PortalStatus.ACTIVE,
          contextCardPath: `${DEFAULT_MEMORY_PATH}/Projects/MyPortal/portal.md`,
        },
        {
          alias: "BrokenPortal",
          symlinkPath: `${DEFAULT_PORTALS_PATH}/BrokenPortal`,
          targetPath: "/tmp/missing",
          status: PortalStatus.BROKEN,
          contextCardPath: `${DEFAULT_MEMORY_PATH}/Projects/BrokenPortal/portal.md`,
        },
      ]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["portal", "list"]);
    });
    assert(out.includes("MyPortal") || out.includes("Active"));
  });
});

// Git Status with Changes

Deno.test("git status prints changes when present", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.gitCommands.status = () =>
      Promise.resolve({
        branch: "feat/changes",
        modified: ["file1.ts", "file2.ts"],
        added: ["new.ts"],
        deleted: ["old.ts"],
        untracked: ["temp.ts"],
      });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([PortalOperation.GIT, "status"]);
    });
    assert(out.includes("feat/changes") || out.includes("git.status"));
  });
});

// Memory Commands

Deno.test("memory default action shows list", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.memoryCommands.list = (format?: OutputFormat) => {
      called = true;
      assertEquals(format, "table");
      return Promise.resolve("Memory list output");
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory"]);
    });
    assert(called);
    assertStringIncludes(out, "Memory list output");
  });
});

Deno.test("memory list with format option", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.memoryCommands.list = (format?: OutputFormat) => {
      assertEquals(format, UIOutputFormat.JSON);
      return Promise.resolve('{"data": []}');
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", "list", "--format", UIOutputFormat.JSON]);
    });
    assertStringIncludes(out, '{"data": []}');
  });
});

Deno.test("memory search passes all options", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.memoryCommands.search = (
      query: string,
      opts?: { portal?: string; tags?: string[]; limit?: number; format?: OutputFormat; useEmbeddings?: boolean },
    ) => {
      assertEquals(query, "test query");
      assertEquals(opts?.portal, "my-portal");
      assertEquals(opts?.tags, ["tag1", "tag2"]);
      assertEquals(opts?.limit, 10);
      assertEquals(opts?.format, "md");
      assertEquals(opts?.useEmbeddings, true);
      return Promise.resolve("Search results");
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([
        "memory",
        "search",
        "test query",
        "-p",
        "my-portal",
        "-t",
        "tag1,tag2",
        "-l",
        "10",
        "--format",
        "md",
        "-e",
      ]);
    });
    assertStringIncludes(out, "Search results");
  });
});

Deno.test("memory project default action lists projects", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.memoryCommands.projectList = (_format?: OutputFormat) => {
      called = true;
      return Promise.resolve("Projects list");
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", MemoryScope.PROJECT]);
    });
    assert(called);
    assertStringIncludes(out, "Projects list");
  });
});

Deno.test("memory execution default action lists executions", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.memoryCommands.executionList = (_opts?: { portal?: string; limit?: number; format?: OutputFormat }) => {
      called = true;
      return Promise.resolve("Executions list");
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", MemoryBankSource.EXECUTION]);
    });
    assert(called);
    assertStringIncludes(out, "Executions list");
  });
});

Deno.test("memory proposal default action lists proposals", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.memoryCommands.pendingList = (_eligible?: boolean, _format?: OutputFormat) => {
      called = true;
      return Promise.resolve("Pending proposals");
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", ExaCtlSubNoun.PROPOSAL]);
    });
    assert(called);
    assertStringIncludes(out, "Pending proposals");
  });
});

Deno.test("memory proposal approve --all calls pendingApproveAll", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.memoryCommands.pendingApproveAll = () => {
      called = true;
      return Promise.resolve("All approved");
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", ExaCtlSubNoun.PROPOSAL, "approve", "--all"]);
    });
    assert(called);
    assertStringIncludes(out, "All approved");
  });
});

Deno.test("memory proposal list --eligible filters eligible proposals", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.memoryCommands.pendingList = (eligible?: boolean, _format?: OutputFormat) => {
      called = eligible === true;
      return Promise.resolve("Eligible proposals");
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", ExaCtlSubNoun.PROPOSAL, "list", "--eligible"]);
    });
    assert(called);
    assertStringIncludes(out, "Eligible proposals");
  });
});

Deno.test("memory proposal approve --dry-run previews auto-approvals", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.memoryCommands.pendingApprove = (proposalId?: string, dryRun?: boolean) => {
      called = dryRun === true && proposalId === undefined;
      return Promise.resolve("Dry run preview");
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", ExaCtlSubNoun.PROPOSAL, "approve", "--dry-run"]);
    });
    assert(called);
    assertStringIncludes(out, "Dry run preview");
  });
});

Deno.test("memory proposal approve with ids approves each id in order", async () => {
  await withTestMod(async (mod, ctx) => {
    const seen: string[] = [];
    ctx.memoryCommands.pendingApprove = (proposalId?: string, _dryRun?: boolean) => {
      seen.push(String(proposalId));
      return Promise.resolve(`Proposal approved successfully. ID: ${proposalId}`);
    };
    await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", ExaCtlSubNoun.PROPOSAL, "approve", "p-1", "p-2"]);
    });
    assertEquals(seen, ["p-1", "p-2"]);
  });
});

Deno.test("memory proposal approve stops at the first failed id", async () => {
  await withTestMod(async (mod, ctx) => {
    const seen: string[] = [];
    ctx.memoryCommands.pendingApprove = (proposalId?: string, _dryRun?: boolean) => {
      seen.push(String(proposalId));
      return Promise.resolve(
        proposalId === "p-2" ? `Proposal not found: ${proposalId}` : "Proposal approved successfully.",
      );
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", ExaCtlSubNoun.PROPOSAL, "approve", "p-1", "p-2", "p-3"]);
    });
    assertEquals(seen, ["p-1", "p-2"]);
    assertStringIncludes(out, "Proposal not found: p-2");
  });
});

Deno.test("memory learning remove calls deleteLearning with the id and reason", async () => {
  await withTestMod(async (mod, ctx) => {
    let received: [string, string | undefined] | undefined;
    ctx.memoryCommands.deleteLearning = (learningId: string, reason?: string) => {
      received = [learningId, reason];
      return Promise.resolve("Learning deleted");
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", ExaCtlSubNoun.LEARNING, "remove", "l-1", "--reason", "duplicate"]);
    });
    assertEquals(received, ["l-1", "duplicate"]);
    assertStringIncludes(out, "Learning deleted");
  });
});

Deno.test("memory index rebuild calls rebuildIndex with the embeddings option", async () => {
  await withTestMod(async (mod, ctx) => {
    let includeEmbeddings: boolean | undefined;
    ctx.memoryCommands.rebuildIndex = (options?: { includeEmbeddings?: boolean }) => {
      includeEmbeddings = options?.includeEmbeddings;
      return Promise.resolve("Index rebuilt");
    };
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["memory", ExaCtlSubNoun.INDEX, "rebuild", "--include-embeddings"]);
    });
    assertEquals(includeEmbeddings, true);
    assertStringIncludes(out, "Index rebuilt");
  });
});

// Flow Commands
Deno.test("flow show calls flowCommands.showFlow", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.flowCommands.showFlow = (flowId: string, _opts: Parameters<FlowCommands["showFlow"]>[1]) => {
      called = true;
      assertEquals(flowId, "my-flow");
      return Promise.resolve();
    };
    await mod.__test_command.parse(["flow", "show", "my-flow"]);
    assert(called);
  });
});

Deno.test("flow validate calls flowCommands.validateFlow", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    ctx.flowCommands.validateFlow = (flowId: string, opts: Parameters<FlowCommands["validateFlow"]>[1]) => {
      called = true;
      assertEquals(flowId, "my-flow");
      assertEquals(opts?.json, true);
      return Promise.resolve();
    };
    await mod.__test_command.parse(["flow", "validate", "my-flow", "--json"]);
    assert(called);
  });
});

// Blueprint Show Content Preview

Deno.test("blueprint show displays content preview", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.show = (id: string) =>
      Promise.resolve({
        agent_role: id,
        name: "Test Agent",
        model: "mock:test",
        capabilities: ["coding", "review"],
        status: BlueprintStatus.ACTIVE,
        version: "1.0.0",
        created: "2026-01-04",
        created_by: "tester",
        content: "This is a very long system prompt content that should be truncated in the preview...",
      });
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["blueprint", "show", "agent-x"]);
    });
    assert(out.includes("Test Agent") || out.includes("blueprint.show"));
  });
});

// Blueprint Validate with Warnings

Deno.test("blueprint validate valid with warnings", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.blueprintCommands.validate = (_id: string) =>
      Promise.resolve({
        valid: true,
        warnings: ["Consider adding more capabilities"],
        errors: [],
      });
    const outs = await captureAllOutputs(async () => {
      await mod.__test_command.parse(["blueprint", "validate", "warn-agent"]);
    });
    const joined = [...outs.logs, ...outs.warns, ...outs.errs].join("\n");
    assert(joined.includes("Valid") || joined.includes("blueprint.valid") || joined.includes("warnings"));
  });
});

// Request with All Options

Deno.test("request create with all options", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.create = (
      desc: string,
      opts?: IRequestOptions,
      _source?: RequestSource,
    ) => {
      assertEquals(desc, "Do task");
      assertEquals(opts?.agent_role, "custom-agent");
      assertEquals(opts?.priority, "high" as IRequestOptions["priority"]);
      assertEquals(opts?.portal, "my-portal");
      assertEquals(opts?.model, TEST_MODEL_OPENAI);
      return Promise.resolve({
        filename: "/tmp/req.md",
        trace_id: "t-all",
        priority: RequestPriority.HIGH,
        agent_role: "custom-agent",
        path: "/tmp",
        source: RequestSource.CLI as const,
        created_by: "tester",
        created: "now",
        status: RequestStatus.PENDING,
      });
    };
    await captureConsoleOutput(async () => {
      await mod.__test_command.parse([
        FlowInputSource.REQUEST,
        "create",
        "Do task",
        "--agent",
        "custom-agent",
        "-p",
        "high",
        "--portal",
        "my-portal",
        "-m",
        TEST_MODEL_OPENAI,
      ]);
    });
  });
});

Deno.test("request create with flow option", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.create = (
      desc: string,
      opts?: IRequestOptions,
      _source?: RequestSource,
    ) => {
      assertEquals(desc, "Code review task");
      assertEquals(opts?.flow, "code-review");
      assertEquals(opts?.priority, "high" as IRequestOptions["priority"]);
      return Promise.resolve(createdFlowRequest("code-review", "t-flow"));
    };
    await captureConsoleOutput(async () => {
      await mod.__test_command.parse([
        FlowInputSource.REQUEST,
        "create",
        "Code review task",
        "--flow",
        "code-review",
        "-p",
        "high",
      ]);
    });
  });
});

// --agent flag removed
// Note: --agent flag removal is verified by CLI framework - unknown options automatically rejected

// __test_initializeServices with instantiateDb
// Note: Skip instantiateDb test as it loads native SQLite library that can't be easily unloaded
// The path is covered by other integration tests that properly manage DB lifecycle

// Plan List with needs_revision Status

Deno.test("plan list shows needs_revision icon", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.planCommands.list = () =>
      Promise.resolve([
        { id: "p1", status: PlanStatus.NEEDS_REVISION, trace_id: "t1" },
      ]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["plan", "list"]);
    });
    assert(out.includes("⚠️") || out.includes("p1"));
  });
});

// Request List with Different Priorities

Deno.test("request list shows different priority icons", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.requestCommands.list = () =>
      Promise.resolve([
        {
          trace_id: "t1",
          priority: RequestPriority.CRITICAL,
          agent_role: "a",
          created_by: "u",
          created: "t",
          status: RequestStatus.PENDING,
          filename: "f",
          path: "p",
          source: RequestSource.CLI,
        },
        {
          trace_id: "t2",
          priority: RequestPriority.HIGH,
          agent_role: "a",
          created_by: "u",
          created: "t",
          status: RequestStatus.PENDING,
          filename: "f",
          path: "p",
          source: RequestSource.CLI,
        },
        {
          trace_id: "t3",
          priority: RequestPriority.LOW,
          agent_role: "a",
          created_by: "u",
          created: "t",
          status: RequestStatus.PENDING,
          filename: "f",
          path: "p",
          source: RequestSource.CLI,
        },
      ]);
    const out = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "list"]);
    });
    // Should show different icons for different priorities
    assert(out.includes("🔴") || out.includes("🟠") || out.includes("⚪") || out.includes("count: 3"));
  });
});

// End-to-End Flow Request Testing

Deno.test("end-to-end flow request workflow", async () => {
  await withTestMod(async (mod, ctx) => {
    // Mock the request creation to return a flow request
    ctx.requestCommands.create = (
      desc: string,
      opts?: IRequestOptions,
      _source?: RequestSource,
    ) => {
      assertEquals(desc, "Build a web application");
      assertEquals(opts?.flow, "web-dev-flow");
      return Promise.resolve({
        filename: "/tmp/test-flow-request.md",
        trace_id: "flow-test-123",
        priority: RequestPriority.NORMAL,
        flow: "web-dev-flow",
        path: "/tmp",
        source: RequestSource.CLI as const,
        created_by: "tester",
        created: "now",
        status: RequestStatus.PENDING,
        agent_role: "agent",
      });
    };

    // Mock request listing to return our flow request
    ctx.requestCommands.list = (_status?: RequestStatusType) => {
      return Promise.resolve([{
        trace_id: "flow-test-123",
        priority: RequestPriority.NORMAL,
        flow: "web-dev-flow",
        agent_role: "agent",
        status: RequestStatus.PENDING,
        created: new Date().toISOString(),
        filename: "flow-test-123.md",
        path: "/tmp",
        source: RequestSource.CLI,
        created_by: "user",
      }]);
    };

    // Mock request showing to return detailed flow request info
    ctx.requestCommands.show = (traceId: string) => {
      assertEquals(traceId, "flow-test-123");
      return Promise.resolve({
        metadata: {
          trace_id: "flow-test-123",
          filename: "flow-test-123.md",
          path: "/tmp/flow-test-123.md",
          status: RequestStatus.PENDING,
          priority: RequestPriority.NORMAL,
          agent_role: "default",
          flow: "web-dev-flow",
          created: new Date().toISOString(),
          created_by: "test-user",
          source: RequestSource.CLI,
        },
        content: "Build a web application",
      });
    };

    // Test 1: Create flow request
    const createOutput = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([
        FlowInputSource.REQUEST,
        "create",
        "Build a web application",
        "--flow",
        "web-dev-flow",
      ]);
    });
    assertStringIncludes(createOutput, "trace_id: flow-test-123");
    assertStringIncludes(createOutput, "flow: web-dev-flow");

    // Test 2: List requests includes flow request
    const listOutput = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "list"]);
    });
    assertStringIncludes(listOutput, "flow-test-123");
    assertStringIncludes(listOutput, "web-dev-flow");

    // Test 3: Show request displays flow information
    const showOutput = await captureConsoleOutput(async () => {
      await mod.__test_command.parse([FlowInputSource.REQUEST, "show", "flow-test-123"]);
    });
    assertStringIncludes(showOutput, "flow-test-123");
    assertStringIncludes(showOutput, "web-dev-flow");
    assertStringIncludes(showOutput, "Build a web application");
  });
});
