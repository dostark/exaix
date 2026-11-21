/**
 * @module GoMakeGatesTest
 * @path tests/scripts/go_make_gates_test.ts
 * @description Exercises the shared exaix-go Make gates, hook and workflow topology.
 * @architectural-layer Test
 */
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { goCheckout } from "../../scripts/go_port/checkout.ts";
import { commitBase, copyCheckout, git, make, TARGETS } from "./helpers/go_checkout_fixture.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const checkout = await goCheckout(ROOT, Deno.env.get("EXAIX_REQUIRE_GO") === "1");
function copy(dir: string): Promise<string> {
  if (!checkout) throw new Error("The Go checkout is required for this case");
  return copyCheckout(checkout, dir);
}

Deno.test("go-make-check: both entry points pass the clean candidate", { ignore: checkout === undefined }, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    for (const target of ["check", "ci"]) {
      const result = await make(repo, target);
      assertEquals(result.code, 0, result.text);
      assertStringIncludes(result.text, "edition stub ok");
      for (const platform of TARGETS) assertStringIncludes(result.text, `build ${platform}`);
    }
  });
});

Deno.test(
  "go-make-fmt: a formatting-only change fails without rewriting bytes",
  { ignore: checkout === undefined },
  async () => {
    await withTempDir(async (dir) => {
      const repo = await copy(dir);
      const file = join(repo, "format_seed.go");
      const content = "package seed\nfunc Bad( ){}\n";
      await Deno.writeTextFile(file, content);
      const result = await make(repo, "fmt");
      assertNotEquals(result.code, 0);
      assertStringIncludes(result.text, "gofmt needs to format");
      assertEquals(await Deno.readTextFile(file), content);
    });
  },
);

Deno.test("go-make-vet: an unused import fails the vet gate", { ignore: checkout === undefined }, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    const packageDir = join(repo, "import_seed");
    await Deno.mkdir(packageDir);
    await Deno.writeTextFile(join(packageDir, "seed.go"), 'package import_seed\n\nimport "fmt"\n');
    const result = await make(repo, "vet");
    assertNotEquals(result.code, 0);
    assertStringIncludes(result.text, "imported and not used");
  });
});

Deno.test("go-make-race: the host race test detects a seeded race", { ignore: checkout === undefined }, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    const packageDir = join(repo, "race_seed");
    await Deno.mkdir(packageDir);
    await Deno.writeTextFile(
      join(packageDir, "race_test.go"),
      'package race_seed\n\nimport "testing"\n\nfunc TestRace(t *testing.T) {\n\tvalue := 0\n\tdone := make(chan struct{})\n\tgo func() { value++; close(done) }()\n\tvalue++\n\t<-done\n}\n',
    );
    const result = await make(repo, "test");
    assertNotEquals(result.code, 0);
    assertStringIncludes(result.text, "DATA RACE");
  });
});

Deno.test(
  "go-make-tidy: an untidy module fails without changing module bytes",
  { ignore: checkout === undefined },
  async () => {
    await withTempDir(async (dir) => {
      const repo = await copy(dir);
      const goMod = join(repo, "go.mod");
      const original = await Deno.readTextFile(goMod);
      const broken = original.replace("\tgolang.org/x/mod v0.43.0 // indirect\n", "");
      assert(broken !== original);
      await Deno.writeTextFile(goMod, broken);
      const result = await make(repo, "tidy");
      assertNotEquals(result.code, 0);
      assertStringIncludes(result.text, "golang.org/x/mod");
      assertEquals(await Deno.readTextFile(goMod), broken);
    });
  },
);

Deno.test(
  "go-make-stub: a stub that builds but exits unsuccessfully fails",
  { ignore: checkout === undefined },
  async () => {
    await withTempDir(async (dir) => {
      const repo = await copy(dir);
      const main = join(repo, "editionstub", "main.go");
      const original = await Deno.readTextFile(main);
      await Deno.writeTextFile(
        main,
        original.replace('"fmt"', '"fmt"\n\t"os"').replace(
          'fmt.Println("edition stub ok")',
          'fmt.Println("edition stub ok"); os.Exit(3)',
        ),
      );
      const result = await make(repo, "stub");
      assertNotEquals(result.code, 0);
      assertStringIncludes(result.text, "edition stub ok");
    });
  },
);

Deno.test("go-make-hook: the installed hook blocks and accepts in an ordinary clone", {
  ignore: checkout === undefined,
}, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    await commitBase(repo);
    assertEquals((await make(repo, "hooks")).code, 0);
    const bad = join(repo, "hook_seed.go");
    await Deno.writeTextFile(bad, "package seed\nfunc Bad( ){}\n");
    assertEquals((await git(repo, "add", "hook_seed.go")).code, 0);
    const rejected = await git(repo, "commit", "-m", "bad change");
    assertNotEquals(rejected.code, 0);
    assertStringIncludes(rejected.text, "gofmt needs to format");
    await Deno.remove(bad);
    await git(repo, "add", "-A");
    const good = join(repo, "hook_ok.go");
    await Deno.writeTextFile(good, "package seed\n\n// Value is a documented value.\nvar Value = 1\n");
    await git(repo, "add", "-A");
    const accepted = await git(repo, "commit", "-m", "clean change");
    assertEquals(accepted.code, 0, accepted.text);
  });
});

Deno.test("go-make-hook: the installed hook blocks and accepts in a submodule clone", {
  ignore: checkout === undefined,
}, async () => {
  await withTempDir(async (dir) => {
    const source = await copy(dir);
    await commitBase(source);
    const parent = join(dir, "parent");
    await Deno.mkdir(parent);
    assertEquals((await git(parent, "init", "-q")).code, 0);
    const added = await git(parent, "-c", "protocol.file.allow=always", "submodule", "add", source, "exaix-go");
    assertEquals(added.code, 0, added.text);
    assertEquals((await git(parent, "commit", "-q", "-m", "base")).code, 0);
    const sub = join(parent, "exaix-go");
    assertEquals((await make(sub, "hooks")).code, 0);
    const bad = join(sub, "hook_seed.go");
    await Deno.writeTextFile(bad, "package seed\nfunc Bad( ){}\n");
    assertEquals((await git(sub, "add", "hook_seed.go")).code, 0);
    const rejected = await git(sub, "commit", "-m", "bad change");
    assertNotEquals(rejected.code, 0);
    assertStringIncludes(rejected.text, "gofmt needs to format");
    await Deno.remove(bad);
    await git(sub, "add", "-A");
    await Deno.writeTextFile(
      join(sub, "hook_ok.go"),
      "package seed\n\n// Value is a documented value.\nvar Value = 1\n",
    );
    await git(sub, "add", "-A");
    const accepted = await git(sub, "commit", "-m", "clean change");
    assertEquals(accepted.code, 0, accepted.text);
  });
});
