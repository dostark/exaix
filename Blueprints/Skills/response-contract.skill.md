---
id: "550e8400-e29b-41d4-a716-446655440012"
created_at: "2026-06-29T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "response-contract"
name: "Response Output Contract"
version: "1.0.0"
description: "The mandatory <thought>/<content> response format and executable-plan JSON contract every agent must emit."
critical: true

triggers:
  tags:
    - response-contract
    - output-format

constraints:
  - "Respond with exactly a <thought> block and a <content> block; ignore everything outside them"
  - "<content> must be a single valid, self-contained JSON object with no surrounding commentary"
  - "A plan's content must match the executable-plan JSON schema (title, description, steps[])"

output_requirements:
  - "A <thought> block with reasoning and tool-selection logic"
  - "A <content> block containing valid JSON for the requested deliverable"

quality_criteria:
  - name: "Contract Compliance"
    description: "Output has both tags and a valid JSON content block"
    weight: 60
  - name: "Self-Containment"
    description: "The content JSON parses standalone with no extra prose"
    weight: 40

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Response Output Contract

You MUST respond with exactly two sections, each wrapped in XML-like tags. Any
text outside these tags is ignored.

1. `<thought>` — Your internal analysis: reasoning, plan breakdown, architectural
   decisions, and tool-selection logic. Not parsed as structured data.

2. `<content>` — Your deliverable. For a plan this MUST be a single valid JSON
   object matching the executable-plan schema; for an analysis or evaluation, the
   structured object the task asks for. The `<content>` block is extracted and
parsed by the runtime, so it must be valid, self-contained, and free of
commentary.

> **See also:** [Agent Thought Standardization](/.copilot/docs/agent-thought-standardization.md) — standardized reasoning structure for the `<thought>` block.

## Executable-plan JSON schema

```json
{
  "title": "Short descriptive title (required)",
  "description": "What this plan accomplishes (required)",
  "steps": [
    {
      "step": 1,
      "title": "Step name (required)",
      "description": "What this step performs (required)",
      "tools": ["read_file", "write_file"],
      "actions": [
        { "tool": "write_file", "params": { "path": "src/...", "content": "..." } }
      ],
      "successCriteria": ["A verifiable check"],
      "dependencies": [],
      "rollback": "How to undo this step"
    }
  ],
  "estimatedDuration": "e.g. 2-3 hours",
  "risks": ["Potential issue"]
}
```

## Minimal example

```xml
<thought>
The request asks to add input validation. I will add a boundary schema check and
a rejection test.
</thought>

<content>
{
  "title": "Add input validation to the request handler",
  "description": "Validate the request body with a schema at the entry point.",
  "steps": [
    {
      "step": 1,
      "title": "Add boundary validation",
      "description": "Parse and reject malformed input before business logic.",
      "tools": ["read_file", "write_file"],
      "successCriteria": ["Invalid input is rejected", "A rejection test passes"]
    }
  ]
}
</content>
```
