/**
 * @module LazyProviderTest
 * @path tests/ai/lazy_provider_test.ts
 * @description Verifies the LazyProvider wrapper, ensuring that heavy provider backends
 * are only initialized upon first use to optimize startup performance.
 */

import { assertEquals } from "@std/assert";
import type { IProviderFactory } from "../../src/factories/abstract_provider_factory.ts";
import { LazyProvider } from "../../src/providers/lazy_provider.ts";
import { ProviderType } from "@exaix/core";
import type { IModelOptions, IModelProvider, IResolvedProviderOptions } from "../../src/types.ts";
import type { IGenerateResult } from "../../src/providers/common.ts";

Deno.test("LazyProvider: derives id from constructor arg > options.id > provider-model", () => {
  const factory: IProviderFactory = {
    create: (_options: IResolvedProviderOptions) => Promise.reject(new Error("not used")),
  };

  const optsWithId: IResolvedProviderOptions = {
    provider: ProviderType.MOCK,
    model: "m",
    id: "opt-id",
    timeoutMs: 1000,
  };
  const optsNoId: IResolvedProviderOptions = {
    provider: ProviderType.MOCK,
    model: "m",
    timeoutMs: 1000,
  };

  const a = new LazyProvider(factory, optsWithId, "ctor-id");
  const b = new LazyProvider(factory, optsWithId);
  const c = new LazyProvider(factory, optsNoId);

  assertEquals(a.id, "ctor-id");
  assertEquals(b.id, "opt-id");
  assertEquals(c.id, "mock-m");
});

Deno.test("LazyProvider: initializes underlying provider only once", async () => {
  const createdWith: IResolvedProviderOptions[] = [];
  let createCalls = 0;
  const generateCalls: Array<{ prompt: string; options?: IModelOptions }> = [];

  const underlying: IModelProvider = {
    id: "underlying",
    generate: (prompt: string, options?: IModelOptions): Promise<IGenerateResult> => {
      generateCalls.push({ prompt, options });
      return Promise.resolve({
        content: `out:${prompt}`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: "m",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };

  const factory: IProviderFactory = {
    create: (options: IResolvedProviderOptions) => {
      createCalls++;
      createdWith.push(options);
      return Promise.resolve(underlying);
    },
  };

  const opts: IResolvedProviderOptions = {
    provider: ProviderType.MOCK,
    model: "m",
    timeoutMs: 1000,
  };
  const lazy = new LazyProvider(factory, opts);

  const out1 = await lazy.generate("a", { temperature: 0 });
  const out2 = await lazy.generate("b");

  assertEquals(out1.content, "out:a");
  assertEquals(out2.content, "out:b");
  assertEquals(createCalls, 1);
  assertEquals(createdWith[0], opts);
  assertEquals(generateCalls.length, 2);
  assertEquals(generateCalls[0].prompt, "a");
  assertEquals(generateCalls[1].prompt, "b");
});
