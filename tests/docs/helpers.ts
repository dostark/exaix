/**
 * @module KnowledgeDocsHelpers
 * @path tests/docs/helpers.ts
 * @description Provides common utilities for documentation verification,
 * including Markdown section parsing and link validation.
 */

const USER_GUIDE_DIR = "docs/user_guide";

/**
 * Read the User Guide: every topic file of docs/user_guide, in name order, joined into one text.
 */
export async function readUserGuide(): Promise<string> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(USER_GUIDE_DIR)) {
    if (entry.isFile && entry.name.endsWith(".md")) names.push(entry.name);
  }
  names.sort();
  const parts = await Promise.all(names.map((name) => Deno.readTextFile(`${USER_GUIDE_DIR}/${name}`)));
  return parts.join("\n\n");
}

/**
 * Read the Model Settings document
 */
export async function readModelSettings(): Promise<string> {
  return await Deno.readTextFile("docs/Model_Settings.md");
}

/**
 * Check if a template file exists
 */
export async function templateExists(filename: string): Promise<boolean> {
  try {
    await Deno.stat(`templates/${filename}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read any documentation file from docs/
 */
export async function readDoc(filename: string): Promise<string> {
  return await Deno.readTextFile(`docs/${filename}`);
}
