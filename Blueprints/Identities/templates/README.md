# Agent Templates

This directory contains **abstract agent patterns** designed to be used as starting points for creating new agents.

## What are Templates?

Unlike **Examples** (which are fully defined personas like "Code Reviewer"), **Templates** are structural skeletons. They define _how_ an agent thinks or interacts (e.g., "Pipeline Step", "Collaborator", "Judge") but leave the _who_ (persona) and _what_ (specific task) to you.

## Skills Integration 🆕

To reduce redundancy and ensure consistent behavior across all agents, templates use `default_skills` to reference shared skills. Every template includes `response-contract` as a critical skill for the mandatory output contract.

Key skills include:

- `response-contract`: Standardizes the `<thought>` and `<content>` response structure with JSON schema.
- `code-review`: Comprehensive code review checklist.
- `security-first`: Secure coding and vulnerability assessment.
- `verdict-rubric`: Structured evaluation criteria for LLM-as-a-Judge agents.

## Available Templates

### 1. Pipeline Agent (`pipeline-agent.md.template`)

**Pattern:** Step-by-step processing
**Use Case:** Agents that perform a specific transformation in a larger flow.
**Key Features:**

- Focused system prompt
- Input/Output format constraints
- Deterministic 5-step methodology

### 2. Collaborative Agent (`collaborative-agent.md.template`)

**Pattern:** Multi-agent interaction
**Use Case:** Agents that need to hand off work or reach consensus.
**Key Features:**

- Instructions for context sharing
- Handoff protocols
- Flow integration support

### 3. Reflexive Agent (`reflexive-agent.md.template`) 🆕

**Pattern:** Self-critique and improvement
**Use Case:** Quality-critical tasks where first drafts need refinement.
**Key Features:**

- Self-critique protocol (accuracy, completeness, quality, safety)
- Confidence scoring (0-100)
- Iterative refinement loop (configurable iterations)
- Early exit when quality threshold met

**When to use:**

- Code review agents
- Technical writing agents
- Analysis/audit agents
- Any task where output quality is critical

### 4. Research Agent (`research-agent.md.template`) 🆕

**Pattern:** Information gathering with citations
**Use Case:** Exploration, documentation research, dependency analysis.
**Key Features:**

- Structured research methodology (5 phases)
- Source reliability evaluation
- Citation requirements (numbered references)
- Gap and uncertainty reporting
- Memory Bank integration (optional)

**When to use:**

- Codebase exploration
- Architecture documentation
- Bug root cause analysis
- Dependency investigation

### 5. Judge Agent (`judge-agent.md.template`) 🆕

**Pattern:** LLM-as-a-Judge evaluation
**Use Case:** Quality gates, compliance checks, approval workflows.
**Key Features:**

- Weighted criteria scoring (0-100 per criterion)
- Structured verdict (PASS/CONDITIONAL/FAIL)
- Blocking issue identification
- Prioritized improvement suggestions
- JSON verdict for automation

**When to use:**

- Code review quality gates
- Documentation validation
- Plan approval workflows
- Compliance checking

### 6. Specialist Agent (`specialist-agent.md.template`) 🆕

**Pattern:** Domain-focused expertise
**Use Case:** Agents with deep knowledge in a specific domain.
**Key Features:**

- Domain-specific checklist methodology
- Severity classification (critical/high/medium/low/info)
- Structured analysis format
- Pre-built persona configurations (security, code review, architecture)

**When to use:**

- Security audits
- Architecture reviews
- Code quality assessments
- Specialized compliance checks

### 7. Conversational Agent (`conversational-agent.md.template`) 🆕

**Pattern:** Multi-turn dialogue
**Use Case:** Interactive sessions requiring context continuity.
**Key Features:**

- Conversation state tracking
- Short-term and long-term memory integration
- Topic change handling
- Multiple persona templates (assistant, mentor, brainstorm partner)

**When to use:**

- Interactive debugging sessions
- Technical mentoring
- Brainstorming and ideation
- Exploratory assistance

## Template Comparison

| Template       | Output Quality | Latency | Automation | Best For            |
| -------------- | -------------- | ------- | ---------- | ------------------- |
| Pipeline       | Standard       | Low     | High       | Transformations     |
| Collaborative  | Standard       | Medium  | Medium     | Multi-agent flows   |
| Reflexive      | High           | High    | Medium     | Quality-critical    |
| Specialist     | High           | Medium  | High       | Domain expertise    |
| Conversational | Standard       | Low     | Low        | Multi-turn dialogue |
| Research       | High           | Medium  | Low        | Exploration         |
| Judge          | Structured     | Medium  | High       | Quality gates       |

## How to Use

1. **Choose a pattern** that matches your needs.

   ```bash
   cp templates/reflexive-agent.md.template ../my-reviewer.md
   ```

1.
   - **Update Frontmatter:** Change `agent_id`, `name`, and `model`.
   - **Define Persona:** Replace `{{placeholder}}` values.
   - **Customize Criteria:** Adjust confidence thresholds, evaluation criteria.
   - **Refine Capabilities:** Add/remove tools as needed.

1. ```bash
   exactl blueprint validate my-reviewer
   ```

## Frontmatter Reference

### Common Fields (all templates)

```yaml
agent_id: "unique-id" # Required: Unique identifier
name: "Display Name" # Required: Human-readable name
model: "google:gemini-2.0-flash-exp" # Required: LLM model
capabilities: ["read_file"] # Required: MCP tools allowed
version: "1.0.0" # Semantic version
created: "2025-01-20T..." # ISO timestamp
created_by: "author" # Creator identifier
default_skills: [] # Skills to apply by default (Phase 17)
```

### Skills Integration (Phase 17)

All templates now support the `default_skills` field for automatic skill injection:

```yaml
default_skills: ["code-review", "security-first"] # Applied to all requests
```

**Available Core Skills:**

| Skill ID               | Best For                       |
| ---------------------- | ------------------------------ |
| `code-review`          | Review agents, quality judges  |
| `security-first`       | Security-focused agents        |
| `tdd-methodology`      | Test engineers, developers     |
| `error-handling`       | All coding agents              |
| `documentation-driven` | Technical writers, documenters |
| `typescript-patterns`  | TypeScript developers          |
| `commit-message`       | Git-aware agents               |
| `exaix-conventions`    | Exaix-specific development     |

**Skill Resolution Priority:**

1. Request-level `skills` (highest priority)

1.
1.

### Reflexive Agent Fields

```yaml
reflexive: true # Enable reflexion runtime
max_reflexion_iterations: 3 # Max refinement loops
confidence_required: 80 # Minimum score to finalize
```

### Research Agent Fields

```yaml
memory_enabled: true # Use Memory Bank for context
citation_required: true # Enforce citation format
```

### Judge Agent Fields

```yaml
judge_mode: true # Enable verdict parsing
criteria_version: "1.0" # Criteria set version
verdict_threshold: 70 # PASS threshold score
```

### Specialist Agent Fields

```yaml
domain: "security" # Specialization domain
expertise_level: "expert" # expert | senior | standard
```

### Conversational Agent Fields

```yaml
conversational: true # Enable multi-turn mode
max_turns: 20 # Max turns before reset
memory_enabled: true # Use Memory Bank
context_window: 10 # Turns to keep in context
```

## Implementation Status

| Template       | Documentation | Runtime Support |
| -------------- | ------------- | --------------- |
| Pipeline       | ✅ Complete   | ✅ Supported    |
| Collaborative  | ✅ Complete   | ✅ Supported    |
| Reflexive      | ✅ Complete   | ✅ Phase 16.4   |
| Research       | ✅ Complete   | ✅ Phase 16.6   |
| Judge          | ✅ Complete   | ✅ Supported    |
| Specialist     | ✅ Complete   | ✅ Supported    |
| Conversational | ✅ Complete   | ✅ Phase 16.6   |

See [Phase 16: Agent Orchestration Improvements](../../../agents/planning/phase-16-agent-orchestration-improvements.md) for implementation details.
