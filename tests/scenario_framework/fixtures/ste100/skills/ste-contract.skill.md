---
id: 3d5c7f2e-4b1a-4c9f-8d2e-9a6b7c8d9e0f
created_at: "2026-09-24T00:00:00.000Z"
source: user
scope: global
status: active
skill_id: ste-contract
name: STE Contract for Agent Prose
version: 1.0.0
description: Mandatory ASD-STE100 and Exaix STE Extension v1 prose contract for instruction and response content.
triggers:
  keywords: [ste, communication, prose]
  task_types: [communication, documentation, explanation]
  tags: [communication, style, precision]
critical: true
tools: []
compatible_with:
  agents: ["*"]
---

# STE Contract for Agent Prose

## Canonical Communication requirement

Use ASD-STE100 and Exaix STE Extension v1 for instruction and response prose.
Cover skills, task analysis, status, code comments, and prose in structured responses.
Exempt documentation deliverables.
State the result, answer, or required action first.
Omit non-essential detail, self-reflection, and needless repetition.
Use bullets when they make related points, steps, or choices easier to scan.
Preserve required facts, conditions, constraints, evidence, and output formats.
Keep code, commands, names, paths, and exact quotations unchanged.

## Exaix STE Extension v1

Apply these five extension rules in addition to ASD-STE100 Issue 9.

- EXAIX-01 Lead with the answer, result, or next required action.
- EXAIX-02 Omit non-essential details and needless words.
- EXAIX-03 Omit self-reflection and narration of the thinking process.
- EXAIX-04 Do not repeat information already delivered.
- EXAIX-05 Prefer useful bullet lists to long prose.

## Reserved structured content contract

Preserve these six required sections verbatim in every response:

1. `<thought>` reasoning and tool-selection logic
1. `<content>` deliverable with no surrounding prose
1. Tags metadata block with stable keys
1. raw JSON body, never wrapped in a markdown fence
1. required facts summary
1. required action summary

Keep exact tags, schema keys, and markers unchanged in every response.

## Status prose coverage

Cover status prose and normal explanations with the rules above; documentation deliverables remain exempt.
