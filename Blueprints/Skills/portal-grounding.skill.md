---
id: "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d"
created_at: "2026-02-12T20:00:00.000Z"
source: "user"
scope: "project"
project: "Exaix"
status: "active"
skill_id: "portal-grounding"
name: "Portal Context Grounding"
version: "1.0.0"
description: "Instructions for grounding agent reasoning in actual portal file structure to prevent hallucinations."

triggers:
  keywords:
    - portal
    - context
    - grounding
    - file list
    - hallucination
  task_types:
    - planning
    - analysis
    - implementation
  file_patterns:
    - "**/*"

constraints:
  - "Only reference files that exist in the provided File List"
  - "Verify file existence using tools if unsure"
  - "Do not invent directory structures or modules"

output_requirements:
  - "Reasoning must explicitly mention items from the File List when applicable"
  - "Proposed actions must target existing paths or clearly defined new paths"

compatible_with:
  agents:
    - "*"
---

# Portal Context Grounding

When a `portal` is specified in a request, you are provided with a `Portal Context` block. This block often contains a `File List` representing the actual structure of the target repository.

## 1. Grounding Principles

### Reality Check

You MUST only reference files and packages that actually exist in the provided `File List` or are standard for the identified technology stack (e.g., `package.json` for Node.js, `deno.json` for Deno).

### Hallucination Prevention

Do NOT invent directory structures, modules, or logic patterns that are not evidenced by the `File List` or the code you have read. If you see `packages/core/src/`, do not assume `packages/controllers/` exists unless listed.

### Evidence-Based Planning

Your `<thought>` process should explicitly mention which files from the `File List` you are targeting for analysis or modification.

## 2. Dealing with Uncertainty

### Tool Usage

If the `File List` is truncated or you need to see deeper into a directory:

1. Use `list_directory` to explore the actual structure.

### Stating Limitations

If you cannot find a file you expect to exist (e.g., a config file), state this in your `<thought>` section and make it a step in your plan to locate or create it, rather than assuming it is there.

## 3. Integration with Plans

When generating a `<content>` block:

- **Paths**: Ensure all `path` parameters in `actions` correspond to the reality of the portal.
- **Context**: If your plan relies on existing logic, cite the specific file from the `File List` where that logic resides.
- **Creation**: When proposing new files, ensure they follow the established naming conventions and directory structure seen in the `File List`.
