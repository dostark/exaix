---
id: 4e1b2c3d-5f2a-4a8b-9c1d-0e1f2a3b4c5d
created_at: "2026-09-24T00:00:00.000Z"
source: user
scope: global
status: active
skill_id: ste-metadata-only
name: STE Metadata-Only Fixture
version: 1.0.0
description: Fixture proving metadata obligations survive through the body formatter.
triggers:
  keywords: [metadata, obligation]
  task_types: [communication]
  tags: [ste, metadata]
critical: false
constraints:
  - Response must keep the required action first.
  - Confirm unresolved requirements remain pending.
output_requirements:
  - A complete answer with an explicit next action.
---

# STE Metadata-Only Fixture

## Reviewed body equivalent

Response must keep the required action first.
Confirm unresolved requirements remain pending.
Hold these obligations in the body because the runtime formatter renders the body,
never the constraints or output_requirements metadata lists.
