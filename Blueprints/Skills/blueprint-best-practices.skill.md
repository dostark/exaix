---
id: "550e8400-e29b-41d4-a716-446655440025"
created_at: "2026-06-29T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "blueprint-best-practices"
name: "Blueprint Best Practices"
version: "1.0.0"
description: "Guidelines for generating high-quality, executable plans — precision, grounding, executability, minimal change, and risk awareness"

triggers:
  tags:
    - best-practices
    - plan-quality
    - blueprint

constraints:
  - "Never overwrite unrelated changes — use patch_file for targeted edits to large files"
  - "Only cite files and symbols that exist in the provided portal context; verify before acting"
  - "Every plan step must have concrete successCriteria and explicit tools/actions"
  - "Solve the task with the fewest edits that satisfy the requirements"

output_requirements:
  - "Precision: use patch_file for targeted edits, write_file only for new or small files"
  - "Ground references: verify file/symbol existence before acting"
  - "Executable steps: each step has concrete successCriteria and explicit tools/actions"
  - "Minimal change: solve with the fewest edits that satisfy requirements"
  - "Assumptions and risks: surface ambiguity and destructive actions explicitly"

quality_criteria:
  - name: "Grounding"
    description: "Every referenced file and symbol is verified to exist"
    weight: 30
  - name: "Executability"
    description: "Each step is independently verifiable and runnable"
    weight: 30
  - name: "Scope Discipline"
    description: "The plan solves the task without speculative refactors or unrequested scope"
    weight: 20
  - name: "Risk Transparency"
    description: "Ambiguities and destructive actions are surfaced explicitly"
    weight: 20

compatible_with:
  agents:
    - "*"
---

# Blueprint Best Practices

1. **Precision**: Use `patch_file` for targeted edits to large files; reserve `write_file` for new or small files so you never overwrite unrelated changes.

2. **Ground every reference**: Only cite files and symbols that exist in the provided portal context; verify with `read_file`/`grep_search` before acting, and never invent paths or modules.

3. **Make steps executable**: Each plan step needs concrete `successCriteria` and, where it changes the workspace, explicit `tools`/`actions` — a step a reader cannot verify or run is not done.

4. **Prefer the smallest change**: Solve the task with the fewest edits that satisfy the requirements; avoid speculative refactors or unrequested scope.

5. **State assumptions and risks**: If a requirement is ambiguous or an action is destructive, surface it in `<thought>` and list it under the plan's `risks` rather than guessing silently.
