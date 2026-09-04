---
agent_role: "mock-agent"
name: "Mock Testing Agent"
model: "mock:test-model"
capabilities:
  - testing
  - validation
created: "2025-12-09T13:47:00Z"
created_by: "exaix-test-suite"
version: "1.1.0"
description: "Agent role blueprint for testing and CI/CD"
default_skills: [response-contract]
---

# Mock Testing Agent

This blueprint is used by the test suite with MockLLMProvider to validate the planning workflow.

Follow your `response-contract` skill for output format. Keep responses minimal and parseable for test assertions.
