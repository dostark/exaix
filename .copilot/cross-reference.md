---
agent: general
scope: dev
title: "Cross Reference Guide"
short_summary: "Mapping of common agent tasks to .copilot docs by role: skills, commands, guidelines, and providers."
version: "0.2"
identity: documentation
topics: ["cross-reference", "workflow", "testing", "agents", "self-improvement"]
---

## Task → Agent Doc Quick Reference

| Task Type | Primary Doc | Secondary Docs |
| --- | --- | --- |
| .copilot/prompts/ — Chat Routing Wrappers | [prompts/README.md](prompts/README.md) | |
| .copilot/ — AI Agent Knowledge Base | [README.md](README.md) | |
| Agent Thought Section Standardization | [guidelines/agent-thought-standardization.md](guidelines/agent-thought-standardization.md) | |
| Exaix Test Development Guidelines | [guidelines/testing.md](guidelines/testing.md) | |
| Specification-Driven Development in Exaix | [guidelines/specification-driven-development.md](guidelines/specification-driven-development.md) | |
| Self-improvement loop for agent instructions | [guidelines/self-improvement.md](guidelines/self-improvement.md) | |
| Exaix Development Guidelines | [guidelines/README.md](guidelines/README.md) | |
| Agent Content Schema Reference | [guidelines/agent-content-schema.md](guidelines/agent-content-schema.md) | |
| Exaix Documentation Development Guidelines | [guidelines/documentation.md](guidelines/documentation.md) | |
| Project Governance & Methodology | [guidelines/process-README.md](guidelines/process-README.md) | |
| Exaix Source Development Guidelines | [guidelines/exaix-development.md](guidelines/exaix-development.md) | |
| jscpd Code Duplication Detection Guide | [guidelines/jscpd-guide.md](guidelines/jscpd-guide.md) | |
| Review-Research-Improvement Pattern | [guidelines/review-research-improvement.md](guidelines/review-research-improvement.md) | |
| Documentation Skill (#doc) | [skills/doc/SKILL.md](skills/doc/SKILL.md) | |
| Coverage Skill (#coverage) | [skills/coverage/SKILL.md](skills/coverage/SKILL.md) | |
| Package Extraction Skill (#package-extraction) | [skills/package-extraction/SKILL.md](skills/package-extraction/SKILL.md) | |
| Submodule Workflow Skill (#submodule-workflow) | [skills/submodule-workflow/SKILL.md](skills/submodule-workflow/SKILL.md) | |
| Reduce Code Duplication (#duplication) | [skills/duplication/SKILL.md](skills/duplication/SKILL.md) | |
| Infrastructure/Config Skill (#infra) | [skills/infra/SKILL.md](skills/infra/SKILL.md) | |
| Plan Skill (#plan) | [skills/plan/SKILL.md](skills/plan/SKILL.md) | |
| Refactoring Skill (#refactor) | [skills/refactor/SKILL.md](skills/refactor/SKILL.md) | |
| Linting/Formatting Skill (#lint) | [skills/lint/SKILL.md](skills/lint/SKILL.md) | |
| Fix Skill (#fix) | [skills/fix/SKILL.md](skills/fix/SKILL.md) | |
| Clean Codebase Skill (#clean-codebase) | [skills/clean-codebase/SKILL.md](skills/clean-codebase/SKILL.md) | |
| Post-Gap Analysis Skill (#post-gap-analysis) | [skills/post-gap-analysis/SKILL.md](skills/post-gap-analysis/SKILL.md) | |
| Refactor-Check-Magic Skill (#refactor-check-magic) | [skills/refactor-check-magic/SKILL.md](skills/refactor-check-magic/SKILL.md) | |
| Commit Skill (#commit) | [skills/commit/SKILL.md](skills/commit/SKILL.md) | |
| Security Skill (#security) | [skills/security/SKILL.md](skills/security/SKILL.md) | |
| Codebase Exploration (#explore) | [skills/explore/SKILL.md](skills/explore/SKILL.md) | |
| Upgrade Skill (#upgrade) | [skills/upgrade/SKILL.md](skills/upgrade/SKILL.md) | |
| TDD Workflow Skill (#tdd-workflow) | [skills/tdd-workflow/SKILL.md](skills/tdd-workflow/SKILL.md) | |
| Review-Research-Improvement Skill (#review-research) | [skills/review-research/SKILL.md](skills/review-research/SKILL.md) | |
| Review Skill (#review) | [skills/review/SKILL.md](skills/review/SKILL.md) | |
| Next-Steps Skill (#next-steps) | [skills/next-steps/SKILL.md](skills/next-steps/SKILL.md) | |
| Pre-Gap Analysis Skill (#pre-gap-analysis) | [skills/pre-gap-analysis/SKILL.md](skills/pre-gap-analysis/SKILL.md) | |
| Claude provider adaptation notes | [providers/claude.md](providers/claude.md) | |
| Google Gemini Provider Adaptation Guide | [providers/google.md](providers/google.md) | |
| Gemini Long-Context Reasoning Guide | [providers/google-long-context.md](providers/google-long-context.md) | |
| OpenAI adaptation notes | [providers/openai.md](providers/openai.md) | |

## Search by Topic

- **`agents`** → [guidelines/agent-thought-standardization.md](guidelines/agent-thought-standardization.md), [guidelines/self-improvement.md](guidelines/self-improvement.md), [guidelines/agent-content-schema.md](guidelines/agent-content-schema.md)
- **`architecture`** → [guidelines/specification-driven-development.md](guidelines/specification-driven-development.md), [skills/package-extraction/SKILL.md](skills/package-extraction/SKILL.md), [skills/plan/SKILL.md](skills/plan/SKILL.md), [skills/clean-codebase/SKILL.md](skills/clean-codebase/SKILL.md), [skills/post-gap-analysis/SKILL.md](skills/post-gap-analysis/SKILL.md), [skills/explore/SKILL.md](skills/explore/SKILL.md), [skills/review/SKILL.md](skills/review/SKILL.md), [skills/pre-gap-analysis/SKILL.md](skills/pre-gap-analysis/SKILL.md)
- **`architecture-review`** → [guidelines/review-research-improvement.md](guidelines/review-research-improvement.md), [skills/review-research/SKILL.md](skills/review-research/SKILL.md)
- **`audit`** → [skills/security/SKILL.md](skills/security/SKILL.md)
- **`auth`** → [skills/security/SKILL.md](skills/security/SKILL.md)
- **`best-practices`** → [guidelines/README.md](guidelines/README.md), [skills/commit/SKILL.md](skills/commit/SKILL.md), [skills/review/SKILL.md](skills/review/SKILL.md)
- **`blueprints`** → [guidelines/agent-content-schema.md](guidelines/agent-content-schema.md)
- **`bug-fix`** → [skills/fix/SKILL.md](skills/fix/SKILL.md)
- **`ci`** → [skills/coverage/SKILL.md](skills/coverage/SKILL.md), [skills/fix/SKILL.md](skills/fix/SKILL.md), [skills/clean-codebase/SKILL.md](skills/clean-codebase/SKILL.md), [skills/next-steps/SKILL.md](skills/next-steps/SKILL.md)
- **`clarity`** → [skills/doc/SKILL.md](skills/doc/SKILL.md)
- **`cleanup`** → [skills/clean-codebase/SKILL.md](skills/clean-codebase/SKILL.md)
- **`code-quality`** → [skills/duplication/SKILL.md](skills/duplication/SKILL.md), [skills/refactor/SKILL.md](skills/refactor/SKILL.md), [skills/lint/SKILL.md](skills/lint/SKILL.md), [skills/refactor-check-magic/SKILL.md](skills/refactor-check-magic/SKILL.md)
- **`code-review`** → [skills/review/SKILL.md](skills/review/SKILL.md)
- **`commit`** → [skills/commit/SKILL.md](skills/commit/SKILL.md)
- **`commits`** → [skills/next-steps/SKILL.md](skills/next-steps/SKILL.md)
- **`configurability`** → [skills/plan/SKILL.md](skills/plan/SKILL.md)
- **`configuration`** → [skills/infra/SKILL.md](skills/infra/SKILL.md)
- **`constants`** → [skills/refactor-check-magic/SKILL.md](skills/refactor-check-magic/SKILL.md)
- **`context-saturation`** → [providers/google-long-context.md](providers/google-long-context.md)
- **`copilot`** → [prompts/README.md](prompts/README.md)
- **`coverage`** → [skills/coverage/SKILL.md](skills/coverage/SKILL.md), [skills/tdd-workflow/SKILL.md](skills/tdd-workflow/SKILL.md)
- **`debugging`** → [providers/claude.md](providers/claude.md)
- **`dependencies`** → [skills/upgrade/SKILL.md](skills/upgrade/SKILL.md)
- **`deployment`** → [skills/infra/SKILL.md](skills/infra/SKILL.md)
- **`development`** → [guidelines/exaix-development.md](guidelines/exaix-development.md)
- **`discovery`** → [skills/explore/SKILL.md](skills/explore/SKILL.md)
- **`docs`** → [guidelines/documentation.md](guidelines/documentation.md), [skills/submodule-workflow/SKILL.md](skills/submodule-workflow/SKILL.md)
- **`documentation`** → [skills/doc/SKILL.md](skills/doc/SKILL.md), [skills/commit/SKILL.md](skills/commit/SKILL.md)
- **`duplication`** → [skills/duplication/SKILL.md](skills/duplication/SKILL.md)
- **`enums`** → [skills/refactor-check-magic/SKILL.md](skills/refactor-check-magic/SKILL.md)
- **`exploration`** → [skills/explore/SKILL.md](skills/explore/SKILL.md)
- **`formatting`** → [skills/lint/SKILL.md](skills/lint/SKILL.md)
- **`gap-analysis`** → [skills/post-gap-analysis/SKILL.md](skills/post-gap-analysis/SKILL.md), [skills/pre-gap-analysis/SKILL.md](skills/pre-gap-analysis/SKILL.md)
- **`gemini`** → [providers/google-long-context.md](providers/google-long-context.md)
- **`git`** → [skills/submodule-workflow/SKILL.md](skills/submodule-workflow/SKILL.md), [skills/commit/SKILL.md](skills/commit/SKILL.md)
- **`governance`** → [guidelines/process-README.md](guidelines/process-README.md)
- **`guidelines`** → [guidelines/README.md](guidelines/README.md)
- **`helpers`** → [guidelines/testing.md](guidelines/testing.md), [skills/tdd-workflow/SKILL.md](skills/tdd-workflow/SKILL.md)
- **`improvement-planning`** → [guidelines/review-research-improvement.md](guidelines/review-research-improvement.md), [skills/review-research/SKILL.md](skills/review-research/SKILL.md)
- **`infrastructure`** → [skills/infra/SKILL.md](skills/infra/SKILL.md)
- **`injection`** → [skills/security/SKILL.md](skills/security/SKILL.md)
- **`instruction-adequacy`** → [guidelines/self-improvement.md](guidelines/self-improvement.md)
- **`jscpd`** → [guidelines/jscpd-guide.md](guidelines/jscpd-guide.md), [skills/duplication/SKILL.md](skills/duplication/SKILL.md)
- **`json`** → [guidelines/agent-content-schema.md](guidelines/agent-content-schema.md)
- **`linting`** → [skills/lint/SKILL.md](skills/lint/SKILL.md), [skills/clean-codebase/SKILL.md](skills/clean-codebase/SKILL.md)
- **`long-context`** → [providers/google.md](providers/google.md), [providers/google-long-context.md](providers/google-long-context.md)
- **`magic-values`** → [skills/refactor-check-magic/SKILL.md](skills/refactor-check-magic/SKILL.md)
- **`maintenance`** → [guidelines/self-improvement.md](guidelines/self-improvement.md), [skills/refactor/SKILL.md](skills/refactor/SKILL.md), [skills/upgrade/SKILL.md](skills/upgrade/SKILL.md)
- **`methodology`** → [guidelines/specification-driven-development.md](guidelines/specification-driven-development.md), [guidelines/README.md](guidelines/README.md), [guidelines/process-README.md](guidelines/process-README.md)
- **`migration`** → [skills/package-extraction/SKILL.md](skills/package-extraction/SKILL.md)
- **`navigation`** → [skills/explore/SKILL.md](skills/explore/SKILL.md)
- **`owasp`** → [skills/security/SKILL.md](skills/security/SKILL.md)
- **`packages`** → [skills/package-extraction/SKILL.md](skills/package-extraction/SKILL.md)
- **`parallel-tool-calls`** → [providers/google.md](providers/google.md)
- **`path-traversal`** → [skills/security/SKILL.md](skills/security/SKILL.md)
- **`patterns`** → [guidelines/exaix-development.md](guidelines/exaix-development.md), [guidelines/review-research-improvement.md](guidelines/review-research-improvement.md), [skills/review-research/SKILL.md](skills/review-research/SKILL.md)
- **`planning`** → [skills/plan/SKILL.md](skills/plan/SKILL.md), [skills/post-gap-analysis/SKILL.md](skills/post-gap-analysis/SKILL.md), [skills/review-research/SKILL.md](skills/review-research/SKILL.md), [skills/next-steps/SKILL.md](skills/next-steps/SKILL.md), [skills/pre-gap-analysis/SKILL.md](skills/pre-gap-analysis/SKILL.md)
- **`process`** → [guidelines/documentation.md](guidelines/documentation.md)
- **`prompts`** → [prompts/README.md](prompts/README.md), [providers/claude.md](providers/claude.md), [providers/google.md](providers/google.md), [providers/openai.md](providers/openai.md)
- **`provider-adaptations`** → [providers/claude.md](providers/claude.md), [providers/google.md](providers/google.md), [providers/openai.md](providers/openai.md)
- **`publishing`** → [guidelines/documentation.md](guidelines/documentation.md)
- **`qa`** → [skills/clean-codebase/SKILL.md](skills/clean-codebase/SKILL.md)
- **`quality`** → [guidelines/specification-driven-development.md](guidelines/specification-driven-development.md), [guidelines/jscpd-guide.md](guidelines/jscpd-guide.md), [guidelines/review-research-improvement.md](guidelines/review-research-improvement.md), [skills/coverage/SKILL.md](skills/coverage/SKILL.md), [skills/post-gap-analysis/SKILL.md](skills/post-gap-analysis/SKILL.md), [skills/review-research/SKILL.md](skills/review-research/SKILL.md), [skills/pre-gap-analysis/SKILL.md](skills/pre-gap-analysis/SKILL.md)
- **`quality-assurance`** → [skills/review/SKILL.md](skills/review/SKILL.md)
- **`rag`** → [guidelines/self-improvement.md](guidelines/self-improvement.md), [providers/openai.md](providers/openai.md)
- **`reasoning`** → [guidelines/agent-thought-standardization.md](guidelines/agent-thought-standardization.md), [providers/google-long-context.md](providers/google-long-context.md)
- **`red-green-refactor`** → [skills/tdd-workflow/SKILL.md](skills/tdd-workflow/SKILL.md), [skills/next-steps/SKILL.md](skills/next-steps/SKILL.md)
- **`refactor`** → [skills/package-extraction/SKILL.md](skills/package-extraction/SKILL.md)
- **`refactoring`** → [guidelines/jscpd-guide.md](guidelines/jscpd-guide.md), [guidelines/review-research-improvement.md](guidelines/review-research-improvement.md), [skills/duplication/SKILL.md](skills/duplication/SKILL.md), [skills/refactor/SKILL.md](skills/refactor/SKILL.md), [skills/refactor-check-magic/SKILL.md](skills/refactor-check-magic/SKILL.md), [skills/review-research/SKILL.md](skills/review-research/SKILL.md), [providers/claude.md](providers/claude.md)
- **`regression`** → [skills/fix/SKILL.md](skills/fix/SKILL.md), [skills/upgrade/SKILL.md](skills/upgrade/SKILL.md)
- **`request-processing`** → [guidelines/specification-driven-development.md](guidelines/specification-driven-development.md)
- **`review`** → [skills/post-gap-analysis/SKILL.md](skills/post-gap-analysis/SKILL.md)
- **`risk`** → [skills/pre-gap-analysis/SKILL.md](skills/pre-gap-analysis/SKILL.md)
- **`root-cause`** → [skills/fix/SKILL.md](skills/fix/SKILL.md)
- **`routing`** → [prompts/README.md](prompts/README.md)
- **`schema`** → [guidelines/agent-content-schema.md](guidelines/agent-content-schema.md)
- **`sdd`** → [guidelines/specification-driven-development.md](guidelines/specification-driven-development.md), [guidelines/process-README.md](guidelines/process-README.md)
- **`secrets`** → [skills/security/SKILL.md](skills/security/SKILL.md)
- **`security`** → [guidelines/README.md](guidelines/README.md), [skills/plan/SKILL.md](skills/plan/SKILL.md), [skills/post-gap-analysis/SKILL.md](skills/post-gap-analysis/SKILL.md), [skills/security/SKILL.md](skills/security/SKILL.md), [skills/review/SKILL.md](skills/review/SKILL.md), [skills/pre-gap-analysis/SKILL.md](skills/pre-gap-analysis/SKILL.md)
- **`self-improvement`** → [guidelines/self-improvement.md](guidelines/self-improvement.md), [guidelines/process-README.md](guidelines/process-README.md)
- **`setup`** → [skills/infra/SKILL.md](skills/infra/SKILL.md)
- **`skills`** → [prompts/README.md](prompts/README.md)
- **`source`** → [guidelines/exaix-development.md](guidelines/exaix-development.md)
- **`standardization`** → [guidelines/agent-thought-standardization.md](guidelines/agent-thought-standardization.md)
- **`steps`** → [skills/next-steps/SKILL.md](skills/next-steps/SKILL.md)
- **`structured-logging`** → [skills/commit/SKILL.md](skills/commit/SKILL.md)
- **`style`** → [skills/lint/SKILL.md](skills/lint/SKILL.md), [skills/clean-codebase/SKILL.md](skills/clean-codebase/SKILL.md)
- **`submodule`** → [skills/submodule-workflow/SKILL.md](skills/submodule-workflow/SKILL.md)
- **`tdd`** → [guidelines/testing.md](guidelines/testing.md), [guidelines/exaix-development.md](guidelines/exaix-development.md), [skills/coverage/SKILL.md](skills/coverage/SKILL.md), [skills/package-extraction/SKILL.md](skills/package-extraction/SKILL.md), [skills/plan/SKILL.md](skills/plan/SKILL.md), [skills/fix/SKILL.md](skills/fix/SKILL.md), [skills/post-gap-analysis/SKILL.md](skills/post-gap-analysis/SKILL.md), [skills/refactor-check-magic/SKILL.md](skills/refactor-check-magic/SKILL.md), [skills/security/SKILL.md](skills/security/SKILL.md), [skills/tdd-workflow/SKILL.md](skills/tdd-workflow/SKILL.md), [skills/next-steps/SKILL.md](skills/next-steps/SKILL.md), [skills/pre-gap-analysis/SKILL.md](skills/pre-gap-analysis/SKILL.md), [providers/claude.md](providers/claude.md)
- **`testing`** → [guidelines/README.md](guidelines/README.md), [skills/coverage/SKILL.md](skills/coverage/SKILL.md), [skills/tdd-workflow/SKILL.md](skills/tdd-workflow/SKILL.md), [skills/review/SKILL.md](skills/review/SKILL.md)
- **`tests`** → [guidelines/testing.md](guidelines/testing.md)
- **`thinking-protocol`** → [providers/openai.md](providers/openai.md)
- **`thought-structure`** → [guidelines/agent-thought-standardization.md](guidelines/agent-thought-standardization.md)
- **`tool-use`** → [providers/claude.md](providers/claude.md)
- **`tooling`** → [providers/openai.md](providers/openai.md)
- **`tools`** → [guidelines/jscpd-guide.md](guidelines/jscpd-guide.md)
- **`traceability`** → [skills/plan/SKILL.md](skills/plan/SKILL.md)
- **`upgrade`** → [skills/upgrade/SKILL.md](skills/upgrade/SKILL.md)
- **`validation`** → [guidelines/agent-content-schema.md](guidelines/agent-content-schema.md), [skills/fix/SKILL.md](skills/fix/SKILL.md), [skills/clean-codebase/SKILL.md](skills/clean-codebase/SKILL.md)
- **`version`** → [skills/upgrade/SKILL.md](skills/upgrade/SKILL.md)
- **`workflow`** → [skills/submodule-workflow/SKILL.md](skills/submodule-workflow/SKILL.md)
- **`workspace`** → [skills/package-extraction/SKILL.md](skills/package-extraction/SKILL.md)
- **`wrappers`** → [prompts/README.md](prompts/README.md)
- **`writing`** → [skills/doc/SKILL.md](skills/doc/SKILL.md)

## Workflow Examples

- **New feature**: `#plan` → `#pre-gap-analysis` → `#next-steps` → `#commit`
- **Package migration**: `#explore` → `#package-extraction` → `#next-steps` → `#doc` → `#commit`
- **Bug fix**: `#fix` → `#regression` → `#commit`
- **Code quality**: `#clean-codebase` → `#duplication` → `#refactor-check-magic` → `#commit`
- **Review**: `#post-gap-analysis` → `#review` → `#commit`

## Canonical Paths

- Testing guidelines: [guidelines/testing.md](guidelines/testing.md)
- Development guidelines: [guidelines/exaix-development.md](guidelines/exaix-development.md)
- Self-improvement process: [guidelines/self-improvement.md](guidelines/self-improvement.md)
- Tool confirmation / human-in-loop: [exaix-dev-docs/planning/phase-79-tool-confirmation-interceptor.md](../exaix-dev-docs/planning/phase-79-tool-confirmation-interceptor.md), `src/services/tool/cli_confirmation_interceptor.ts`, `src/services/tool/notification_queue_confirmation_interceptor.ts`

## Directory Structure

```text
.copilot/
├── commands/    # Slash commands — short invocation prompts with description: field
├── skills/      # Multi-step autonomous workflows (SKILL.md files)
├── guidelines/  # Reference guidelines and process documents
├── providers/   # Provider-specific adaptation notes (Claude, OpenAI, Google)
└── planning/    # Phase planning documents
```
