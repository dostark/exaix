---
identity_id: "aci-react"
name: "ACI ReAct Scenario Agent"
model: "mock:test-model"
capabilities:
  - react
permitted_tools:
  - read_file
created: "2026-08-25T00:00:00Z"
created_by: "exaix-test-suite"
version: "1.0.0"
description: "Identity blueprint for Phase 112 Step 7's real-daemon ACI injection scenarios"
---

# ACI ReAct Scenario Agent

This blueprint is used by the scenario framework with a real (mock-provider) daemon to prove
`agents.inject_aci_docs` reaches a real, provider-bound ReAct iteration. It is scoped to exactly
one tool (`read_file`) so the rendered ACI section, when enabled, is unambiguous.
