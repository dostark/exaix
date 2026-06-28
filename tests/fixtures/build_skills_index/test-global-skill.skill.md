---
id: "11111111-1111-4111-8111-111111111111"
created_at: "2026-01-01T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "test-global-skill"
name: "Test Global Skill"
version: "1.0.0"
description: "A global-scoped test skill."
triggers:
  tags:
    - testing
constraints:
  - "Always be deterministic"
output_requirements:
  - "Produce JSON"
quality_criteria:
  - name: "Determinism"
    description: "Output is deterministic"
    weight: 100
compatible_with:
  agents:
    - "*"
usage_count: 0
---

# Test Global Skill

These are the procedural instructions for the global test skill.
