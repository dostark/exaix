/**
 * @module GoLayerGatesTest
 * @path tests/scripts/go_layer_gates_test.ts
 * @description Exercises the reserved layers, Layer 0 I/O ban and addon boundary.
 * @architectural-layer Test
 */
import { assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { goCheckout } from "../../scripts/go_port/checkout.ts";
import { copyCheckout, make } from "./helpers/go_checkout_fixture.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const checkout = await goCheckout(ROOT, Deno.env.get("EXAIX_REQUIRE_GO") === "1");
const FIXTURES = "tools/layercheck/testdata";

interface ISeed {
  fixture: string;
  target: string;
  rule: string;
  detail: string;
}

const seeds: readonly ISeed[] = [
  { fixture: "leaf/internal/leaf/seed.go", target: "internal/leaf/seed.go", rule: "leaf", detail: "internal/schemas" },
  {
    fixture: "schemas/internal/schemas/seed.go",
    target: "internal/schemas/seed.go",
    rule: "schemas",
    detail: "internal/core/l0",
  },
  {
    fixture: "l0_layer/internal/core/l0/seed.go",
    target: "internal/core/l0/seed.go",
    rule: "l0-layer",
    detail: "internal/core/l1",
  },
  { fixture: "l0_os/internal/core/l0/seed.go", target: "internal/core/l0/seed.go", rule: "l0-io", detail: "os" },
  { fixture: "l0_net/internal/core/l0/seed.go", target: "internal/core/l0/seed.go", rule: "l0-io", detail: "net" },
  {
    fixture: "l0_exec/internal/core/l0/seed.go",
    target: "internal/core/l0/seed.go",
    rule: "l0-io",
    detail: "os/exec",
  },
  {
    fixture: "l0_syscall/internal/core/l0/seed.go",
    target: "internal/core/l0/seed.go",
    rule: "l0-io",
    detail: "syscall",
  },
  { fixture: "cgo_windows/cmd/exaix/seed.go", target: "cmd/exaix/seed.go", rule: "cgo", detail: `import "C"` },
  {
    fixture: "cgo_cgo/internal/platform/seed.go",
    target: "internal/platform/seed.go",
    rule: "cgo",
    detail: `import "C"`,
  },
];

const allowed = [
  ["allowed/internal/leaf/seed.go", "internal/leaf/seed.go"],
  ["allowed/internal/schemas/seed.go", "internal/schemas/seed.go"],
  ["allowed/internal/core/l0/seed.go", "internal/core/l0/seed.go"],
  ["allowed/cmd/exaix_native/seed.go", "cmd/exaix_native/seed.go"],
] as const;

function copy(dir: string): Promise<string> {
  if (!checkout) throw new Error("The Go checkout is required for this case");
  return copyCheckout(checkout, dir);
}

async function plant(repo: string, fixture: string, target: string): Promise<void> {
  if (!checkout) throw new Error("The Go checkout is required for this case");
  const content = await Deno.readTextFile(join(checkout, FIXTURES, fixture));
  const path = join(repo, target);
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, content);
}

Deno.test("go-layercheck: the clean modules pass", { ignore: checkout === undefined }, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    const result = await make(repo, "layercheck");
    assertEquals(result.code, 0, result.text);
    assertStringIncludes(result.text, "layercheck: ok");
  });
});

for (const seed of seeds) {
  Deno.test(`go-layercheck: ${seed.rule} rejects ${seed.fixture} through make check`, {
    ignore: checkout === undefined,
  }, async () => {
    await withTempDir(async (dir) => {
      const repo = await copy(dir);
      await plant(repo, seed.fixture, seed.target);
      const result = await make(repo, "check");
      assertNotEquals(result.code, 0, result.text);
      assertStringIncludes(result.text, seed.target);
      assertStringIncludes(result.text, seed.rule);
      assertStringIncludes(result.text, seed.detail);
      await Deno.remove(join(repo, seed.target));
      const clean = await make(repo, "layercheck");
      assertEquals(clean.code, 0, clean.text);
    });
  });
}

Deno.test("go-layercheck: allowed internal and addon edges pass", { ignore: checkout === undefined }, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    for (const [fixture, target] of allowed) await plant(repo, fixture, target);
    const result = await make(repo, "layercheck");
    assertEquals(result.code, 0, result.text);
    assertStringIncludes(result.text, "layercheck: ok");
  });
});
