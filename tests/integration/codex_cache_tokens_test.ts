/**
 * @module CodexCacheTokensIntegrationTest
 * @path tests/integration/codex_cache_tokens_test.ts
 * @description Replays verbatim live Codex exec JSONL through the daemon's provider
 * wrappers into dedicated SQLite cache columns and the exactl cost report.
 * @architectural-layer Integration
 * @related-files [packages/ai-clidelegate/src/cli_delegate_model_provider.ts, packages/ai/src/traced_provider.ts, packages/ai/src/rate_limited_provider.ts, apps/exactl/src/commands/cost_commands.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { stub } from "@std/testing/mock";
import { CliDelegateModelProvider } from "@exaix/ai-clidelegate";
import { RateLimitedProvider } from "../../packages/ai/src/rate_limited_provider.ts";
import { TracedProvider } from "../../packages/ai/src/traced_provider.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { CostTracker } from "@exaix/core/cost";
import { createStubConfig, createStubDisplay, createStubGit, initTestDbService } from "@exaix/testing";
import { CostCommands } from "../../apps/exactl/src/commands/cost_commands.ts";

interface ICodexCacheActivityRow {
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
}

Deno.test("[Codex cache tokens] live exec JSONL survives provider wrappers, dedicated activity columns and exactl cost", async () => {
  const stdout: string = await Deno.readTextFile(
    new URL("./fixtures/codex-cache-tokens/exec.jsonl", import.meta.url),
  );
  const { db, config, tempDir, cleanup } = await initTestDbService();
  const cost: CostTracker = new CostTracker(db);
  try {
    const delegate: CliDelegateModelProvider = new CliDelegateModelProvider({
      tool: "codex",
      bin: "codex",
      model: "gpt-5.6-sol",
      cwd: tempDir,
      run: () => Promise.resolve({ code: 0, stdout, stderr: "" }),
    });
    // ProviderFactory.createAndWrap traces the delegate before applying rate limiting.
    const provider: RateLimitedProvider = new RateLimitedProvider(
      new TracedProvider(delegate, new EventLogger({ db })),
      {
        maxCallsPerMinute: 1,
        maxTokensPerHour: 100_000,
        maxCostPerDay: 1,
        costPer1kTokens: 0,
        costTracker: cost,
      },
    );
    const result: IGenerateResult = await provider.generate("Reply with exactly the word: pong");
    assertEquals(result.content, "pong");
    assertEquals(result.usage, {
      promptTokens: 23239,
      completionTokens: 5,
      totalTokens: 23244,
      cacheReadTokens: 11136,
      cacheCreationTokens: undefined,
    });

    await cost.flush();
    await db.waitForFlush();
    const rows: ICodexCacheActivityRow[] = db.instance.prepare(
      "SELECT prompt_tokens, completion_tokens, cache_read_tokens, cache_creation_tokens FROM activity WHERE action_type = ?",
    ).all(DomainEventType.LlmCallCompleted) as ICodexCacheActivityRow[];
    assertEquals(rows, [{
      prompt_tokens: 23239,
      completion_tokens: 5,
      cache_read_tokens: 11136,
      cache_creation_tokens: null,
    }]);
    const records = await cost.queryByCriteria({});
    assertEquals(records.length, 1);
    assertEquals(records[0].cacheReadTokens, 11136);
    assertEquals(records[0].cacheCreationTokens, undefined);

    const output: string[] = [];
    const logSpy = stub(console, "log", (...args: Parameters<typeof console.log>): void => {
      output.push(args.join(" "));
    });
    try {
      await new CostCommands({
        db,
        cost,
        provider,
        config: createStubConfig(config),
        git: createStubGit(),
        display: createStubDisplay(db),
      }).show({});
    } finally {
      logSpy.restore();
    }
    const rendered: string = output.join("\n");
    assertStringIncludes(rendered, "11136/-");
    assertStringIncludes(rendered, "Total Cache Tokens:  Read: 11136, Creation: 0");
  } finally {
    await cost.flush();
    await cleanup();
  }
});
