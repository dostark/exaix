# Phase 18: Blueprint Modernization and Integration

**Created:** 2026-01-05
**Status:** ✅ Complete
**Priority:** High
**Estimated Duration:** 3-5 days
**Parent Phase:** [Phase 17: Skills Architecture](./phase-17-skills-architecture.md)

---

## Progress Summary

| Milestone           | Status      | Description                                |
| ------------------- | ----------- | ------------------------------------------ |
| Current State Audit | ✅ Complete | Inventory all blueprints, templates, flows |
| Schema Alignment    | ✅ Complete | Standardize frontmatter format (YAML)      |
| Flow Validation     | ✅ Complete | Validate agent references in flows         |
| Skill Assignments   | ✅ Complete | Add `default_skills` to blueprints         |
| Template Updates    | ✅ Complete | Modernize templates with skill support     |
| Missing Agents      | ✅ Complete | Create agents referenced by flows          |
| Documentation       | ✅ Complete | Update READMEs and examples                |
| Validation Tests    | ✅ Complete | All 21 tests passing                       |

**Completed:** 2026-01-05

---

## Executive Summary

This phase ensures all blueprints in `Blueprints/` are consistent with the current
Exaix architecture, particularly the Phase 17 Skills system. It addresses:

1. **Format Inconsistency** - Mixed TOML (`+++`) and YAML (`---`) frontmatter

1.
1.
1.

### Key Goals

| Goal                  | Description                                          |
| --------------------- | ---------------------------------------------------- |
| **Standardization**   | All blueprints use YAML frontmatter (`---`)          |
| **Skill Integration** | Every agent has appropriate `default_skills`         |
| **Flow Validation**   | All flow agent references resolve to real blueprints |
| **Modern Models**     | Update model references to current providers         |
| **Complete Coverage** | Create missing agents required by flows              |

---

## Current State Analysis

### Blueprint Inventory

#### Root Agents (`Blueprints/Agents/`)

| File               | agent_id        | Format | Model                        | Has Skills | Issues                                  |
| ------------------ | --------------- | ------ | ---------------------------- | ---------- | --------------------------------------- |
| `default.md`       | `default`       | TOML   | `ollama:codellama:13b`       | ❌         | Outdated model format                   |
| `senior-coder.md`  | `senior-coder`  | TOML   | `codellama:7b-instruct`      | ❌         | Invalid model format (missing provider) |
| `quality-judge.md` | `quality-judge` | TOML   | `claude-3-5-sonnet-20241022` | ❌         | Invalid model format (missing provider) |
| `mock-agent.md`    | `mock-agent`    | TOML   | `mock:test-model`            | ❌         | Test-only, skip                         |

#### Example Agents (`Blueprints/Agents/examples/`)

| File                      | agent_id               | Format  | Model                       | Has Skills | Issues                   |
| ------------------------- | ---------------------- | ------- | --------------------------- | ---------- | ------------------------ |
| `code-reviewer.md`        | `code-reviewer`        | YAML ✅ | `anthropic:claude-opus-4.5` | ❌         | Missing `default_skills` |
| `feature-developer.md`    | `feature-developer`    | YAML ✅ | `anthropic:claude-opus-4.5` | ❌         | Missing `default_skills` |
| `security-auditor.md`     | `security-auditor`     | YAML ✅ | `anthropic:claude-opus-4.5` | ❌         | Missing `default_skills` |
| `api-documenter.md`       | `api-documenter`       | YAML ✅ | `anthropic:claude-opus-4.5` | ❌         | Missing `default_skills` |
| `research-synthesizer.md` | `research-synthesizer` | YAML ✅ | `anthropic:claude-opus-4.5` | ❌         | Missing `default_skills` |

### Flow Agent References

#### `code_review.flow.ts`

| Step                 | Agent Referenced       | Blueprint Exists? | Status      |
| -------------------- | ---------------------- | ----------------- | ----------- |
| `analyze-code`       | `senior-coder`         | ✅ Yes            | OK          |
| `security-review`    | `security-expert`      | ❌ No             | **MISSING** |
| `performance-review` | `performance-engineer` | ❌ No             | **MISSING** |
| `final-report`       | `technical-writer`     | ❌ No             | **MISSING** |

#### `feature_development.flow.ts`

| Step                   | Agent Referenced     | Blueprint Exists? | Status      |
| ---------------------- | -------------------- | ----------------- | ----------- |
| `analyze-requirements` | `product-manager`    | ❌ No             | **MISSING** |
| `design-architecture`  | `software-architect` | ❌ No             | **MISSING** |
| `implement-feature`    | `senior-coder`       | ✅ Yes            | OK          |
| `write-tests`          | `test-engineer`      | ❌ No             | **MISSING** |
| `code-review`          | `senior-coder`       | ✅ Yes            | OK          |

#### `documentation.flow.ts`

| Step                         | Agent Referenced     | Blueprint Exists? | Status      |
| ---------------------------- | -------------------- | ----------------- | ----------- |
| `extract-code-structure`     | `code-analyst`       | ❌ No             | **MISSING** |
| `generate-api-docs`          | `technical-writer`   | ❌ No             | **MISSING** |
| `generate-user-guide`        | `technical-writer`   | ❌ No             | **MISSING** |
| `generate-architecture-docs` | `software-architect` | ❌ No             | **MISSING** |
| `compile-documentation`      | `technical-writer`   | ❌ No             | **MISSING** |

### Missing Agents Summary

| Agent ID               | Required By                        | Recommended Skills                  |
| ---------------------- | ---------------------------------- | ----------------------------------- |
| `security-expert`      | code_review.flow                   | `security-first`, `code-review`     |
| `performance-engineer` | code_review.flow                   | `code-review`                       |
| `technical-writer`     | code_review, documentation         | `documentation-driven`              |
| `product-manager`      | feature_development                | (none)                              |
| `software-architect`   | feature_development, documentation | `exaix-conventions`                 |
| `test-engineer`        | feature_development                | `tdd-methodology`, `error-handling` |
| `code-analyst`         | documentation                      | `code-review`                       |

### Available Skills for Assignment

From `Memory/Skills/core/`:

| Skill ID               | Recommended For                                |
| ---------------------- | ---------------------------------------------- |
| `code-review`          | code-reviewer, security-auditor, quality-judge |
| `security-first`       | security-auditor, security-expert              |
| `tdd-methodology`      | test-engineer, feature-developer               |
| `error-handling`       | senior-coder, feature-developer                |
| `documentation-driven` | api-documenter, technical-writer               |
| `exaix-conventions`    | all Exaix-specific agents                      |
| `typescript-patterns`  | senior-coder, feature-developer                |
| `commit-message`       | feature-developer                              |

---

## Schema Requirements

### BlueprintFrontmatterSchema (Current)

```typescript
export const BlueprintFrontmatterSchema = z.object({
  agent_id: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(100),
  model: z.string().min(1).regex(/^[a-z]+:[a-z0-9-.:]+$/), // provider:model
  capabilities: z.array(z.string()).optional().default([]),
  created: z.string().datetime(),
  created_by: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default("1.0.0"),
  description: z.string().optional(),
  default_skills: z.array(z.string()).optional(), // NEW in Phase 17
});
```text

### Model Format Requirements

Valid: `provider:model-name`

- `anthropic:claude-opus-4.5`
- `openai:gpt-4o`
- `ollama:codellama:13b`
- `mock:test-model`

Invalid:

- `claude-3-5-sonnet-20241022` (missing provider)
- `codellama:7b-instruct` (missing provider prefix)

---

## Implementation Plan

### Step 18.1: Current State Audit ❌ NOT STARTED

**Goal:** Complete inventory of all blueprints, templates, and flow references.

**Deliverables:**

1. Generate list of all blueprint files with frontmatter analysis

1.
1.
1.

**Files:**

- All `Blueprints/Agents/**/*.md`
- All `Blueprints/Flows/**/*.flow.ts`
- All `Blueprints/Agents/templates/**/*.template`

**Success Criteria:**

- [ ] Complete blueprint inventory table
- [ ] Complete flow agent reference table
- [ ] Missing agents list with recommended skills
- [ ] Format issues documented

**Projected Tests:** None (audit only)

---

### Step 18.2: Schema Alignment - Root Agents ❌ NOT STARTED

**Goal:** Convert root blueprints from TOML to YAML and fix model formats.

**Deliverables:**

1. Convert `default.md` from TOML to YAML

1.
1.
1.

**Files to Modify:**

- `Blueprints/Agents/default.md`
- `Blueprints/Agents/senior-coder.md`
- `Blueprints/Agents/quality-judge.md`

**Conversions:**

| Agent           | Old Model                    | New Model                              |
| --------------- | ---------------------------- | -------------------------------------- |
| `default`       | `ollama:codellama:13b`       | `ollama:codellama:13b` (OK)            |
| `senior-coder`  | `codellama:7b-instruct`      | `ollama:codellama:7b-instruct`         |
| `quality-judge` | `claude-3-5-sonnet-20241022` | `anthropic:claude-3-5-sonnet-20241022` |

**Skill Assignments:**

| Agent           | default_skills                                             |
| --------------- | ---------------------------------------------------------- |
| `default`       | `["error-handling"]`                                       |
| `senior-coder`  | `["typescript-patterns", "error-handling", "code-review"]` |
| `quality-judge` | `["code-review"]`                                          |

**Success Criteria:**

- [ ] All root blueprints use YAML frontmatter (`---`)
- [ ] All model references match `provider:model` format
- [ ] All agents have appropriate `default_skills`
- [ ] `exactl blueprint validate <agent>` passes for each

**Projected Tests:** `tests/blueprints/validation_test.ts`

```text
❌ Blueprint validation: default.md passes schema
❌ Blueprint validation: senior-coder.md passes schema
❌ Blueprint validation: quality-judge.md passes schema
```text

---

### Step 18.3: Schema Alignment - Example Agents ❌ NOT STARTED

**Goal:** Add `default_skills` to all example blueprints.

**Deliverables:**

1. Add `default_skills` to `code-reviewer.md`

1.
1.
1.

**Files to Modify:**

- `Blueprints/Agents/examples/code-reviewer.md`
- `Blueprints/Agents/examples/feature-developer.md`
- `Blueprints/Agents/examples/security-auditor.md`
- `Blueprints/Agents/examples/api-documenter.md`
- `Blueprints/Agents/examples/research-synthesizer.md`

**Skill Assignments:**

| Agent                  | default_skills                                                 | Rationale                 |
| ---------------------- | -------------------------------------------------------------- | ------------------------- |
| `code-reviewer`        | `["code-review", "security-first"]`                            | Primary review agent      |
| `feature-developer`    | `["typescript-patterns", "tdd-methodology", "commit-message"]` | Full-cycle dev            |
| `security-auditor`     | `["security-first", "code-review"]`                            | Security focus            |
| `api-documenter`       | `["documentation-driven"]`                                     | Documentation focus       |
| `research-synthesizer` | `[]`                                                           | No specific skills needed |

**Success Criteria:**

- [ ] All example blueprints have `default_skills` field
- [ ] Skills match agent responsibilities
- [ ] `exactl blueprint validate <agent>` passes for each

**Projected Tests:** `tests/blueprints/validation_test.ts`

```text
❌ Blueprint validation: examples/code-reviewer.md passes schema
❌ Blueprint validation: examples/feature-developer.md passes schema
❌ Blueprint validation: examples/security-auditor.md passes schema
❌ Blueprint validation: examples/api-documenter.md passes schema
❌ Blueprint validation: examples/research-synthesizer.md passes schema
```text

---

### Step 18.4: Create Missing Agents ❌ NOT STARTED

**Goal:** Create blueprint files for all agents referenced in flows.

**Deliverables:**
Create 7 new agent blueprints:

1. `security-expert.md` - Security specialist for code_review flow

1.
1.
1.
1.
1.

**Files to Create:**

- `Blueprints/Agents/security-expert.md`
- `Blueprints/Agents/performance-engineer.md`
- `Blueprints/Agents/technical-writer.md`
- `Blueprints/Agents/product-manager.md`
- `Blueprints/Agents/software-architect.md`
- `Blueprints/Agents/test-engineer.md`
- `Blueprints/Agents/code-analyst.md`

**Blueprint Template:**

```yaml
---
agent_id: "{agent-id}"
name: "{Agent Name}"
model: "anthropic:claude-sonnet-4"
capabilities: [...]
created: "2026-01-05T00:00:00Z"
created_by: "phase-18-modernization"
version: "1.0.0"
description: "{description}"
default_skills: [...]
---

# {Agent Name}

## Role

{Role description}

## System Prompt

{Detailed system prompt}

## Response Format

{Expected output format}
```text

**Success Criteria:**

- [ ] All 7 agents created with valid YAML frontmatter
- [ ] Each agent has appropriate `default_skills`
- [ ] Each agent has clear role and system prompt
- [ ] `exactl blueprint validate <agent>` passes for each
- [ ] All flows can resolve their agent references

**Projected Tests:** `tests/blueprints/validation_test.ts`

```text
❌ Blueprint validation: security-expert.md passes schema
❌ Blueprint validation: performance-engineer.md passes schema
❌ Blueprint validation: technical-writer.md passes schema
❌ Blueprint validation: product-manager.md passes schema
❌ Blueprint validation: software-architect.md passes schema
❌ Blueprint validation: test-engineer.md passes schema
❌ Blueprint validation: code-analyst.md passes schema
```text

---

### Step 18.5: Flow Validation ❌ NOT STARTED

**Goal:** Verify all flows can load and resolve agent references.

**Deliverables:**

1. Create flow validation utility

1.
1.
1.

**Files to Modify:**

- `Blueprints/Flows/code_review.flow.ts`
- `Blueprints/Flows/feature_development.flow.ts`
- `Blueprints/Flows/documentation.flow.ts`

**Flow Skill Assignments:**

| Flow                  | defaultSkills              | Rationale                 |
| --------------------- | -------------------------- | ------------------------- |
| `code_review`         | `["code-review"]`          | All steps focus on review |
| `feature_development` | `["typescript-patterns"]`  | TypeScript project        |
| `documentation`       | `["documentation-driven"]` | Documentation focus       |

**Success Criteria:**

- [ ] All flow agent references resolve to existing blueprints
- [ ] No `undefined` agent errors when loading flows
- [ ] Flows have appropriate `defaultSkills`
- [ ] Flow execution tests pass

**Projected Tests:** `tests/flows/flow_validation_test.ts`

```text
❌ Flow validation: code_review.flow.ts resolves all agents
❌ Flow validation: feature_development.flow.ts resolves all agents
❌ Flow validation: documentation.flow.ts resolves all agents
```text

---

### Step 18.6: Template Updates ❌ NOT STARTED

**Goal:** Update agent templates to demonstrate skill configuration.

**Deliverables:**

1. Add `default_skills` placeholder to all templates

1.

**Files to Modify:**

- `Blueprints/Agents/templates/pipeline-agent.md.template`
- `Blueprints/Agents/templates/collaborative-agent.md.template`
- `Blueprints/Agents/templates/reflexive-agent.md.template`
- `Blueprints/Agents/templates/research-agent.md.template`
- `Blueprints/Agents/templates/judge-agent.md.template`
- `Blueprints/Agents/templates/specialist-agent.md.template`
- `Blueprints/Agents/templates/conversational-agent.md.template`
- `Blueprints/Agents/templates/README.md`

**Template Addition:**

```yaml
---
agent_id: "{{agent_id}}"
name: "{{name}}"
model: "anthropic:claude-opus-4.5"
capabilities: [...]
default_skills: ["{{skill_1}}", "{{skill_2}}"]  # NEW
created: "{{timestamp}}"
# ...
---
```text

**README Updates:**

- Add `default_skills` to Frontmatter Reference section
- Add "Skill Integration" section explaining skill usage
- Add recommended skills per template type

**Success Criteria:**

- [ ] All templates include `default_skills` field
- [ ] README documents skill configuration
- [ ] Template examples show realistic skill usage

**Projected Tests:** None (documentation only)

---

### Step 18.7: Documentation Updates ❌ NOT STARTED

**Goal:** Update all blueprint-related documentation.

**Deliverables:**

1. Update `Blueprints/Agents/README.md` with skill integration guide

1.
1.

**Files to Modify:**

- `Blueprints/Agents/README.md` (if exists)
- `Blueprints/Agents/examples/README.md`
- `Blueprints/Flows/README.md`

**Content Additions:**

1. **Skills Integration Section:**
   - How to assign `default_skills` to blueprints
   - How skills are matched at runtime
   - Precedence: request → triggers → blueprint defaults

1.
   - List of core skills with descriptions
   - Recommended skills per agent type

1.
   - Converting TOML to YAML frontmatter
   - Adding skills to existing blueprints
   - Updating model format

**Success Criteria:**

- [ ] READMEs document skill integration
- [ ] Examples demonstrate skill usage
- [ ] Migration path documented

**Projected Tests:** None (documentation only)

---

### Step 18.8: Validation Tests ❌ NOT STARTED

**Goal:** Create automated tests for blueprint and flow validation.

**Deliverables:**

1. Blueprint schema validation test suite

1.

**Files to Create:**

- `tests/blueprints/blueprint_validation_test.ts`
- `tests/flows/flow_agent_resolution_test.ts`

**Test Coverage:**

```typescript
// Blueprint validation tests
Deno.test("Blueprint: all root agents pass schema validation", ...);
Deno.test("Blueprint: all example agents pass schema validation", ...);
Deno.test("Blueprint: all agents have valid model format", ...);
Deno.test("Blueprint: all agents have default_skills field", ...);

// Flow agent resolution tests
Deno.test("Flow: code_review resolves all agent references", ...);
Deno.test("Flow: feature_development resolves all agent references", ...);
Deno.test("Flow: documentation resolves all agent references", ...);
```text

**Success Criteria:**

- [ ] All blueprint validation tests pass
- [ ] All flow agent resolution tests pass
- [ ] CI includes blueprint validation

**Projected Tests:** 10+ tests across 2 test files

---

## Implementation Summary

| Step | Description                 | Files      | Tests |
| ---- | --------------------------- | ---------- | ----- |
| 18.1 | Current State Audit         | -          | -     |
| 18.2 | Schema Alignment (Root)     | 3 modified | 3     |
| 18.3 | Schema Alignment (Examples) | 5 modified | 5     |
| 18.4 | Create Missing Agents       | 7 created  | 7     |
| 18.5 | Flow Validation             | 3 modified | 3     |
| 18.6 | Template Updates            | 8 modified | -     |
| 18.7 | Documentation Updates       | 3 modified | -     |
| 18.8 | Validation Tests            | 2 created  | 10+   |

**Total:** ~31 files modified/created, 28+ tests

---

## Risk Assessment

| Risk                           | Mitigation                                              |
| ------------------------------ | ------------------------------------------------------- |
| Breaking existing blueprints   | Maintain backward compatibility, validate before commit |
| Invalid skill references       | Validate skill IDs exist in Memory/Skills/              |
| Flow execution failures        | Test flows after agent creation                         |
| Template placeholder conflicts | Use consistent `{{placeholder}}` syntax                 |

---

## Dependencies

- **Phase 17 Complete:** Skills system must be functional
- **SkillsService:** Must support `getSkill()` for validation
- **BlueprintService:** Must parse `default_skills` field
- **FlowRunner:** Must pass skills to agent execution

---

## Success Metrics

| Metric                         | Target              |
| ------------------------------ | ------------------- |
| Blueprint schema compliance    | 100%                |
| Flow agent resolution          | 100%                |
| Blueprints with default_skills | 100%                |
| Test coverage                  | 28+ tests passing   |
| Documentation completeness     | All READMEs updated |

```
