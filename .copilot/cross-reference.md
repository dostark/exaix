---
identity: general
scope: dev
title: Agent Documentation Cross-Reference Map
short_summary: "Quick reference mapping task types to relevant agent documentation files."
version: "0.1"
topics: ["navigation", "quick-reference", "task-mapping"]
---

## Agent Documentation Cross-Reference Map

## Task → Agent Doc Quick Reference

| Task Type                                     | Primary Doc                                                                                | Secondary Docs                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Write unit tests                              | [tests/testing.md](tests/testing.md)                                                       | [source/exaix.md](source/exaix.md)                                                                                                |
| Refactor code                                 | [source/exaix.md](source/exaix.md)                                                         | [tests/testing.md](tests/testing.md)                                                                                              |
| Update documentation                          | [docs/documentation.md](docs/documentation.md)                                             | -                                                                                                                                 |
| Fix TypeScript errors                         | [source/exaix.md](source/exaix.md)                                                         | [copilot/exaix.md](copilot/exaix.md)                                                                                              |
| Add new feature                               | [source/exaix.md](source/exaix.md) + [tests/testing.md](tests/testing.md)                  | [docs/documentation.md](docs/documentation.md)                                                                                    |
| Compose commit message                        | [prompts/commit-message.md](prompts/commit-message.md)                                     | [../Blueprints/Skills/commit-message.skill.md](../Blueprints/Skills/commit-message.skill.md)                                      |
| Debug test failures                           | [tests/testing.md](tests/testing.md)                                                       | [source/exaix.md](source/exaix.md)                                                                                                |
| Fix CI failures                               | [tests/testing.md](tests/testing.md) (#CI)                                                 | [source/exaix.md](source/exaix.md)                                                                                                |
| Security audit                                | [.copilot/tests/testing.md](tests/testing.md) (#Security Tests)                            | [.copilot/source/exaix.md](source/exaix.md) (#System Constraints)                                                                 |
| Claude-specific guidance                      | [providers/claude.md](providers/claude.md)                                                 | [README.md](README.md)                                                                                                            |
| VS Code Copilot setup                         | [copilot/exaix.md](copilot/exaix.md)                                                       | [README.md](README.md)                                                                                                            |
| OpenAI integration                            | [providers/openai.md](providers/openai.md)                                                 | [README.md](README.md)                                                                                                            |
| Google integration                            | [providers/google.md](providers/google.md)                                                 | [README.md](README.md)                                                                                                            |
| Gemini Long-Context                           | [providers/google-long-context.md](providers/google-long-context.md)                       | [providers/google.md](providers/google.md)                                                                                        |
| Instruction gaps / self-improvement           | [process/self-improvement.md](process/self-improvement.md)                                 | [prompts/self-improvement-loop.md](prompts/self-improvement-loop.md)                                                              |
| Architecture review / improvement             | [process/review-research-improvement.md](process/review-research-improvement.md)           | [planning/](planning/)                                                                                                            |
| SDD / request quality methodology             | [process/specification-driven-development.md](process/specification-driven-development.md) | [planning/phase-45](planning/phase-45-request-intent-analysis.md), [planning/phase-47](planning/phase-47-request-quality-gate.md) |
| Request quality gate / clarification          | [source/exaix.md](source/exaix.md)                                                         | [planning/phase-47-request-quality-gate.md](planning/phase-47-request-quality-gate.md)                                            |
| Acceptance criteria / goal-aligned evaluation | [source/exaix.md](source/exaix.md)                                                         | [planning/phase-48-acceptance-criteria-propagation.md](planning/phase-48-acceptance-criteria-propagation.md)                      |
| Quality hardening / pipeline improvements     | [source/exaix.md](source/exaix.md)                                                         | [planning/phase-49-quality-pipeline-hardening.md](planning/phase-49-quality-pipeline-hardening.md)                                |
| Portal knowledge / codebase analysis          | [source/exaix.md](source/exaix.md)                                                         | [planning/phase-46-portal-knowledge-gathering.md](planning/phase-46-portal-knowledge-gathering.md)                                |

## Search by Topic

- **`tdd`** → [source/exaix.md](source/exaix.md), [tests/testing.md](tests/testing.md)
- **`security`** → [tests/testing.md](tests/testing.md) (Security Tests as First-Class Citizens)
- **`database`** → [tests/testing.md](tests/testing.md) (Database Initialization, initTestDbService)
- **`docs`** → [docs/documentation.md](docs/documentation.md)
- **`patterns`** → [source/exaix.md](source/exaix.md) (Service Pattern, Module Documentation)
- **`helpers`** → [tests/testing.md](tests/testing.md) (Test Organization, Helpers)
- **`test-placement`** → [tests/testing.md](tests/testing.md) (Mandatory Test Placement Rules), [../tests/README.md](../tests/README.md)
- **`openai`** → [providers/openai.md](providers/openai.md)
- **`prompts`** → [providers/claude.md](providers/claude.md), [providers/openai.md](providers/openai.md)
- **`commit`** → [prompts/commit-message.md](prompts/commit-message.md), [../Blueprints/Skills/commit-message.skill.md](../Blueprints/Skills/commit-message.skill.md)
- **`refactoring`** → [source/exaix.md](source/exaix.md), [providers/claude.md](providers/claude.md)
- **`debugging`** → [providers/claude.md](providers/claude.md)
- **`coverage`** → [tests/testing.md](tests/testing.md)
- **`budget_enforcement`** → [planning/phase-62-context-window-management.md](planning/phase-62-context-window-management.md)
- **`skills_budget`** → [planning/phase-62-context-window-management.md](planning/phase-62-context-window-management.md)
- **`loopHistory_budget`** → [planning/phase-62-context-window-management.md](planning/phase-62-context-window-management.md)
- **`sdd`** → [process/specification-driven-development.md](process/specification-driven-development.md)
- **`specification`** → [process/specification-driven-development.md](process/specification-driven-development.md)
- **`quality-pipeline`** → [process/specification-driven-development.md](process/specification-driven-development.md), [planning/](planning/)
- **`quality-gate`** → [source/exaix.md](source/exaix.md), [planning/phase-47-request-quality-gate.md](planning/phase-47-request-quality-gate.md)
- **`clarification`** → [source/exaix.md](source/exaix.md), [planning/phase-47-request-quality-gate.md](planning/phase-47-request-quality-gate.md)
- **`request-specification`** → [process/specification-driven-development.md](process/specification-driven-development.md), [planning/phase-47-request-quality-gate.md](planning/phase-47-request-quality-gate.md)
- **`gemini`** → [providers/google.md](providers/google.md), [providers/google-long-context.md](providers/google-long-context.md)
- **`long-context`** → [providers/google-long-context.md](providers/google-long-context.md)
- **`self-improvement`** → [process/self-improvement.md](process/self-improvement.md), [prompts/self-improvement-loop.md](prompts/self-improvement-loop.md)
- **`architecture`** → [process/review-research-improvement.md](process/review-research-improvement.md)
- **`improvement-planning`** → [process/review-research-improvement.md](process/review-research-improvement.md), [planning/](planning/)
- **`portal-knowledge`** → [source/exaix.md](source/exaix.md), [planning/phase-46-portal-knowledge-gathering.md](planning/phase-46-portal-knowledge-gathering.md)
- **`acceptance-criteria`** → [source/exaix.md](source/exaix.md), [planning/phase-48-acceptance-criteria-propagation.md](planning/phase-48-acceptance-criteria-propagation.md)
- **`goal-alignment`** → [source/exaix.md](source/exaix.md), [planning/phase-48-acceptance-criteria-propagation.md](planning/phase-48-acceptance-criteria-propagation.md)
- **`dynamic-criteria`** → [source/exaix.md](source/exaix.md), [planning/phase-48-acceptance-criteria-propagation.md](planning/phase-48-acceptance-criteria-propagation.md)
- **`criteria-generator`** → [source/exaix.md](source/exaix.md), [planning/phase-48-acceptance-criteria-propagation.md](planning/phase-48-acceptance-criteria-propagation.md)
- **`codebase-analysis`** → [source/exaix.md](source/exaix.md), [planning/phase-46-portal-knowledge-gathering.md](planning/phase-46-portal-knowledge-gathering.md)
- **`architecture-inference`** → [source/exaix.md](source/exaix.md), [planning/phase-46-portal-knowledge-gathering.md](planning/phase-46-portal-knowledge-gathering.md)

## Workflow Examples

### "I want to add a new feature"

1. Read [planning/](planning/) to find or create the relevant Implementation Plan phase.

1.
1.

### "I want to fix a bug"

1. Check Implementation Plan for related step

1.
1.

### "I want to use Claude effectively"

1. Read [providers/claude.md](providers/claude.md) for prompt templates

1.
1.

### "I want to use Gemini effectively"

1. Read [providers/google.md](providers/google.md) for optimized prompts

1.

### "I want to add security tests"

1. Review [tests/testing.md](tests/testing.md) security section

1.
1.

## Provider-Specific Quick Links

### Claude

- **Main guide**: [providers/claude.md](providers/claude.md)
- **System prompts**: TDD, Refactoring, Debugging, Documentation (in claude.md)
- **Context window**: 200k tokens (4-6 chunks recommended)

### VS Code Copilot

- **Main guide**: [copilot/exaix.md](copilot/exaix.md)
- **Quick summary**: [copilot/summary.md](copilot/summary.md)
- **Pattern**: Consult `.copilot/manifest.json` first

### OpenAI

- **Main guide**: [providers/openai.md](providers/openai.md)
- **Prompt templates**: See `.copilot/prompts/openai-*.md`
- **Budgets**: Uses simple/standard/complex output budgets (see openai.md)

### Google

- **Main guide**: [providers/google.md](providers/google.md)
- **Long-context**: [providers/google-long-context.md](providers/google-long-context.md)
- **Context window**: 1M-2M tokens (use "Saturation" pattern)

## Common Task Patterns

### Test-Driven Development (TDD)

1. **Docs**: [source/exaix.md](source/exaix.md), [tests/testing.md](tests/testing.md)

1.

### Code Refactoring

1. **Docs**: [source/exaix.md](source/exaix.md), [providers/claude.md](providers/claude.md)

1.

### Documentation Updates

1. **Docs**: [docs/documentation.md](docs/documentation.md)

1.

### Debugging

1. **Docs**: [providers/claude.md](providers/claude.md) (Debugging section)

1.

## Canonical Prompt (Short)

"You are a developer working on Exaix. Before starting work, consult this cross-reference map to find the most relevant agent documentation. Use the task-to-doc mapping table to quickly locate guidance for your specific task type."

## Examples

- Example prompt: "I need to add a security feature. Which docs should I read?" → Answer: Start with [.copilot/tests/testing.md](tests/testing.md) security section and [.copilot/source/exaix.md](source/exaix.md) system constraints.
- Example prompt: "How do I set up Claude effectively?" → Answer: Read [providers/claude.md](providers/claude.md) for optimized prompts and thinking protocols.
- Example prompt: "What's the TDD workflow?" → Answer: See [source/exaix.md](source/exaix.md) and [tests/testing.md](tests/testing.md) for patterns and helpers.
