/**
 * @module FormatMarkdownHelper
 * @path apps/exactl/tests/helpers/format_markdown.ts
 * @description Formats Markdown text with deno fmt and the repository settings, so a test can compare generated text with its formatted form.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [scripts/generate_cli_reference.ts]
 */

const REPO_CONFIG = new URL("../../../../deno.json", import.meta.url).pathname;

/** The text after `deno fmt` over standard input. */
export async function formatMarkdown(text: string): Promise<string> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["fmt", "--config", REPO_CONFIG, "--ext", "md", "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
  const { code, stdout, stderr } = await child.output();
  if (code !== 0) throw new Error(`deno fmt failed: ${new TextDecoder().decode(stderr)}`);
  return new TextDecoder().decode(stdout);
}
